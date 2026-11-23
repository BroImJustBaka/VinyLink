"""Asistente de compras con IA y herramientas (function calling).

Proveedor de IA (el primero que tenga llave):
  - Gemini (Google AI Studio, plan gratuito): GEMINI_API_KEY.
  - Claude (Anthropic, prepagado): ANTHROPIC_API_KEY.

Cómo funciona una respuesta:
  1. Se manda al modelo la conversación completa más el mensaje nuevo, junto
     con la lista de herramientas (buscar productos, ver un pedido...).
  2. Si el modelo pide usar herramientas, este servicio las ejecuta contra el
     backend de la tienda (con la sesión del cliente) y le regresa los
     resultados. Se repite hasta que contesta con texto.
  3. La conversación se guarda en MongoDB tal como la regresa la API (con sus
     firmas de pensamiento), para poder continuarla en el siguiente mensaje.

El agente solo LEE: no puede comprar, cancelar ni cambiar nada.

Si no hay llave, se acaba la cuota gratuita o la API falla, contesta en
"modo básico" (reglas sobre las mismas consultas, sin IA): el chat nunca se
rompe y no se genera ningún cobro.
"""

import asyncio
import json
import logging
import re
import time
import unicodedata
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import anthropic
import httpx
from google import genai
from google.genai import errors as gerrores
from google.genai import types as gtipos
from pymongo.asynchronous.database import AsyncDatabase

from . import resenas
from .config import config
from .tienda import ClienteTienda, ErrorTienda

log = logging.getLogger("agente")

SISTEMA = """Eres Vinny, el asistente de compras de VinyLink, una tienda en línea mexicana de discos de vinilo, audífonos e instrumentos musicales.

Ayudas a los clientes a encontrar productos, comparar opciones, entender precios y revisar el estado de sus pedidos. Responde siempre en español de México, con un tono amable y breve (2 a 5 oraciones, o una lista corta).

Reglas:
- Usa las herramientas para cualquier dato de la tienda (productos, precios, existencias, pedidos). Nunca inventes productos, precios, existencias ni estados de pedidos.
- Los precios están en pesos mexicanos (MXN) e incluyen IVA. Si el cliente pregunta por dólares, usa la herramienta de tipo de cambio y aclara que es aproximado.
- Cuando recomiendes productos, menciona nombre y precio. La tienda muestra tarjetas con los productos que encontraste, así que no pegues enlaces ni URLs de imágenes.
- Para ver pedidos el cliente debe tener la sesión iniciada. Si la herramienta responde que no hay sesión, pídele que inicie sesión en /login.
- No puedes comprar, cancelar, reembolsar ni modificar nada: para eso indica la sección de la tienda (carrito en /carrito, pedidos en /perfil).
- Métodos de pago de la tienda: tarjeta de crédito (con meses sin intereses) o débito, efectivo en OXXO, transferencia SPEI, link de pago y PayPal.
- Si te preguntan algo que no tiene que ver con la tienda o la música, responde con amabilidad que solo puedes ayudar con compras en VinyLink.
- Nunca pidas ni repitas datos de tarjetas, contraseñas u otros datos sensibles."""


def _herramienta(nombre: str, descripcion: str, propiedades: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": nombre,
        "description": descripcion,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": propiedades,
            "required": list(propiedades),
            "additionalProperties": False,
        },
    }


HERRAMIENTAS = [
    _herramienta(
        "buscar_productos",
        "Busca productos activos de la tienda por texto (nombre, descripción, marca o categoría). Tolera acentos y errores de dedo. Regresa id, nombre, descripción, precio, existencias y categoría.",
        {
            "texto": {"type": "string", "description": "Lo que busca el cliente, por ejemplo 'audífonos inalámbricos' o 'vinilo rock'."},
            "categoria_id": {"type": ["string", "null"], "description": "Id de categoría para filtrar, o null para buscar en toda la tienda."},
        },
    ),
    _herramienta("listar_categorias", "Lista las categorías de la tienda con su id y descripción.", {}),
    _herramienta(
        "ver_producto",
        "Detalle de un producto por id: precio, existencias, descripción y calificación promedio de sus reseñas.",
        {"producto_id": {"type": "string", "description": "Id del producto."}},
    ),
    _herramienta(
        "mis_pedidos",
        "Lista los pedidos del cliente con sesión iniciada: número, fecha, estado, total, método de pago y guía de envío.",
        {},
    ),
    _herramienta(
        "ver_pedido",
        "Detalle de un pedido del cliente con sesión iniciada: productos, desglose del total, pago y envío.",
        {"pedido_id": {"type": "string", "description": "Número del pedido, sin el símbolo #."}},
    ),
    _herramienta("tipo_de_cambio", "Tipo de cambio peso-dólar del día (Banco de México).", {}),
]

# Las mismas herramientas en el formato de Gemini (JSON Schema).
DECLARACIONES_GEMINI = [
    gtipos.FunctionDeclaration(name=h["name"], description=h["description"], parameters_json_schema=h["input_schema"])
    for h in HERRAMIENTAS
]
_BLOQUEOS_GEMINI = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"}
# Modelos Flash estables ("gemini-2.5-flash", "gemini-3-flash"...): los del plan gratuito.
_FLASH_ESTABLE = re.compile(r"^gemini-(\d+(?:\.\d+)?)-flash$")
_NO_CHAT = ("image", "tts", "audio", "live", "embedding", "thinking")

MENSAJE_RECHAZO = "Perdón, no puedo ayudarte con eso. ¿Te ayudo a encontrar algún disco, audífono o instrumento?"


PAUSA_SIN_IA_S = 600  # sin saldo o llave inválida: se reintenta Claude cada 10 minutos

_PALABRAS_DOLAR = ("dolar", "usd", "tipo de cambio")
_PALABRAS_PEDIDO = ("pedido", "orden", "mis compras", "envio", "guia", "paquete", "rastreo")
_RELLENO = set(
    "hola buenas buenos dias tardes noches quiero quisiera busco buscando tienen tienes tiene hay venden vendes "
    "me mi mis un una unos unas el la los las lo de del al a en con por para que como cual cuales algo algun "
    "alguna algunos algunas recomiendas recomienda recomiendame recomendar favor gracias porfa porfavor "
    "y o u ver mostrar muestrame ensename precio precios cuanto cuesta cuestan barato barata baratos "
    "bueno buena buenos buenas mejor mejores necesito ocupo regalo regalar".split()
)


def _normalizar(texto: str) -> str:
    sin_acentos = unicodedata.normalize("NFD", texto.lower())
    return "".join(c for c in sin_acentos if unicodedata.category(c) != "Mn")


def _es_falta_de_saldo(err: anthropic.APIStatusError) -> bool:
    mensaje = str(err).lower()
    return "credit balance" in mensaje or "billing" in mensaje


class _SinIA(Exception):
    """Claude no está disponible para este mensaje; se usa el modo básico."""

    def __init__(self, pausa: bool):
        super().__init__("sin IA")
        self.pausa = pausa


class ErrorAgente(Exception):
    """Error que se le puede mostrar al cliente, con su código HTTP."""

    def __init__(self, mensaje: str, status: int = 503):
        super().__init__(mensaje)
        self.status = status


def _tarjeta(p: dict[str, Any]) -> dict[str, Any]:
    """Lo que necesita la web para mostrar (y agregar al carrito) un producto."""
    return {k: p.get(k) for k in ("id", "nombre", "precio", "stock", "imagen")}


class Agente:
    def __init__(
        self,
        db: AsyncDatabase,
        tienda: ClienteTienda,
        cliente: anthropic.AsyncAnthropic | None = None,
        gemini: genai.Client | None = None,
    ):
        self.db = db
        self.tienda = tienda
        self.cliente = cliente
        self.gemini = gemini
        self.modelo_gemini = config().gemini_modelo
        self._modelo_gemini_resuelto = False
        self._pausa_hasta = 0.0

    # ------------------------------------------------------------ herramientas
    async def _ejecutar(self, nombre: str, entrada: dict[str, Any], token: str | None, productos: list[dict]) -> Any:
        if nombre == "buscar_productos":
            r = await self.tienda.buscar_productos(entrada["texto"], entrada.get("categoria_id"))
            encontrados = r["productos"][:8]
            productos.extend(_tarjeta(p) for p in encontrados)
            return {"total": r["total"], "aproximada": r["aproximada"], "productos": encontrados}
        if nombre == "listar_categorias":
            return await self.tienda.categorias()
        if nombre == "ver_producto":
            p = await self.tienda.producto(entrada["producto_id"])
            if not p or not p.get("activo", True):
                return {"error": "No existe ese producto."}
            productos.append(_tarjeta(p))
            return {**p, "resenas": await resenas.resumen(self.db, str(p["id"]))}
        if nombre in ("mis_pedidos", "ver_pedido"):
            if not token:
                return {"error": "El cliente no tiene la sesión iniciada."}
            if nombre == "mis_pedidos":
                return (await self.tienda.mis_pedidos(token))[:10]
            pedido = await self.tienda.pedido(entrada["pedido_id"].lstrip("#"), token)
            return pedido or {"error": "No existe ese pedido entre los del cliente."}
        if nombre == "tipo_de_cambio":
            return await self.tienda.tipo_cambio() or {"error": "El tipo de cambio no está disponible ahora."}
        return {"error": f"Herramienta desconocida: {nombre}"}

    async def _resultado(self, bloque: Any, token: str | None, productos: list[dict]) -> dict[str, Any]:
        try:
            contenido = await self._ejecutar(bloque.name, bloque.input, token, productos)
            return {"type": "tool_result", "tool_use_id": bloque.id, "content": json.dumps(contenido, ensure_ascii=False)}
        except ErrorTienda as err:
            return {"type": "tool_result", "tool_use_id": bloque.id, "content": str(err), "is_error": True}

    async def _resultado_gemini(self, llamada: gtipos.FunctionCall, token: str | None, productos: list[dict]) -> gtipos.Part:
        try:
            respuesta = {"resultado": await self._ejecutar(llamada.name, llamada.args or {}, token, productos)}
        except ErrorTienda as err:
            respuesta = {"error": str(err)}
        return gtipos.Part(function_response=gtipos.FunctionResponse(id=llamada.id, name=llamada.name, response=respuesta))

    # ------------------------------------------------------------ Claude
    async def _llamar(self, mensajes: list[dict], con_herramientas: bool = True):
        cfg = config()
        try:
            return await self.cliente.messages.create(
                model=cfg.modelo,
                max_tokens=8000,
                system=SISTEMA,
                tools=HERRAMIENTAS,
                tool_choice={"type": "auto"} if con_herramientas else {"type": "none"},
                messages=mensajes,
                output_config={"effort": cfg.esfuerzo},
                # Caché automática del prefijo (instrucciones + herramientas + historial).
                cache_control={"type": "ephemeral"},
            )
        except anthropic.AuthenticationError as err:
            log.error("Claude rechazó la API key (%s): se usa el modo básico.", err)
            raise _SinIA(pausa=True) from err
        except anthropic.BadRequestError as err:
            if _es_falta_de_saldo(err):
                log.warning("La cuenta de Claude no tiene saldo: se usa el modo básico.")
                raise _SinIA(pausa=True) from err
            log.error("Petición inválida a Claude: %s", err)
            raise ErrorAgente("El asistente no pudo procesar el mensaje. Empieza una conversación nueva.", 400) from err
        except anthropic.PermissionDeniedError as err:
            log.error("Claude negó el acceso (%s): se usa el modo básico.", err)
            raise _SinIA(pausa=True) from err
        except anthropic.APIStatusError as err:
            log.error("Claude respondió %s: se usa el modo básico.", err.status_code)
            raise _SinIA(pausa=err.status_code == 402) from err
        except anthropic.APIConnectionError as err:
            log.error("Claude no respondió (%s): se usa el modo básico.", err)
            raise _SinIA(pausa=False) from err

    async def _con_claude(self, historial: list[dict], texto: str, token: str | None):
        """Respuesta con IA. Regresa (texto, productos, mensajes nuevos, rechazado)."""
        cfg = config()
        nuevos: list[dict] = [{"role": "user", "content": texto}]
        productos: list[dict] = []
        respuesta = None
        for vuelta in range(cfg.max_vueltas_herramientas + 1):
            ultima = vuelta == cfg.max_vueltas_herramientas
            respuesta = await self._llamar(historial + nuevos, con_herramientas=not ultima)
            if respuesta.stop_reason == "refusal":
                # No se guarda el intercambio rechazado: la conversación sigue como antes.
                return MENSAJE_RECHAZO, [], [], True
            nuevos.append(
                {"role": "assistant", "content": [b.model_dump(mode="json", exclude_none=True) for b in respuesta.content]}
            )
            if respuesta.stop_reason != "tool_use":
                break
            llamadas = [b for b in respuesta.content if b.type == "tool_use"]
            # Todas las herramientas de la vuelta en paralelo y sus resultados en UN mensaje.
            resultados = await asyncio.gather(*(self._resultado(b, token, productos) for b in llamadas))
            nuevos.append({"role": "user", "content": list(resultados)})

        texto_respuesta = "".join(b.text for b in respuesta.content if b.type == "text").strip()
        if not texto_respuesta:
            texto_respuesta = "No encontré una buena respuesta. ¿Me lo puedes preguntar de otra forma?"
        return texto_respuesta, productos, nuevos, False

    # ------------------------------------------------------------ Gemini
    async def _resolver_modelo_gemini(self) -> str | None:
        """Elige el Flash estable más nuevo que la llave puede usar (los nombres
        de Google cambian con el tiempo; así el agente no depende de uno fijo)."""
        estables, otros = [], []
        async for m in await self.gemini.aio.models.list(config={"page_size": 200}):
            nombre = (m.name or "").removeprefix("models/")
            if "generateContent" not in (m.supported_actions or []):
                continue
            if v := _FLASH_ESTABLE.match(nombre):
                estables.append((float(v.group(1)), nombre))
            elif "flash" in nombre and not any(x in nombre for x in _NO_CHAT):
                otros.append(nombre)
        if estables:
            return max(estables)[1]
        return sorted(otros)[-1] if otros else None

    async def _llamar_gemini(self, contenidos: list[gtipos.Content], con_herramientas: bool):
        try:
            return await self._generar_gemini(contenidos, con_herramientas)
        except gerrores.ClientError as err:
            if err.code != 404 or self._modelo_gemini_resuelto:
                log.error("Petición inválida a Gemini: %s", err)
                raise ErrorAgente("El asistente no pudo procesar el mensaje. Empieza una conversación nueva.", 400) from err
            # El modelo configurado no existe para esta llave: se busca uno disponible una vez.
            self._modelo_gemini_resuelto = True
            try:
                nuevo = await self._resolver_modelo_gemini()
            except (gerrores.APIError, httpx.HTTPError):
                nuevo = None
            if not nuevo or nuevo == self.modelo_gemini:
                log.error("Gemini no tiene un modelo Flash disponible para esta llave: %s", err)
                raise ErrorAgente("El asistente no está disponible en este momento.", 503) from err
            log.warning("El modelo %s no existe; se usa %s.", self.modelo_gemini, nuevo)
            self.modelo_gemini = nuevo
            return await self._generar_gemini(contenidos, con_herramientas)

    async def _generar_gemini(self, contenidos: list[gtipos.Content], con_herramientas: bool):
        try:
            return await self.gemini.aio.models.generate_content(
                model=self.modelo_gemini,
                contents=contenidos,
                config=gtipos.GenerateContentConfig(
                    system_instruction=SISTEMA,
                    tools=[gtipos.Tool(function_declarations=DECLARACIONES_GEMINI)],
                    tool_config=gtipos.ToolConfig(
                        function_calling_config=gtipos.FunctionCallingConfig(mode="AUTO" if con_herramientas else "NONE")
                    ),
                    # Las herramientas se ejecutan aquí (con la sesión del cliente), no en la SDK.
                    automatic_function_calling=gtipos.AutomaticFunctionCallingConfig(disable=True),
                    max_output_tokens=4096,
                ),
            )
        except gerrores.ClientError as err:
            mensaje = str(err).lower()
            if err.code in (401, 403) or "api key" in mensaje:
                log.error("Gemini rechazó la llave (%s): se usa el modo básico.", err.code)
                raise _SinIA(pausa=True) from err
            if err.code == 429:
                log.warning("Se agotó la cuota gratuita de Gemini por ahora: se usa el modo básico.")
                raise _SinIA(pausa=False) from err
            if err.code == 404 and not self._modelo_gemini_resuelto:
                raise
            log.error("Petición inválida a Gemini: %s", err)
            raise ErrorAgente("El asistente no pudo procesar el mensaje. Empieza una conversación nueva.", 400) from err
        except (gerrores.APIError, httpx.HTTPError) as err:
            log.error("Gemini no respondió (%s): se usa el modo básico.", err)
            raise _SinIA(pausa=False) from err

    async def _con_gemini(self, historial: list[dict], texto: str, token: str | None):
        """Respuesta con Gemini. Regresa (texto, productos, mensajes nuevos, rechazado)."""
        cfg = config()
        previos = [gtipos.Content.model_validate(m) for m in historial]
        nuevos = [gtipos.Content(role="user", parts=[gtipos.Part(text=texto)])]
        productos: list[dict] = []
        respuesta = None
        for vuelta in range(cfg.max_vueltas_herramientas + 1):
            ultima = vuelta == cfg.max_vueltas_herramientas
            respuesta = await self._llamar_gemini(previos + nuevos, con_herramientas=not ultima)
            candidato = respuesta.candidates[0] if respuesta.candidates else None
            razon = str(getattr(candidato, "finish_reason", None) or "").split(".")[-1]
            if candidato is None or razon in _BLOQUEOS_GEMINI:
                return MENSAJE_RECHAZO, [], [], True
            if candidato.content is None or not candidato.content.parts:
                break
            # El contenido completo del modelo (con sus firmas de pensamiento) va al historial.
            nuevos.append(candidato.content)
            llamadas = [p.function_call for p in candidato.content.parts if p.function_call]
            if not llamadas:
                break
            resultados = await asyncio.gather(*(self._resultado_gemini(f, token, productos) for f in llamadas))
            nuevos.append(gtipos.Content(role="user", parts=list(resultados)))

        partes = (respuesta.candidates[0].content.parts or []) if respuesta and respuesta.candidates and respuesta.candidates[0].content else []
        texto_respuesta = "".join(p.text for p in partes if p.text and not p.thought).strip()
        if not texto_respuesta:
            texto_respuesta = "No encontré una buena respuesta. ¿Me lo puedes preguntar de otra forma?"
        guardar = [c.model_dump(mode="json", exclude_none=True) for c in nuevos]
        return texto_respuesta, productos, guardar, False

    # ------------------------------------------------------------ modo básico
    async def _sin_ia(self, texto: str, token: str | None) -> tuple[str, list[dict]]:
        """Respuesta sin IA (sin API key, sin saldo o Claude caído): reglas simples
        sobre las mismas consultas de la tienda. No cuesta nada y nunca inventa datos."""
        t = _normalizar(texto)
        try:
            if any(p in t for p in _PALABRAS_DOLAR):
                tc = await self.tienda.tipo_cambio()
                if tc:
                    return (
                        f"Hoy el dólar está en ${tc['valor']:.2f} pesos ({tc['fuente']}, {tc['fecha']}). "
                        "Es aproximado: en la tienda todo se cobra en pesos.",
                        [],
                    )
            if any(p in t for p in _PALABRAS_PEDIDO):
                if not token:
                    return "Para revisar tus pedidos inicia sesión en /login y vuelve a preguntarme.", []
                pedidos = (await self.tienda.mis_pedidos(token))[:5]
                if not pedidos:
                    return "Todavía no tienes pedidos. Cuando compres algo, aquí te digo cómo va.", []
                lineas = "\n".join(
                    f"- Pedido #{p['id']}: {p['estado']}, ${p['total']:,.2f}"
                    + (f", guía {p['numeroGuia']}" if p.get("numeroGuia") else "")
                    for p in pedidos
                )
                return f"Estos son tus pedidos más recientes:\n{lineas}\nEl detalle completo está en /perfil.", []
            # Se quitan las palabras de relleno; las demás van tal cual (la búsqueda tolera acentos).
            palabras = [w for w in re.findall(r"\w+", texto.lower()) if len(w) > 1 and _normalizar(w) not in _RELLENO]
            r = await self.tienda.buscar_productos((" ".join(palabras) or texto)[:80])
        except ErrorTienda:
            return "Ahora no puedo consultar la tienda. Intenta de nuevo en un momento.", []

        encontrados = r["productos"][:8]
        if not encontrados:
            return (
                "No encontré productos con esas palabras. Prueba con «audífonos», «vinilo» o «guitarra», "
                "o revisa las categorías del menú.",
                [],
            )
        lista = "\n".join(f"- **{p['nombre']}**: ${p['precio']:,.2f}" for p in encontrados[:4])
        return f"Encontré esto en la tienda:\n{lista}\nPuedes agregarlos al carrito desde las tarjetas.", [
            _tarjeta(p) for p in encontrados
        ]

    @property
    def proveedor(self) -> str | None:
        """IA configurada: Gemini primero (gratis), luego Claude."""
        if self.gemini is not None:
            return "gemini"
        if self.cliente is not None:
            return "claude"
        return None

    @property
    def modo(self) -> str:
        return "ia" if self.proveedor and time.monotonic() >= self._pausa_hasta else "basico"

    # ------------------------------------------------------------ conversación
    async def responder(self, texto: str, conversacion_id: str | None, usuario: dict | None, token: str | None) -> dict[str, Any]:
        cfg = config()
        usuario_id = str(usuario["id"]) if usuario else None

        doc = None
        if conversacion_id:
            doc = await self.db.conversaciones.find_one({"_id": conversacion_id})
            # Una conversación ajena se trata como inexistente.
            if doc and doc.get("usuarioId") not in (None, usuario_id):
                doc = None
        if doc and doc["turnos"] >= cfg.max_turnos_conversacion:
            raise ErrorAgente("Esta conversación ya es muy larga. Empieza una nueva con el botón ↺.", 409)

        proveedor = self.proveedor
        # El historial de un proveedor no sirve para el otro: si cambió, se empieza de cero.
        mismo = doc is not None and doc.get("proveedor", "claude") == proveedor
        historial: list[dict] = doc["mensajes"] if mismo else []
        modo = self.modo
        if modo == "ia":
            responder_con = self._con_gemini if proveedor == "gemini" else self._con_claude
            try:
                texto_respuesta, productos, nuevos, rechazado = await responder_con(historial, texto, token)
            except _SinIA as err:
                if err.pausa:
                    # Sin saldo o sin permiso: no se vuelve a intentar Claude en un rato.
                    self._pausa_hasta = time.monotonic() + PAUSA_SIN_IA_S
                modo = "basico"
        if modo == "basico":
            # Los turnos sin IA solo van a la vista: el historial de Claude queda intacto.
            texto_respuesta, productos = await self._sin_ia(texto, token)
            nuevos, rechazado = [], False

        # Tarjetas sin repetir y solo de productos con existencias.
        vistos, tarjetas = set(), []
        for p in productos:
            if p["id"] not in vistos and (p.get("stock") or 0) > 0:
                vistos.add(p["id"])
                tarjetas.append(p)
        tarjetas = tarjetas[:4]

        ahora = datetime.now(UTC)
        vista = [{"rol": "cliente", "texto": texto}, {"rol": "asistente", "texto": texto_respuesta, "productos": tarjetas}]
        if doc is None:
            conversacion_id = str(uuid4())
            await self.db.conversaciones.insert_one(
                {
                    "_id": conversacion_id,
                    "usuarioId": usuario_id,
                    "proveedor": proveedor,
                    "mensajes": nuevos,
                    "vista": vista,
                    "turnos": 0 if rechazado else 1,
                    "creadaEn": ahora,
                    "actualizadaEn": ahora,
                }
            )
        else:
            cambios: dict[str, Any] = {
                "$push": {"vista": {"$each": vista}},
                "$inc": {"turnos": 0 if rechazado else 1},
                "$set": {"actualizadaEn": ahora, "usuarioId": doc.get("usuarioId") or usuario_id},
            }
            if mismo or not nuevos:
                cambios["$push"]["mensajes"] = {"$each": nuevos}
            else:
                # Cambió el proveedor de IA: su historial empieza con este turno.
                cambios["$set"].update(mensajes=nuevos, proveedor=proveedor)
            # `turnos` en el filtro: si llegaron dos mensajes a la vez, solo se guarda uno.
            r = await self.db.conversaciones.update_one({"_id": doc["_id"], "turnos": doc["turnos"]}, cambios)
            if r.modified_count == 0:
                raise ErrorAgente("Espera a que el asistente termine de responder tu mensaje anterior.", 409)

        return {"conversacionId": conversacion_id, "respuesta": texto_respuesta, "productos": tarjetas, "modo": modo}

    async def historial(self, conversacion_id: str, usuario: dict | None) -> list[dict] | None:
        doc = await self.db.conversaciones.find_one({"_id": conversacion_id}, {"vista": 1, "usuarioId": 1})
        usuario_id = str(usuario["id"]) if usuario else None
        if not doc or doc.get("usuarioId") not in (None, usuario_id):
            return None
        return doc["vista"]
