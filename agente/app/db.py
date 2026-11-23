"""Conexión a MongoDB (driver asíncrono oficial de PyMongo).

Colecciones:
  conversaciones  una por chat con el asistente: dueño, mensajes (con los
                  bloques de Claude tal cual, para poder continuar la plática)
                  y la fecha de la última actividad.
  resenas         una reseña por cliente y producto: calificación, título,
                  texto y si es compra verificada.

¿Por qué Mongo y no PostgreSQL? Los mensajes del asistente son documentos con
forma variable (texto, llamadas a herramientas, resultados) que se leen y
guardan completos; en Mongo se guardan tal cual, sin tablas intermedias.
"""

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

# Las conversaciones sin actividad se borran solas a los 30 días (índice TTL).
DIAS_CONVERSACION = 30


async def crear_indices(db: AsyncDatabase) -> None:
    await db.conversaciones.create_index(
        [("actualizadaEn", ASCENDING)], expireAfterSeconds=DIAS_CONVERSACION * 24 * 3600, name="ttl_actividad"
    )
    await db.conversaciones.create_index([("usuarioId", ASCENDING), ("actualizadaEn", DESCENDING)], name="por_usuario")
    # Una reseña por cliente y producto (la segunda la reemplaza).
    await db.resenas.create_index([("productoId", ASCENDING), ("usuarioId", ASCENDING)], unique=True, name="una_por_cliente")
    await db.resenas.create_index([("productoId", ASCENDING), ("creadaEn", DESCENDING)], name="por_producto")


def conectar(uri: str) -> AsyncMongoClient:
    # serverSelectionTimeoutMS corto: si Mongo no está, el error llega rápido.
    return AsyncMongoClient(uri, serverSelectionTimeoutMS=5000, tz_aware=True, appname="vinylink-agente")
