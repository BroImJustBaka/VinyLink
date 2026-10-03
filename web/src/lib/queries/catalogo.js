// Dueño: Persona A.

// Lista liviana para Sidebar y Home: sin productos anidados.
export const QUERY_CATEGORIAS = `
  query Categorias {
    categorias {
      id
      nombre
      descripcion
      imagen
    }
  }
`;

export const QUERY_CATEGORIA = `
  query Categoria($id: ID!) {
    categoria(id: $id) {
      id
      nombre
      descripcion
      imagen
      productos {
        id
        nombre
        descripcion
        precio
        stock
        imagen
      }
    }
  }
`;

// Búsqueda del TopBar. Sin categoriaId busca en toda la tienda.
export const QUERY_BUSCAR = `
  query BuscarProductos($texto: String!, $categoriaId: ID) {
    buscarProductos(texto: $texto, categoriaId: $categoriaId) {
      id
      nombre
      descripcion
      precio
      stock
      imagen
      categoria {
        id
        nombre
      }
    }
  }
`;
