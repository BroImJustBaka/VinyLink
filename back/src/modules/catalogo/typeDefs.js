// Dueño: Persona A (catálogo)
export const typeDefs = `#graphql
  "Categoría del catálogo. Una categoría tiene muchos productos."
  type Categoria {
    id: ID!
    nombre: String!
    descripcion: String!
    imagen: String!
    productos: [Producto!]!
  }

  "Producto del catálogo. Pertenece a una sola categoría."
  type Producto {
    id: ID!
    nombre: String!
    descripcion: String!
    precio: Float!
    stock: Int!
    imagen: String!
    categoriaId: ID!
    categoria: Categoria!
  }

  "Página de resultados del catálogo paginado."
  type ProductoPagina {
    items: [Producto!]!
    total: Int!
  }

  "Datos para crear o actualizar un producto."
  input ProductoInput {
    nombre: String!
    descripcion: String!
    precio: Float!
    stock: Int!
    imagen: String!
    categoriaId: ID!
  }

  extend type Query {
    "Lista todas las categorías (cada una con sus productos anidados)."
    categorias: [Categoria!]!
    "Consulta una categoría por su id."
    categoria(id: ID!): Categoria
    "Catálogo de productos con paginación simple."
    productos(limit: Int = 20, offset: Int = 0, categoriaId: ID): ProductoPagina!
    "Consulta un producto por su id."
    producto(id: ID!): Producto
    "Busca productos cuyo nombre o descripción contenga el texto (opcional: dentro de una categoría)."
    buscarProductos(texto: String!, categoriaId: ID): [Producto!]!
  }

  # Solo administradores: los resolvers usan requireAdmin(context).
  extend type Mutation {
    "Registra un producto nuevo en el catálogo."
    crearProducto(data: ProductoInput!): Producto!
    "Actualiza los datos de un producto existente."
    actualizarProducto(id: ID!, data: ProductoInput!): Producto!
    "Elimina un producto del catálogo."
    eliminarProducto(id: ID!): Boolean!
  }
`;
