// Subscriptions de GraphQL: el servidor EMPUJA los cambios al navegador por
// WebSocket (protocolo graphql-ws) en vez de que la página pregunte cada
// tantos segundos. Endpoint: ws://<backend>/graphql
export const typeDefs = `#graphql
  "Aviso en tiempo real para el panel."
  type EventoAdmin {
    "pedido_nuevo, pago_recibido, pedido_cancelado, reembolso, stock_bajo o accion."
    tipo: String!
    mensaje: String!
    pedidoId: ID
    productoId: ID
    "Quién lo provocó (para no mostrarle su propio aviso)."
    usuarioId: ID
    fecha: String!
  }

  extend type Mutation {
    """
    Ticket de un solo uso (vence en 60 s) para abrir el WebSocket con la sesión
    actual: se manda como connectionParams.ticket. Requiere sesión.
    """
    ticketTiempoReal: String!
  }

  type Subscription {
    """
    Cambios de un pedido: estado, pago, guía, notas. Un cliente solo puede
    seguir sus propios pedidos (con id); el personal puede omitir el id para
    recibir los de toda la tienda.
    """
    pedidoActualizado(id: ID): Pedido!
    "Stock, precio o disponibilidad de un producto (o de todos sin id). Público."
    stockActualizado(productoId: ID): Producto!
    "Avisos para el personal: pedidos nuevos, pagos, stock bajo y acciones de otros."
    eventosAdmin: EventoAdmin!
  }
`;
