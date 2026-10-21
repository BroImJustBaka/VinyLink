// Panel de administración: estadísticas y acciones. Cada operación exige un
// permiso del panel (ver modules/auth/permisos.js).
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
    "Pedidos pagados que falta enviar (sin importar el periodo)."
    pedidosPorEnviar: Int!
    "Clientes registrados en el periodo."
    clientesNuevos: Int!
    "Dinero devuelto en el periodo (reembolsos totales y parciales)."
    reembolsos: Float!
    "Descuentos dados con cupones en el periodo."
    descuentos: Float!
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

  "Ventas agrupadas por categoría (ingresos de los renglones vendidos)."
  type VentaCategoria {
    categoria: Categoria!
    unidades: Int!
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

  type ClientePagina {
    items: [ClienteResumen!]!
    total: Int!
  }

  "Ficha de un cliente para el panel."
  type ClienteDetalle {
    usuario: Usuario!
    creadoEn: String!
    pedidosPagados: Int!
    totalGastado: Float!
    ticketPromedio: Float!
    ultimoPedido: String
    "Todos sus pedidos, del más reciente al más antiguo."
    pedidos: [Pedido!]!
    direcciones: [Direccion!]!
  }

  "Un reembolso hecho desde el panel."
  type Reembolso {
    id: ID!
    monto: Float!
    parcial: Boolean!
    repusoStock: Boolean!
    motivo: String
    "Quién lo hizo."
    autor: String
    creadoEn: String!
  }

  extend type Pedido {
    "Reembolsos del pedido (solo personal)."
    reembolsos: [Reembolso!]!
  }

  "Un renglón de la bitácora de auditoría."
  type RegistroBitacora {
    id: ID!
    usuarioId: ID
    usuarioNombre: String
    "Por ejemplo producto.actualizar, pedido.enviar, usuario.rol."
    accion: String!
    entidad: String!
    entidadId: String
    "Datos del cambio en JSON (por ejemplo { precio: [599, 549] })."
    detalle: String!
    "La acción en palabras: «editó producto #7»."
    descripcion: String!
    creadoEn: String!
  }

  type BitacoraPagina {
    items: [RegistroBitacora!]!
    total: Int!
  }

  extend type Query {
    adminResumen(dias: Int = 30): ResumenVentas!
    "Productos más vendidos por unidades."
    adminTopProductos(dias: Int = 30, limite: Int = 5): [VentaProducto!]!
    "Un renglón por día, incluidos los días sin ventas."
    adminVentasPorDia(dias: Int = 30): [VentaDia!]!
    adminVentasPorMetodo(dias: Int = 30): [VentaMetodo!]!
    adminVentasPorCategoria(dias: Int = 30): [VentaCategoria!]!
    "Productos activos con stock menor o igual al umbral (sin umbral: el stock mínimo de cada producto)."
    adminStockBajo(umbral: Int): [Producto!]!
    "Pedidos con filtros. buscar = número de pedido, nombre o email del cliente."
    adminPedidos(estado: String, metodo: String, buscar: String, limite: Int = 20, offset: Int = 0): PedidoPagina!
    "Usuarios con lo que han comprado. rol filtra (CLIENTE, ADMIN...); bloqueados = solo cuentas bloqueadas."
    adminClientes(buscar: String, rol: Rol, bloqueados: Boolean, limite: Int = 25, offset: Int = 0): ClientePagina!
    adminCliente(id: ID!): ClienteDetalle
    adminBitacora(entidad: String, entidadId: String, usuarioId: ID, buscar: String, limite: Int = 50, offset: Int = 0): BitacoraPagina!
    """
    Reporte en CSV (UTF-8, listo para Excel). tipo: pedidos, productos,
    clientes, movimientos o ventas_dia. desde/hasta (AAAA-MM-DD) filtran por fecha.
    """
    adminExportar(tipo: String!, desde: String, hasta: String): String!
  }

  extend type Mutation {
    """
    Avanza un pedido pagado: pagado → enviado → entregado. Al enviarlo se
    puede indicar la paquetería y el número de guía (le llegan al cliente por correo).
    """
    actualizarEstadoPedido(id: ID!, estado: String!, paqueteria: String, numeroGuia: String): Pedido!
    "Corrige la paquetería o el número de guía de un pedido ya enviado."
    actualizarGuiaPedido(id: ID!, paqueteria: String!, numeroGuia: String!): Pedido!
    """
    Devuelve dinero de un pedido pagado con tarjeta. Sin monto (o con todo lo
    que falta) es total y puede reponer el stock; con un monto menor es parcial.
    """
    reembolsarPedido(id: ID!, reponerStock: Boolean = true, monto: Float, motivo: String): Pedido!
    "Nota interna en un pedido (el cliente no la ve)."
    agregarNotaPedido(pedidoId: ID!, texto: String!): Pedido!
    "Crea un pedido a nombre de un cliente y regresa su link de pago para compartirlo."
    crearLinkDePagoAdmin(usuarioId: ID!, items: [DetallePedidoInput!]!): ResultadoPago!
    "Cambia el rol de otro usuario (no el propio, para no quedarse fuera del panel)."
    cambiarRolUsuario(id: ID!, rol: Rol!): Usuario!
    "Bloquea (o desbloquea) una cuenta: no puede iniciar sesión y se cierran sus sesiones."
    bloquearUsuario(id: ID!, bloqueado: Boolean!): Usuario!
    "Le manda al cliente un correo con un link para elegir una contraseña nueva."
    enviarRestablecimientoCliente(id: ID!): Boolean!
  }
`;
