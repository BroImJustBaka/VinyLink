// Dueño: Persona B.
//
// Todas estas operaciones usan la sesión (cookie → Authorization): ya no se
// manda `usuarioId`, el backend lo toma de `context.user`.

// Crear un pedido ahora es pagar: MUTATION_CREAR_PEDIDO está en ./pagos.js.
import { CAMPOS_PAGO } from "./pagos.js";

// Mensaje que el backend lanza (requireUser) cuando no hay sesión.
export const ERROR_SIN_SESION = "Necesitas iniciar sesión";

const CAMPOS_PEDIDO = `
  id
  fecha
  estado
  total
  metodoPago
  pagadoEn
  pago {
    ${CAMPOS_PAGO}
  }
  detalles {
    id
    cantidad
    precioUnitario
    subtotal
    producto {
      id
      nombre
      imagen
    }
  }
`;

// Una página de confirmación (/pedido/[id]). Regresa null si no existe o es ajeno.
export const QUERY_PEDIDO = `
  query Pedido($id: ID!) {
    pedido(id: $id) {
      ${CAMPOS_PEDIDO}
    }
  }
`;

// Historial del usuario logueado. Lo usa C en /perfil.
export const QUERY_MIS_PEDIDOS = `
  query MisPedidos {
    misPedidos {
      ${CAMPOS_PEDIDO}
    }
  }
`;

// Mismo fragmento en todas las operaciones de carrito para recibir siempre
// la misma forma de datos.
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
  query Carrito {
    carrito {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_AGREGAR_AL_CARRITO = `
  mutation AgregarAlCarrito($productoId: ID!, $cantidad: Int) {
    agregarAlCarrito(productoId: $productoId, cantidad: $cantidad) {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_CAMBIAR_CANTIDAD_CARRITO = `
  mutation CambiarCantidadCarrito($productoId: ID!, $cantidad: Int!) {
    cambiarCantidadCarrito(productoId: $productoId, cantidad: $cantidad) {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_QUITAR_DEL_CARRITO = `
  mutation QuitarDelCarrito($productoId: ID!) {
    quitarDelCarrito(productoId: $productoId) {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_VACIAR_CARRITO_DB = `
  mutation VaciarCarritoDB {
    vaciarCarritoDB {
      ${CAMPOS_CARRITO}
    }
  }
`;

export const MUTATION_FUSIONAR_CARRITO = `
  mutation FusionarCarrito($items: [ItemCarritoInput!]!) {
    fusionarCarrito(items: $items) {
      ${CAMPOS_CARRITO}
    }
  }
`;
