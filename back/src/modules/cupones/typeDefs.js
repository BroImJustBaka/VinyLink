// Cupones de descuento. El cliente los escribe en el checkout
// (PedidoInput.cupon); el personal con permiso "cupones" los administra.
export const typeDefs = `#graphql
  type Cupon {
    id: ID!
    codigo: String!
    descripcion: String
    "porcentaje, monto o envio_gratis."
    tipo: String!
    "Porcentaje (1-100) o pesos, según el tipo. 0 en envio_gratis."
    valor: Float!
    minimoCompra: Float!
    "null = ilimitado."
    usosMaximos: Int
    usosPorCliente: Int
    vigenteDesde: String
    vigenteHasta: String
    activo: Boolean!
    "Pedidos no cancelados que lo usaron."
    usos: Int!
    "Pesos descontados en esos pedidos."
    descuentoTotal: Float!
    creadoEn: String!
  }

  input CuponInput {
    codigo: String!
    descripcion: String
    tipo: String!
    valor: Float
    minimoCompra: Float
    usosMaximos: Int
    usosPorCliente: Int
    vigenteDesde: String
    vigenteHasta: String
    activo: Boolean
  }

  extend type Query {
    adminCupones: [Cupon!]!
  }

  extend type Mutation {
    crearCupon(data: CuponInput!): Cupon!
    actualizarCupon(id: ID!, data: CuponInput!): Cupon!
  }
`;
