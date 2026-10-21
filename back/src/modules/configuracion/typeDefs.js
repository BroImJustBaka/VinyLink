// Configuración de la tienda. Leerla es público (el checkout necesita el
// costo de envío); cambiarla solo lo puede hacer un ADMIN.
export const typeDefs = `#graphql
  type ConfiguracionTienda {
    nombreTienda: String!
    emailContacto: String!
    "Costo de envío en pesos (0 = siempre gratis)."
    costoEnvio: Float!
    "Desde este subtotal (ya con descuento) el envío es gratis. 0 = nunca."
    envioGratisDesde: Float!
    "Los precios ya incluyen IVA; este porcentaje sirve para desglosarlo."
    ivaPorcentaje: Float!
    "Paqueterías que se pueden elegir al marcar un pedido como enviado."
    paqueterias: [String!]!
  }

  input ConfiguracionInput {
    nombreTienda: String
    emailContacto: String
    costoEnvio: Float
    envioGratisDesde: Float
    ivaPorcentaje: Float
    paqueterias: [String!]
  }

  extend type Query {
    configuracionTienda: ConfiguracionTienda!
  }

  extend type Mutation {
    "Cambia los campos que se manden; los que no, se quedan igual. Solo ADMIN."
    actualizarConfiguracion(data: ConfiguracionInput!): ConfiguracionTienda!
  }
`;
