// Dueño: Persona A (catálogo)
export const typeDefs = `#graphql
  "Categoría del catálogo. Una categoría tiene muchos productos."
  type Categoria {
    id: ID!
    nombre: String!
    descripcion: String!
    imagen: String!
    "Productos activos de la categoría (los que se ven en la tienda)."
    productos: [Producto!]!
    "Cuántos productos tiene en total, incluidos los inactivos (panel)."
    totalProductos: Int!
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
    "Clave interna del producto (opcional, única)."
    sku: String
    "Con este stock o menos el panel lo marca como stock bajo."
    stockMinimo: Int!
    "false = no se ve en la tienda ni se puede comprar (conserva su historial)."
    activo: Boolean!
    creadoEn: String
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
    "Al crear: stock inicial. Al editar es opcional; si cambia, queda como ajuste en el kárdex."
    stock: Int
    imagen: String!
    categoriaId: ID!
    sku: String
    stockMinimo: Int
    activo: Boolean
  }

  "Datos para crear o actualizar una categoría."
  input CategoriaInput {
    nombre: String!
    descripcion: String!
    imagen: String!
  }

  "Imagen subida desde el panel."
  type ImagenSubida {
    id: ID!
    "URL pública para usar en un producto o categoría."
    url: String!
    bytes: Int!
  }

  extend type Query {
    "Lista todas las categorías (cada una con sus productos anidados)."
    categorias: [Categoria!]!
    "Consulta una categoría por su id."
    categoria(id: ID!): Categoria
    """
    Catálogo de productos con paginación simple. incluirInactivos y buscar
    solo los respeta el personal con permiso de catálogo o inventario.
    """
    productos(limit: Int = 20, offset: Int = 0, categoriaId: ID, incluirInactivos: Boolean = false, buscar: String): ProductoPagina!
    "Consulta un producto por su id (uno inactivo solo lo ve el personal)."
    producto(id: ID!): Producto
    "Busca productos activos cuyo nombre o descripción contenga el texto (opcional: dentro de una categoría)."
    buscarProductos(texto: String!, categoriaId: ID): [Producto!]!
  }

  # Permiso "catalogo" (requirePermiso en los resolvers).
  extend type Mutation {
    "Registra un producto nuevo en el catálogo."
    crearProducto(data: ProductoInput!): Producto!
    "Actualiza los datos de un producto existente."
    actualizarProducto(id: ID!, data: ProductoInput!): Producto!
    "Activa o desactiva un producto (lo oculta de la tienda sin borrarlo)."
    cambiarActivoProducto(id: ID!, activo: Boolean!): Producto!
    "Elimina un producto del catálogo (solo si nunca se ha vendido)."
    eliminarProducto(id: ID!): Boolean!
    crearCategoria(data: CategoriaInput!): Categoria!
    actualizarCategoria(id: ID!, data: CategoriaInput!): Categoria!
    "Elimina una categoría vacía."
    eliminarCategoria(id: ID!): Boolean!
    "Sube una imagen (JPG, PNG, WebP o GIF de hasta 5 MB) codificada en base64."
    subirImagen(nombre: String!, tipo: String!, base64: String!): ImagenSubida!
  }
`;
