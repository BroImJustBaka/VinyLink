# VinyLink Agente

Microservicio en **Python (FastAPI)** con dos funciones:

1. **Vinny, el asistente de compras con IA.** Usa la API de **Gemini**
   (Google AI Studio, plan gratuito, modelo `gemini-flash-latest`) con
   herramientas (*function calling*). También funciona con Claude (Anthropic)
   si se configura `ANTHROPIC_API_KEY` en lugar de `GEMINI_API_KEY`. Busca en el catálogo
   real, explica productos, convierte precios a dólares con el tipo de cambio
   de Banxico y, si el cliente inició sesión, consulta el estado de sus pedidos.
2. **Reseñas de productos.** Calificación de 1 a 5 estrellas, con la etiqueta
   "compra verificada" cuando el cliente tiene un pedido pagado de ese producto.

Las conversaciones y las reseñas viven en **MongoDB**; los productos, pedidos y
usuarios siguen en PostgreSQL y se consultan a través del backend GraphQL.

```
navegador ──► web (Astro) /api/agente/* ──► agente (FastAPI) ──► Gemini API
              cookie sid → Bearer            │        ▲
              + X-Clave-Interna              │        └── herramientas
                                             ├──► backend GraphQL (Node + Postgres)
                                             └──► MongoDB (conversaciones, reseñas)
```

## Cómo trabaja el agente

`app/agente.py` hace el ciclo de herramientas a mano con la SDK oficial
(`google-genai`, con la ejecución automática de funciones desactivada; o
`anthropic` si se usa Claude):

- Herramientas (JSON Schema): `buscar_productos`, `listar_categorias`,
  `ver_producto`, `mis_pedidos`, `ver_pedido` y `tipo_de_cambio`.
- Las herramientas de pedidos llaman al backend **con el token de sesión del
  cliente**, así que el backend aplica los mismos permisos que en la tienda:
  un cliente nunca ve pedidos ajenos, y sin sesión no ve ninguno.
- Máximo 6 vueltas de herramientas por mensaje; en la última se fuerza una
  respuesta en texto (modo de funciones `NONE`).
- El historial se guarda completo (incluidas las firmas de pensamiento, sin
  modificar) para que la conversación continúe. Se borra a los 30 días (índice TTL).
  Si se cambia de proveedor de IA, la conversación sigue pero su historial para
  el modelo empieza de nuevo.
- Límite de 20 mensajes cada 5 minutos por persona.

## API

Todas las rutas (menos `/salud`) piden el encabezado `X-Clave-Interna`; solo el
proxy de la web la conoce. La sesión del cliente llega como `Authorization: Bearer <sid>`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/salud` | Estado de MongoDB, proveedor de IA y modo |
| POST | `/chat` | `{mensaje, conversacionId?}` → `{conversacionId, respuesta, productos}` |
| GET | `/chat/{id}` | Historial de una conversación propia |
| GET | `/productos/{id}/resenas` | Promedio, total, conteo por estrella y reseñas |
| POST | `/productos/{id}/resenas` | Crea o reemplaza la reseña propia (sesión) |
| DELETE | `/productos/{id}/resenas/mia` | Borra la reseña propia (sesión) |

## Correr en local

```powershell
cd agente
py -3.13 -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
copy .env.example .env      # y llena GEMINI_API_KEY, MONGODB_URI, AGENTE_CLAVE_INTERNA
.venv\Scripts\uvicorn app.main:app --port 8000 --reload
```

Documentación interactiva en http://localhost:8000/docs.

**Modo básico (sin costo):** si no hay llave de IA, la llave es inválida, se agota la
cuota gratuita de Gemini (o el saldo de Claude) o la API falla, el chat no se rompe: contesta con reglas
simples sobre las mismas consultas (busca en el catálogo, da el tipo de cambio y
lista los pedidos del cliente) y la respuesta trae `"modo": "basico"`. Sin saldo o
con llave inválida vuelve a intentar con la IA cada 10 minutos. `/salud` muestra el
modo actual. El plan gratuito de Gemini no pide tarjeta; Claude es prepagado.

## Pruebas

```powershell
.venv\Scripts\python -m pytest
```

No necesitan internet, llaves ni MongoDB: levantan un servidor que imita las
APIs de Gemini y Claude y el backend GraphQL, y usan MongoDB en memoria
(`mongomock`). Revisan la forma exacta de las peticiones (modelo, herramientas,
historial con firmas de pensamiento), los permisos de pedidos, los bloqueos,
el límite de mensajes, llaves inválidas, cuota agotada y el modo básico, y el
ciclo completo de reseñas (29 pruebas).
