"""Cliente del backend GraphQL de la tienda.

El agente NO toca la base de datos de la tienda: pide todo al backend con el
token de sesión del cliente. Así el agente solo puede ver lo que ese cliente
puede ver (sus propios pedidos) y los permisos los sigue revisando el backend.
"""

from typing import Any

import httpx

from .config import config


class ErrorTienda(Exception):
    """El backend respondió con un error de GraphQL o no respondió."""


class ClienteTienda:
    def __init__(self, http: httpx.AsyncClient, url: str | None = None):
        self.http = http
        self.url = url or config().backend_graphql_url

    async def consultar(self, query: str, variables: dict[str, Any] | None = None, token: str | None = None) -> dict[str, Any]:
        cabeceras = {"Content-Type": "application/json"}
        if token:
            cabeceras["Authorization"] = f"Bearer {token}"
        try:
            r = await self.http.post(self.url, json={"query": query, "variables": variables or {}}, headers=cabeceras)
        except httpx.HTTPError as err:
            raise ErrorTienda("No hay conexión con el servidor de la tienda.") from err
        if r.status_code >= 500:
            raise ErrorTienda(f"El servidor de la tienda respondió con un error ({r.status_code}).")
        cuerpo = r.json()
        if cuerpo.get("errors"):
            raise ErrorTienda(cuerpo["errors"][0].get("message", "Error del servidor de la tienda"))
        return cuerpo["data"]

    # ------------------------------------------------------------ sesión
    async def usuario(self, token: str | None) -> dict[str, Any] | None:
        """Usuario dueño del token ({id, nombre, email, rol}) o None."""
        if not token:
            return None
        try:
            datos = await self.consultar("{ me { id nombre email rol } }", token=token)
        except ErrorTienda:
            return None
        return datos.get("me")

    # ------------------------------------------------------------ catálogo
    async def buscar_productos(self, texto: str, categoria_id: str | None = None) -> dict[str, Any]:
        datos = await self.consultar(
            """query($t: String!, $c: ID) {
                 buscar(texto: $t, categoriaId: $c) {
                   total aproximada
                   productos { id nombre descripcion precio stock imagen categoria { id nombre } }
                 }
               }""",
            {"t": texto, "c": categoria_id},
        )
        return datos["buscar"]

    async def categorias(self) -> list[dict[str, Any]]:
        datos = await self.consultar("{ categorias { id nombre descripcion } }")
        return datos["categorias"]

    async def producto(self, producto_id: str) -> dict[str, Any] | None:
        datos = await self.consultar(
            """query($id: ID!) {
                 producto(id: $id) { id nombre descripcion precio stock imagen activo categoria { id nombre } }
               }""",
            {"id": producto_id},
        )
        return datos["producto"]

    async def tipo_cambio(self) -> dict[str, Any] | None:
        datos = await self.consultar("{ tipoCambio { valor fecha fuente } }")
        return datos["tipoCambio"]

    # ------------------------------------------------------------ pedidos
    async def mis_pedidos(self, token: str) -> list[dict[str, Any]]:
        datos = await self.consultar(
            """{ misPedidos { id fecha estado total metodoPago numeroGuia paqueteria
                              detalles { cantidad precioUnitario producto { id nombre } } } }""",
            token=token,
        )
        return datos["misPedidos"]

    async def pedido(self, pedido_id: str, token: str) -> dict[str, Any] | None:
        datos = await self.consultar(
            """query($id: ID!) { pedido(id: $id) {
                 id fecha estado total subtotal descuento costoEnvio iva cupon metodoPago pagadoEn
                 paqueteria numeroGuia enviadoEn entregadoEn
                 envio { ciudad estado cp }
                 detalles { cantidad precioUnitario producto { id nombre } }
                 pago { estado error }
               } }""",
            {"id": pedido_id},
            token=token,
        )
        return datos["pedido"]
