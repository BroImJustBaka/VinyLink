import { create } from "zustand";
import { graphqlRequest } from "../api/client.js";
import {
  QUERY_CARRITO,
  MUTATION_AGREGAR_AL_CARRITO,
  MUTATION_CAMBIAR_CANTIDAD_CARRITO,
  MUTATION_QUITAR_DEL_CARRITO,
  MUTATION_VACIAR_CARRITO_DB,
} from "../api/queries.js";
import { useAuthStore } from "./useAuthStore.js";

// Convierte el carrito que regresa el backend (items con `producto` anidado)
// a la forma plana { id, nombre, precio, imagen, cantidad } que ya usan
// CartView, ProductModal y TopBar — así no hay que tocar esos componentes.
function mapCarritoDB(carritoDB) {
  return carritoDB.items.map((it) => ({
    id: it.producto.id,
    nombre: it.producto.nombre,
    precio: it.producto.precio,
    imagen: it.producto.imagen,
    cantidad: it.cantidad,
  }));
}

// Carrito como tienda global (Zustand). Si hay sesión iniciada (useAuthStore),
// cada acción llama al backend y el carrito vive en la tabla `carrito` /
// `detalle_carrito`. Si NO hay sesión, se comporta como antes: solo en
// memoria, porque no hay usuario_id al cual guardarlo.
export const useCartStore = create((set, get) => ({
  items: [], // { id, nombre, precio, imagen, cantidad }
  cargando: false,

  // Trae el carrito guardado en DB. Llamar al iniciar sesión y al arrancar
  // la app si ya había una sesión persistida (ver App.jsx).
  cargarDesdeDB: async () => {
    const usuario = useAuthStore.getState().usuario;
    if (!usuario) return;

    set({ cargando: true });
    try {
      const res = await graphqlRequest(QUERY_CARRITO, { usuarioId: usuario.id });
      set({ items: mapCarritoDB(res.carrito) });
    } finally {
      set({ cargando: false });
    }
  },

  // Limpia el carrito solo del lado del cliente, sin tocar la DB. Úsalo al
  // cerrar sesión para que el siguiente visitante no vea un carrito ajeno.
  limpiarLocal: () => set({ items: [] }),

  agregarProducto: async (producto, cantidad = 1) => {
    const usuario = useAuthStore.getState().usuario;

    if (!usuario) {
      const existente = get().items.find((it) => it.id === producto.id);
      if (existente) {
        set({
          items: get().items.map((it) =>
            it.id === producto.id ? { ...it, cantidad: it.cantidad + cantidad } : it
          ),
        });
      } else {
        set({ items: [...get().items, { ...producto, cantidad }] });
      }
      return;
    }

    const res = await graphqlRequest(MUTATION_AGREGAR_AL_CARRITO, {
      usuarioId: usuario.id,
      productoId: producto.id,
      cantidad,
    });
    set({ items: mapCarritoDB(res.agregarAlCarrito) });
  },

  cambiarCantidad: async (id, cantidad) => {
    const usuario = useAuthStore.getState().usuario;

    if (!usuario) {
      if (cantidad <= 0) {
        get().quitarProducto(id);
        return;
      }
      set({
        items: get().items.map((it) => (it.id === id ? { ...it, cantidad } : it)),
      });
      return;
    }

    const res = await graphqlRequest(MUTATION_CAMBIAR_CANTIDAD_CARRITO, {
      usuarioId: usuario.id,
      productoId: id,
      cantidad,
    });
    set({ items: mapCarritoDB(res.cambiarCantidadCarrito) });
  },

  quitarProducto: async (id) => {
    const usuario = useAuthStore.getState().usuario;

    if (!usuario) {
      set({ items: get().items.filter((it) => it.id !== id) });
      return;
    }

    const res = await graphqlRequest(MUTATION_QUITAR_DEL_CARRITO, {
      usuarioId: usuario.id,
      productoId: id,
    });
    set({ items: mapCarritoDB(res.quitarDelCarrito) });
  },

  vaciarCarrito: async () => {
    const usuario = useAuthStore.getState().usuario;

    if (!usuario) {
      set({ items: [] });
      return;
    }

    await graphqlRequest(MUTATION_VACIAR_CARRITO_DB, { usuarioId: usuario.id });
    set({ items: [] });
  },

  total: () => get().items.reduce((acc, it) => acc + it.precio * it.cantidad, 0),
  cantidadTotal: () => get().items.reduce((acc, it) => acc + it.cantidad, 0),
}));