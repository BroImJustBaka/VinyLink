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

// Búsqueda del TopBar. Sin categoriaId busca en toda la tienda. El backend
// ignora acentos y mayúsculas, acepta palabras a medias y, si no encuentra
// nada exacto, regresa lo más parecido con aproximada: true.
export const QUERY_BUSCAR = `
  query Buscar($texto: String!, $categoriaId: ID) {
    buscar(texto: $texto, categoriaId: $categoriaId) {
      total
      aproximada
      productos {
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
  }
`;
