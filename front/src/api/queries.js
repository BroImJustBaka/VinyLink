// Operaciones GraphQL usadas por la app, centralizadas en un solo lugar.

// Lista liviana para el Sidebar y el Home: no trae productos anidados
// (el detalle de cada categoría se pide aparte, ver QUERY_CATEGORIA).
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

export const MUTATION_CREAR_PEDIDO = `
  mutation CrearPedido($data: PedidoInput!) {
    crearPedido(data: $data) {
      id
      total
      estado
      fecha
    }
  }
`;

export const MUTATION_LOGIN = `
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      id
      nombre
      email
      rol
      token
    }
  }
`;

export const MUTATION_REGISTRAR = `
  mutation Registrar($nombre: String!, $email: String!, $password: String!) {
    registrar(nombre: $nombre, email: $email, password: $password) {
      id
      nombre
      email
      rol
      token
    }
  }
`;

// Fragmento repetido en las 5 operaciones de carrito: mantenlo igual en todas
// para que el front reciba siempre la misma forma de datos.
const CAMPOS_CARRITO = `
  id
  total
  items {
    id
    cantidad
    subtotal
    producto {
      id
      nombre
      precio
      imagen
      stock
    }
  }
`;

export const QUERY_CARRITO = `
  query Carrito($usuarioId: ID!) {
    carrito(usuarioId: $usuarioId) {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_AGREGAR_AL_CARRITO = `
  mutation AgregarAlCarrito($usuarioId: ID!, $productoId: ID!, $cantidad: Int) {
    agregarAlCarrito(usuarioId: $usuarioId, productoId: $productoId, cantidad: $cantidad) {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_CAMBIAR_CANTIDAD_CARRITO = `
  mutation CambiarCantidadCarrito($usuarioId: ID!, $productoId: ID!, $cantidad: Int!) {
    cambiarCantidadCarrito(usuarioId: $usuarioId, productoId: $productoId, cantidad: $cantidad) {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_QUITAR_DEL_CARRITO = `
  mutation QuitarDelCarrito($usuarioId: ID!, $productoId: ID!) {
    quitarDelCarrito(usuarioId: $usuarioId, productoId: $productoId) {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_VACIAR_CARRITO_DB = `
  mutation VaciarCarritoDB($usuarioId: ID!) {
    vaciarCarritoDB(usuarioId: $usuarioId) {
      ${CAMPOS_CARRITO}
    }
  }
`;