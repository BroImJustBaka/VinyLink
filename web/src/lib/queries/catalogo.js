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
