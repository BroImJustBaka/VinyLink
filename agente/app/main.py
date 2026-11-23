"""Microservicio VinyLink Agente (FastAPI).

Rutas (todas reciben la sesión del cliente como `Authorization: Bearer <sid>`,
que agrega el proxy de la web; sin ella el cliente es anónimo):

  GET    /salud                         estado del servicio, Mongo y Claude
  POST   /chat                          manda un mensaje al asistente
  GET    /chat/{id}                     historial de una conversación (para la vista)
  GET    /productos/{id}/resenas        reseñas y calificación promedio
  POST   /productos/{id}/resenas        crea o reemplaza la reseña propia (sesión)
  DELETE /productos/{id}/resenas/mia    borra la reseña propia (sesión)
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Annotated

import anthropic
import httpx
from google import genai
from google.genai import types as gtipos
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import resenas
from .agente import Agente, ErrorAgente
from .config import config
from .db import conectar, crear_indices
from .tienda import ClienteTienda

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("agente")


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    cfg = config()
    mongo = conectar(cfg.mongodb_uri)
    db = mongo[cfg.mongodb_db]
    try:
        await crear_indices(db)
    except Exception as err:  # Mongo caído: el servicio arranca y /salud lo reporta
        log.error("No se pudo preparar MongoDB: %s", err)
    http = httpx.AsyncClient(timeout=10)
    gemini = (
        genai.Client(
            api_key=cfg.gemini_api_key,
            http_options=gtipos.HttpOptions(
                api_version="v1beta", timeout=60_000, retry_options=gtipos.HttpRetryOptions(attempts=2)
            ),
        )
        if cfg.gemini_api_key
        else None
    )
    cliente = anthropic.AsyncAnthropic(timeout=60, max_retries=2) if cfg.anthropic_api_key and not gemini else None
    if gemini is None and cliente is None:
        log.warning("Sin GEMINI_API_KEY ni ANTHROPIC_API_KEY: el chat contesta en modo básico (sin IA).")
    app.state.db = db
    app.state.tienda = ClienteTienda(http)
    app.state.agente = Agente(db, app.state.tienda, cliente, gemini)
    app.state.limites = defaultdict(deque)
    yield
    await http.aclose()
    if cliente is not None:
        await cliente.close()
    if gemini is not None:
        await gemini.aio.aclose()
    await mongo.close()


app = FastAPI(title="VinyLink Agente", version="1.0.0", lifespan=ciclo_de_vida)


@app.exception_handler(ErrorAgente)
async def _error_agente(_request: Request, err: ErrorAgente):
    return JSONResponse({"detail": str(err)}, status_code=err.status)


# ------------------------------------------------------------ dependencias
def clave_interna(x_clave_interna: Annotated[str | None, Header()] = None) -> None:
    """Solo el proxy de la web (que conoce la clave) puede llamar al servicio."""
    esperada = config().agente_clave_interna
    if esperada and x_clave_interna != esperada:
        raise HTTPException(status_code=401, detail="No autorizado")


def token_de(authorization: Annotated[str | None, Header()] = None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip() or None
    return None


async def usuario_actual(request: Request, token: Annotated[str | None, Depends(token_de)]) -> dict | None:
    return await request.app.state.tienda.usuario(token)


def limitar(request: Request, usuario: dict | None, x_cliente_ip: str | None) -> None:
    """Máximo N mensajes por persona en la ventana (protege el gasto en Claude)."""
    cfg = config()
    clave = f"u{usuario['id']}" if usuario else f"ip{x_cliente_ip or (request.client.host if request.client else '?')}"
    ahora = time.monotonic()
    marcas: deque = request.app.state.limites[clave]
    while marcas and ahora - marcas[0] > cfg.ventana_limite_segundos:
        marcas.popleft()
    if len(marcas) >= cfg.limite_mensajes:
        raise HTTPException(status_code=429, detail="Mandaste muchos mensajes seguidos. Espera unos minutos.")
    marcas.append(ahora)


Protegido = Depends(clave_interna)
Usuario = Annotated[dict | None, Depends(usuario_actual)]
Token = Annotated[str | None, Depends(token_de)]


def exigir_sesion(usuario: dict | None) -> dict:
    if usuario is None:
        raise HTTPException(status_code=401, detail="Necesitas iniciar sesión")
    return usuario




# ------------------------------------------------------------ rutas
@app.get("/salud")
async def salud(request: Request):
    try:
        # Límite corto: el chequeo de salud de Render espera 5 s como máximo.
        await asyncio.wait_for(request.app.state.db.command("ping"), timeout=2.5)
        mongo = True
    except Exception:
        mongo = False
    agente = request.app.state.agente
    cfg = config()
    modelo = {"gemini": agente.modelo_gemini, "claude": cfg.modelo}.get(agente.proveedor)
    return {"ok": mongo, "mongo": mongo, "ia": agente.proveedor, "modo": agente.modo, "modelo": modelo}


class MensajeChat(BaseModel):
    mensaje: str = Field(min_length=1, max_length=1000)
    conversacionId: str | None = Field(default=None, max_length=64)


@app.post("/chat", dependencies=[Protegido])
async def chat(
    datos: MensajeChat,
    request: Request,
    usuario: Usuario,
    token: Token,
    x_cliente_ip: Annotated[str | None, Header()] = None,
):
    limitar(request, usuario, x_cliente_ip)
    return await request.app.state.agente.responder(datos.mensaje.strip(), datos.conversacionId, usuario, token if usuario else None)


@app.get("/chat/{conversacion_id}", dependencies=[Protegido])
async def ver_chat(conversacion_id: str, request: Request, usuario: Usuario):
    vista = await request.app.state.agente.historial(conversacion_id, usuario)
    if vista is None:
        raise HTTPException(status_code=404, detail="No existe esa conversación")
    return {"conversacionId": conversacion_id, "mensajes": vista}


def _validar_producto(producto_id: str) -> str:
    if not producto_id.isdigit() or len(producto_id) > 9:
        raise HTTPException(status_code=404, detail="No existe ese producto")
    return producto_id


@app.get("/productos/{producto_id}/resenas", dependencies=[Protegido])
async def ver_resenas(producto_id: str, request: Request, usuario: Usuario):
    pid = _validar_producto(producto_id)
    return await resenas.listar(request.app.state.db, pid, str(usuario["id"]) if usuario else None)


@app.post("/productos/{producto_id}/resenas", dependencies=[Protegido])
async def crear_resena(producto_id: str, datos: resenas.NuevaResena, request: Request, usuario: Usuario, token: Token):
    pid = _validar_producto(producto_id)
    u = exigir_sesion(usuario)
    try:
        return await resenas.guardar(request.app.state.db, request.app.state.tienda, pid, u, token, datos)
    except LookupError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err


@app.delete("/productos/{producto_id}/resenas/mia", dependencies=[Protegido])
async def borrar_resena(producto_id: str, request: Request, usuario: Usuario):
    pid = _validar_producto(producto_id)
    u = exigir_sesion(usuario)
    if not await resenas.borrar(request.app.state.db, pid, str(u["id"])):
        raise HTTPException(status_code=404, detail="No tienes una reseña de este producto")
    return await resenas.listar(request.app.state.db, pid, str(u["id"]))
