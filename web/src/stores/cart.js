// Dueño: Persona B.
//
// CONTRATO (lo usan ProductModal de A y CartBadge):
//   const agregar = useCartStore((s) => s.agregarProducto)
//   items, agregarProducto(producto, cantidad), cambiarCantidad(id, cantidad),
//   quitarProducto(id), vaciarCarrito(), total(), cantidadTotal()
//
// Cómo funciona:
//  - Siempre hay un carrito local (localStorage), porque en Astro cada página
//    es una carga nueva y el carrito debe sobrevivir la navegación.
//  - Con sesión, el carrito también vive en la DB: cada acción actualiza lo
//    local al instante (optimista) y luego lo manda al backend.
//  - `sincronizar()` (lo llama CartBadge en cada página) averigua si hay
//    sesión sin necesidad de props:
//      · con sesión + carrito de invitado → lo FUSIONA con el de la DB;
//      · con sesión sin carrito local     → baja el de la DB;
//      · sin sesión pero antes había una  → limpia lo local (cierre de sesión).
//  - Las llamadas al backend van en una cola, así nunca se pisan entre sí.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { graphqlClient } from "../lib/graphql.ts";
import {
  ERROR_SIN_SESION,
  QUERY_CARRITO,
  MUTATION_AGREGAR_AL_CARRITO,
  MUTATION_CAMBIAR_CANTIDAD_CARRITO,
  MUTATION_QUITAR_DEL_CARRITO,
  MUTATION_VACIAR_CARRITO_DB,
  MUTATION_FUSIONAR_CARRITO,
} from "../lib/queries/pedidos.js";

// Carrito del backend (items con `producto` anidado) → forma plana local.
function mapCarritoDB(carrito) {
  return carrito.items.map((it) => ({
    id: it.producto.id,
    nombre: it.producto.nombre,
    precio: it.producto.precio,
    imagen: it.producto.imagen,
    cantidad: it.cantidad,
  }));
}

const esErrorDeSesion = (err) => String(err?.message).includes(ERROR_SIN_SESION);

// Cola: cada tarea espera a que termine la anterior (aunque esa haya fallado).
let cola = Promise.resolve();
const encolar = (tarea) => (cola = cola.then(tarea, tarea));

export const useCartStore = create(
  persist(
    (set, get) => ({
      items: [], // { id, nombre, precio, imagen, cantidad }
      modo: "invitado", // "usuario" = el carrito local es copia del de la DB
      sincronizado: false, // ya se averiguó (una vez en esta página) si hay sesión
      error: null, // último error de sincronización, para mostrarlo en el carrito

      // Corre `operacion` contra el backend si hay sesión y reemplaza los items
      // con lo que responde. Si falla, deja el error y vuelve a bajar el carrito.
      _enServidor: (operacion) =>
        encolar(async () => {
          if (get().modo !== "usuario") return;
          try {
            set({ items: mapCarritoDB(await operacion()), error: null });
          } catch (err) {
            if (esErrorDeSesion(err)) return set({ modo: "invitado" });
            set({ error: err.message });
            try {
              const { carrito } = await graphqlClient(QUERY_CARRITO);
              set({ items: mapCarritoDB(carrito) });
            } catch {
              /* sin red: se queda lo local */
            }
          }
        }),

      sincronizar: () =>
        encolar(async () => {
          try {
            const local = get().items;
            let carrito;
            if (get().modo === "invitado" && local.length > 0) {
              // Intenta fusionar directo: si no hay sesión, el backend lo rechaza.
              ({ fusionarCarrito: carrito } = await graphqlClient(MUTATION_FUSIONAR_CARRITO, {
                items: local.map((it) => ({ productoId: it.id, cantidad: it.cantidad })),
              }));
            } else {
              ({ carrito } = await graphqlClient(QUERY_CARRITO));
            }
            set({ items: mapCarritoDB(carrito), modo: "usuario", error: null });
          } catch (err) {
            if (esErrorDeSesion(err)) {
              // Visitante. Si antes era un usuario, el carrito local era suyo: se limpia.
              set(get().modo === "usuario" ? { items: [], modo: "invitado" } : { modo: "invitado" });
            } else {
              set({ error: err.message }); // sin red / backend caído: se conserva lo local
            }
          } finally {
            set({ sincronizado: true });
          }
        }),

      agregarProducto: (producto, cantidad = 1) => {
        const existente = get().items.find((it) => it.id === producto.id);
        set({
          error: null,
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
        get()._enServidor(async () =>
          (await graphqlClient(MUTATION_AGREGAR_AL_CARRITO, { productoId: producto.id, cantidad }))
            .agregarAlCarrito
        );
      },

      cambiarCantidad: (id, cantidad) => {
        if (cantidad <= 0) return get().quitarProducto(id);
        set({
          error: null,
          items: get().items.map((it) => (it.id === id ? { ...it, cantidad } : it)),
        });
        get()._enServidor(async () =>
          (await graphqlClient(MUTATION_CAMBIAR_CANTIDAD_CARRITO, { productoId: id, cantidad }))
            .cambiarCantidadCarrito
        );
      },

      quitarProducto: (id) => {
        set({ error: null, items: get().items.filter((it) => it.id !== id) });
        get()._enServidor(async () =>
          (await graphqlClient(MUTATION_QUITAR_DEL_CARRITO, { productoId: id })).quitarDelCarrito
        );
      },

      vaciarCarrito: () => {
        set({ error: null, items: [] });
        get()._enServidor(async () => (await graphqlClient(MUTATION_VACIAR_CARRITO_DB)).vaciarCarritoDB);
      },

      // Solo limpia lo local, sin llamar al backend. Se usa tras crear un
      // pedido (crearPedido ya vació el carrito de la DB).
      limpiarLocal: () => set({ items: [], error: null }),

      total: () => get().items.reduce((acc, it) => acc + it.precio * it.cantidad, 0),
      cantidadTotal: () => get().items.reduce((acc, it) => acc + it.cantidad, 0),
    }),
    {
      name: "carrito-tienda",
      partialize: (s) => ({ items: s.items, modo: s.modo }),
    }
  )
);
