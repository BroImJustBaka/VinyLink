// Dueño: Persona B (carrito y pedidos)
export const typeDefs = `#graphql
  "Un renglón del pedido: un producto con la cantidad comprada."
  type DetallePedido {
    id: ID!
    producto: Producto!
    cantidad: Int!
    precioUnitario: Float!
    subtotal: Float!
  }

  "Pedido registrado por un usuario, con sus renglones."
  type Pedido {
    id: ID!
    fecha: String!
    estado: String!
    total: Float!
    usuario: Usuario!
    detalles: [DetallePedido!]!
  }

  "Un renglón del carrito que se envía al registrar el pedido."
  input DetallePedidoInput {
    productoId: ID!
    cantidad: Int!
  }

  "Datos del comprador y los renglones para registrar un pedido."
  input PedidoInput {
    nombre: String!
    email: String!
    items: [DetallePedidoInput!]!
  }

  "Un renglón del carrito guardado en base de datos."
  type DetalleCarrito {
    id: ID!
    producto: Producto!
    cantidad: Int!
    subtotal: Float!
  }

  "Carrito persistido en base de datos, uno por usuario."
  type Carrito {
    id: ID!
    usuario: Usuario!
    items: [DetalleCarrito!]!
    total: Float!
  }

  extend type Query {
    "Historial de pedidos registrados."
    pedidos: [Pedido!]!
    "Consulta un pedido por su id."
    pedido(id: ID!): Pedido
    "Carrito guardado en base de datos para un usuario (lo crea vacío si no existe)."
    carrito(usuarioId: ID!): Carrito!
  }

  extend type Mutation {
    "Registra un pedido con sus renglones; descuenta el stock de cada producto."
    crearPedido(data: PedidoInput!): Pedido!
    "Agrega un producto al carrito del usuario (suma cantidad si ya estaba)."
    agregarAlCarrito(usuarioId: ID!, productoId: ID!, cantidad: Int = 1): Carrito!
    "Fija la cantidad exacta de un renglón del carrito (lo quita si llega a 0)."
    cambiarCantidadCarrito(usuarioId: ID!, productoId: ID!, cantidad: Int!): Carrito!
    "Quita un producto del carrito por completo."
    quitarDelCarrito(usuarioId: ID!, productoId: ID!): Carrito!
    "Vacía todos los renglones del carrito."
    vaciarCarritoDB(usuarioId: ID!): Carrito!
  }
`;
