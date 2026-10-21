// Inventario: kárdex de movimientos, entradas de mercancía, ajustes y
// proveedores. Todo exige el permiso "inventario".
export const typeDefs = `#graphql
  "Un renglón del kárdex: un cambio en el stock de un producto."
  type MovimientoInventario {
    id: ID!
    producto: Producto!
    "inicial, entrada, ajuste, venta, cancelacion o reembolso."
    tipo: String!
    "Positiva si entró mercancía, negativa si salió."
    cantidad: Int!
    "Stock del producto justo después del movimiento."
    stockResultante: Int!
    pedidoId: ID
    proveedor: Proveedor
    costoUnitario: Float
    "Quién lo hizo (null = el sistema)."
    usuario: Usuario
    motivo: String
    creadoEn: String!
  }

  type MovimientoPagina {
    items: [MovimientoInventario!]!
    total: Int!
  }

  type Proveedor {
    id: ID!
    nombre: String!
    contacto: String
    email: String
    telefono: String
    notas: String
    activo: Boolean!
    "Entradas de mercancía registradas con este proveedor."
    entradas: Int!
    "Piezas recibidas en total."
    piezas: Int!
    ultimaEntrada: String
    creadoEn: String!
  }

  input ProveedorInput {
    nombre: String!
    contacto: String
    email: String
    telefono: String
    notas: String
    activo: Boolean
  }

  "Valor del inventario (piezas × precio de venta) y alertas."
  type ResumenInventario {
    productos: Int!
    piezas: Int!
    valorVenta: Float!
    agotados: Int!
    "Productos activos con stock en su mínimo o debajo."
    bajoMinimo: Int!
  }

  extend type Producto {
    "Últimos movimientos del producto (solo personal con permiso de inventario)."
    movimientos(limite: Int = 20): [MovimientoInventario!]!
  }

  extend type Query {
    adminMovimientos(productoId: ID, tipo: String, limite: Int = 30, offset: Int = 0): MovimientoPagina!
    adminResumenInventario: ResumenInventario!
    proveedores(incluirInactivos: Boolean = false): [Proveedor!]!
    proveedor(id: ID!): Proveedor
  }

  extend type Mutation {
    "Llegó mercancía: suma piezas al stock (opcionalmente de un proveedor y con su costo)."
    registrarEntrada(productoId: ID!, cantidad: Int!, proveedorId: ID, costoUnitario: Float, motivo: String): MovimientoInventario!
    "Corrige el stock a un número exacto (conteo físico, merma, daño...). El motivo es obligatorio."
    ajustarStock(productoId: ID!, stockNuevo: Int!, motivo: String!): MovimientoInventario!
    crearProveedor(data: ProveedorInput!): Proveedor!
    actualizarProveedor(id: ID!, data: ProveedorInput!): Proveedor!
  }
`;
