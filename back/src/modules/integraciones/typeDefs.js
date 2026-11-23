// APIs de terceros (además de Stripe y PayPal, que viven en ../pagos):
// Banxico (tipo de cambio), COPOMEX (códigos postales) y Mercado Libre
// (comparador de precios).
export const typeDefs = `#graphql
  "Tipo de cambio peso-dólar del día (Banxico, serie FIX)."
  type TipoCambio {
    "Pesos por dólar."
    valor: Float!
    "Fecha del dato (AAAA-MM-DD)."
    fecha: String!
    fuente: String!
  }

  "Datos de un código postal de México (COPOMEX / SEPOMEX)."
  type CodigoPostal {
    cp: String!
    estado: String!
    municipio: String!
    ciudad: String
    "Colonias (asentamientos) con ese código postal."
    colonias: [String!]!
  }

  "Una publicación de Mercado Libre parecida al producto."
  type PublicacionMercadoLibre {
    id: ID!
    titulo: String!
    precio: Float!
    url: String!
    imagen: String
    "Nuevo o Usado."
    condicion: String
  }

  "Cómo está el precio del producto contra Mercado Libre México."
  type PreciosMercadoLibre {
    "Texto con el que se buscó."
    busqueda: String!
    "Publicaciones que encontró Mercado Libre en total."
    total: Int!
    "Precios usados para el resumen (sin valores atípicos)."
    muestra: Int!
    "Precios descartados por atípicos (accesorios, lotes...)."
    descartados: Int!
    minimo: Float
    maximo: Float
    promedio: Float
    mediana: Float
    "Precio del producto en la tienda."
    precioTienda: Float!
    "Diferencia del precio de la tienda contra la mediana, en % (positivo = más caro)."
    diferenciaPorcentaje: Float
    publicaciones: [PublicacionMercadoLibre!]!
    consultadoEn: String!
  }

  "Estado de una integración externa (panel → Configuración)."
  type Integracion {
    clave: ID!
    nombre: String!
    "Para qué la usa la tienda."
    uso: String!
    "true si tiene sus credenciales en back/.env."
    configurada: Boolean!
    "Variables de entorno que necesita."
    variables: [String!]!
  }

  extend type Query {
    "Tipo de cambio del día (null si Banxico no está configurado)."
    tipoCambio: TipoCambio
    "Estado, municipio y colonias de un C.P. (null si no existe o COPOMEX no está configurado). Requiere sesión."
    codigoPostal(cp: String!): CodigoPostal
    "Precios de Mercado Libre para un producto. busqueda = texto opcional (por defecto, su nombre)."
    adminPreciosMercadoLibre(productoId: ID!, busqueda: String): PreciosMercadoLibre!
    "Qué APIs de terceros tiene configuradas el backend."
    adminIntegraciones: [Integracion!]!
  }
`;
