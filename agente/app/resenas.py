"""Reseñas de productos (MongoDB, colección `resenas`)."""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator
from pymongo.asynchronous.database import AsyncDatabase

from .tienda import ClienteTienda, ErrorTienda

# Estados en los que un pedido cuenta como compra hecha.
ESTADOS_COMPRADO = {"pagado", "enviado", "entregado"}


class NuevaResena(BaseModel):
    calificacion: int = Field(ge=1, le=5)
    titulo: str = Field(min_length=3, max_length=80)
    texto: str = Field(min_length=10, max_length=1000)

    @field_validator("titulo", "texto")
    @classmethod
    def limpiar(cls, valor: str) -> str:
        # Espacios de más fuera; el texto se muestra escapado (React), no como HTML.
        return " ".join(valor.split()) if "\n" not in valor else valor.strip()


def _nombre_publico(nombre: str) -> str:
    """'Ana María López' → 'Ana María L.' (no se publica el apellido completo)."""
    partes = nombre.split()
    if len(partes) < 2:
        return nombre
    return f"{' '.join(partes[:-1])} {partes[-1][0]}."


def _vista(doc: dict[str, Any], usuario_id: str | None = None) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "autor": doc["autor"],
        "calificacion": doc["calificacion"],
        "titulo": doc["titulo"],
        "texto": doc["texto"],
        "compraVerificada": doc.get("compraVerificada", False),
        "fecha": doc["creadaEn"].isoformat(),
        "esMia": usuario_id is not None and doc["usuarioId"] == usuario_id,
    }


async def resumen(db: AsyncDatabase, producto_id: str) -> dict[str, Any]:
    """Promedio, total y cuántas reseñas hay de cada estrella."""
    filas = await (
        await db.resenas.aggregate(
            [{"$match": {"productoId": producto_id}}, {"$group": {"_id": "$calificacion", "n": {"$sum": 1}}}]
        )
    ).to_list()
    por_estrella = {str(i): 0 for i in range(1, 6)}
    for f in filas:
        por_estrella[str(f["_id"])] = f["n"]
    total = sum(por_estrella.values())
    suma = sum(int(k) * v for k, v in por_estrella.items())
    return {"promedio": round(suma / total, 1) if total else None, "total": total, "porEstrella": por_estrella}


async def listar(db: AsyncDatabase, producto_id: str, usuario_id: str | None = None, limite: int = 20) -> dict[str, Any]:
    cursor = db.resenas.find({"productoId": producto_id}).sort("creadaEn", -1).limit(limite)
    resenas = [_vista(d, usuario_id) for d in await cursor.to_list()]
    return {**await resumen(db, producto_id), "resenas": resenas}


async def guardar(
    db: AsyncDatabase, tienda: ClienteTienda, producto_id: str, usuario: dict[str, Any], token: str, datos: NuevaResena
) -> dict[str, Any]:
    if await tienda.producto(producto_id) is None:
        raise LookupError("No existe ese producto")
    # Compra verificada: el cliente tiene un pedido pagado con ese producto.
    try:
        pedidos = await tienda.mis_pedidos(token)
    except ErrorTienda:
        pedidos = []
    verificada = any(
        p["estado"] in ESTADOS_COMPRADO and any(d["producto"]["id"] == producto_id for d in p["detalles"]) for p in pedidos
    )
    ahora = datetime.now(UTC)
    await db.resenas.update_one(
        {"productoId": producto_id, "usuarioId": str(usuario["id"])},
        {
            "$set": {
                "autor": _nombre_publico(usuario["nombre"]),
                "calificacion": datos.calificacion,
                "titulo": datos.titulo,
                "texto": datos.texto,
                "compraVerificada": verificada,
                "actualizadaEn": ahora,
            },
            "$setOnInsert": {"creadaEn": ahora},
        },
        upsert=True,
    )
    return await listar(db, producto_id, str(usuario["id"]))


async def borrar(db: AsyncDatabase, producto_id: str, usuario_id: str) -> bool:
    r = await db.resenas.delete_one({"productoId": producto_id, "usuarioId": usuario_id})
    return r.deleted_count == 1
