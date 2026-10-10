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
    "pendiente, pagado, enviado, entregado, cancelado o reembolsado."
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

  "Renglones para registrar un pedido (ver crearPedido en el módulo pagos)."
  input PedidoInput {
    items: [DetallePedidoInput!]!
  }

  "Un renglón del carrito de invitado que se fusiona al iniciar sesión."
  input ItemCarritoInput {
    productoId: ID!
    cantidad: Int!
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
    "Todos los pedidos de la tienda (solo ADMIN)."
    pedidos: [Pedido!]!
    "Pedidos del usuario con sesión, del más reciente al más antiguo."
    misPedidos: [Pedido!]!
    "Consulta un pedido por id. Solo su dueño o un ADMIN; para cualquier otro regresa null."
    pedido(id: ID!): Pedido
    "Carrito del usuario con sesión (lo crea vacío si no existe)."
    carrito: Carrito!
  }

  extend type Mutation {
    "Agrega un producto al carrito del usuario (suma cantidad si ya estaba)."
    agregarAlCarrito(productoId: ID!, cantidad: Int = 1): Carrito!
    "Fija la cantidad exacta de un renglón del carrito (lo quita si llega a 0)."
    cambiarCantidadCarrito(productoId: ID!, cantidad: Int!): Carrito!
    "Quita un producto del carrito por completo."
    quitarDelCarrito(productoId: ID!): Carrito!
    "Vacía todos los renglones del carrito."
    vaciarCarritoDB: Carrito!
    "Suma los renglones del carrito de invitado al carrito del usuario (respeta el stock)."
    fusionarCarrito(items: [ItemCarritoInput!]!): Carrito!
  }
`;
