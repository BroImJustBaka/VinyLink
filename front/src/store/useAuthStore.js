import { create } from "zustand";
import { persist } from "zustand/middleware";

// Sesión como tienda global persistida (Zustand + persist). A diferencia del
// carrito, esta sí se guarda en localStorage entre recargas: al iniciar la
// app, Zustand la hidrata sola desde localStorage antes del primer render
// (por eso no hace falta un useEffect + JSON.parse manual en cada vista).
export const useAuthStore = create(
  persist(
    (set) => ({
      usuario: null, // { id, nombre, email, rol } | null

      iniciarSesion: (usuario) => set({ usuario }),

      cerrarSesion: () => set({ usuario: null }),
    }),
    {
      name: "sesion-tienda", // key usada en localStorage
      partialize: (state) => ({ usuario: state.usuario }), // solo persiste esto
    }
  )
);