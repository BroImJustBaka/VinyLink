// Dueño: Persona B.

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

// Mismo fragmento en las 5 operaciones de carrito para recibir siempre la
// misma forma de datos.
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
