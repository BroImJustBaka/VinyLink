// Bandeja de salida de correos (permiso "correos").
export const typeDefs = `#graphql
  type Correo {
    id: ID!
    para: String!
    asunto: String!
    "HTML completo del correo (para la vista previa del panel)."
    html: String!
    "pedido.pagado, pedido.enviado, cuenta.restablecer..."
    tipo: String!
    pedidoId: ID
    "pendiente, enviado, simulado o error."
    estado: String!
    error: String
    creadoEn: String!
    enviadoEn: String
  }

  type CorreoPagina {
    items: [Correo!]!
    total: Int!
    "true si hay servidor SMTP configurado (los correos salen de verdad)."
    envioReal: Boolean!
  }

  extend type Query {
    adminCorreos(buscar: String, limite: Int = 30, offset: Int = 0): CorreoPagina!
    adminCorreo(id: ID!): Correo
  }

  extend type Mutation {
    reenviarCorreo(id: ID!): Correo!
  }
`;
