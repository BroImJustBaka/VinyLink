// APIs de terceros que expone el backend: Banxico, COPOMEX y Mercado Libre.

export const QUERY_TIPO_CAMBIO = `
  query TipoCambio {
    tipoCambio { valor fecha fuente }
  }
`;

export const QUERY_CODIGO_POSTAL = `
  query CodigoPostal($cp: String!) {
    codigoPostal(cp: $cp) { cp estado municipio ciudad colonias }
  }
`;

export const QUERY_PRECIOS_MERCADO_LIBRE = `
  query PreciosMercadoLibre($productoId: ID!, $busqueda: String) {
    adminPreciosMercadoLibre(productoId: $productoId, busqueda: $busqueda) {
      busqueda total muestra descartados minimo maximo promedio mediana
      precioTienda diferenciaPorcentaje consultadoEn
      publicaciones { id titulo precio url imagen condicion }
    }
  }
`;

export const QUERY_INTEGRACIONES = `
  query Integraciones {
    adminIntegraciones { clave nombre uso configurada variables }
  }
`;
