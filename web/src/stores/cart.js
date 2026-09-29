// Dueño: Persona B.
//
// CONTRATO (lo usan ProductModal de A y CartBadge):
//   const agregar = useCartStore((s) => s.agregarProducto)
//   items, agregarProducto(producto, cantidad), cambiarCantidad(id, cantidad),
//   quitarProducto(id), vaciarCarrito(), total(), cantidadTotal()
//
// En Astro cada página es una carga nueva, así que el carrito se persiste en
// localStorage para sobrevivir la navegación.
// TODO(B): sincronizar con la DB cuando hay sesión (ver front/src/store/useCartStore.js)
// y fusionar el carrito de invitado al iniciar sesión.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useCartStore = create(
  persist(
    (set, get) => ({
      items: [], // { id, nombre, precio, imagen, cantidad }

      agregarProducto: (producto, cantidad = 1) => {
        const existente = get().items.find((it) => it.id === producto.id);
        set({
          items: existente
            ? get().items.map((it) =>
                it.id === producto.id ? { ...it, cantidad: it.cantidad + cantidad } : it
              )
            : [
                ...get().items,
                {
                  id: producto.id,
                  nombre: producto.nombre,
                  precio: producto.precio,
                  imagen: producto.imagen,
                  cantidad,
                },
              ],
        });
      },

      cambiarCantidad: (id, cantidad) => {
        if (cantidad <= 0) return get().quitarProducto(id);
        set({ items: get().items.map((it) => (it.id === id ? { ...it, cantidad } : it)) });
      },

      quitarProducto: (id) => set({ items: get().items.filter((it) => it.id !== id) }),

      vaciarCarrito: () => set({ items: [] }),

      total: () => get().items.reduce((acc, it) => acc + it.precio * it.cantidad, 0),
      cantidadTotal: () => get().items.reduce((acc, it) => acc + it.cantidad, 0),
    }),
    { name: "carrito-tienda", partialize: (s) => ({ items: s.items }) }
  )
);
