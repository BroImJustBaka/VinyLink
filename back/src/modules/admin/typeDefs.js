// Panel de administración: estadísticas y acciones. Todo exige rol ADMIN.
// "Venta" = pedido pagado, enviado o entregado (no cuenta pendientes,
// cancelados ni reembolsados). Su fecha es la del pago.
export const typeDefs = `#graphql
  "Indicadores de un periodo (los últimos N días) para el tablero."
  type ResumenVentas {
    ingresos: Float!
    pedidosPagados: Int!
    ticketPromedio: Float!
    unidadesVendidas: Int!
    "Ingresos de los N días anteriores, para comparar."
    ingresosPeriodoAnterior: Float!
    pedidosPeriodoAnterior: Int!
    "Pedidos esperando pago ahora mismo (sin importar el periodo)."
    pedidosPendientes: Int!
    "Clientes registrados en el periodo."
    clientesNuevos: Int!
  }

  "Unidades e ingresos de un producto en el periodo."
  type VentaProducto {
    producto: Producto!
    unidades: Int!
    ingresos: Float!
  }

  "Ventas de un día (fecha AAAA-MM-DD, hora de la Ciudad de México)."
  type VentaDia {
    fecha: String!
    ingresos: Float!
    pedidos: Int!
  }

  "Ventas agrupadas por método de pago."
  type VentaMetodo {
    "credito, debito, oxxo, spei, link o sin_registro (pedidos anteriores a los pagos)."
    metodo: String!
    pedidos: Int!
    ingresos: Float!
  }

  "Página de la lista de pedidos del panel."
  type PedidoPagina {
    items: [Pedido!]!
    total: Int!
  }

  "Un usuario con lo que ha comprado."
  type ClienteResumen {
    usuario: Usuario!
    pedidos: Int!
    totalGastado: Float!
    ultimoPedido: String
    creadoEn: String!
  }

  extend type Query {
    adminResumen(dias: Int = 30): ResumenVentas!
    "Productos más vendidos por unidades."
    adminTopProductos(dias: Int = 30, limite: Int = 5): [VentaProducto!]!
    "Un renglón por día, incluidos los días sin ventas."
    adminVentasPorDia(dias: Int = 30): [VentaDia!]!
    adminVentasPorMetodo(dias: Int = 30): [VentaMetodo!]!
    "Productos con stock menor o igual al umbral."
    adminStockBajo(umbral: Int = 5): [Producto!]!
    "Pedidos con filtros. buscar = número de pedido, nombre o email del cliente."
    adminPedidos(estado: String, metodo: String, buscar: String, limite: Int = 20, offset: Int = 0): PedidoPagina!
    adminClientes: [ClienteResumen!]!
  }

  extend type Mutation {
    "Avanza un pedido pagado: pagado → enviado → entregado."
    actualizarEstadoPedido(id: ID!, estado: String!): Pedido!
    "Devuelve el dinero de un pedido pagado con tarjeta (y opcionalmente el stock)."
    reembolsarPedido(id: ID!, reponerStock: Boolean = true): Pedido!
    "Crea un pedido a nombre de un cliente y regresa su link de pago para compartirlo."
    crearLinkDePagoAdmin(usuarioId: ID!, items: [DetallePedidoInput!]!): ResultadoPago!
    "Cambia el rol de otro usuario (no el propio, para no quedarse fuera del panel)."
    cambiarRolUsuario(id: ID!, rol: Rol!): Usuario!
  }
`;
