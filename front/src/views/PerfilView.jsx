import { useAuthStore } from "../store/useAuthStore.js";
import { useCartStore } from "../store/useCartStore.js";

// Mismo patrón que las demás views: recibe callbacks del padre (App.jsx)
// para navegar, en vez de useNavigate (el proyecto no usa react-router).
export function PerfilView({ onIrCarrito, onIrHome }) {
  const usuario = useAuthStore((s) => s.usuario);
  const cerrarSesion = useAuthStore((s) => s.cerrarSesion);
  const limpiarCarritoLocal = useCartStore((s) => s.limpiarLocal);

  if (!usuario) {
    // Por si acaso llegan aquí sin sesión (ej. cerraron sesión en otra pestaña)
    return (
      <section>
        <p>No hay ninguna sesión activa.</p>
        <button className="btn btn--link" onClick={onIrHome}>
          Volver al inicio
        </button>
      </section>
    );
  }

  function handleCerrarSesion() {
    cerrarSesion();
    limpiarCarritoLocal();
    onIrHome();
  }

  return (
    <section className="perfil-view">
      <h2>Bienvenido, {usuario.nombre}</h2>
      <p>{usuario.email}</p>

      <div className="perfil-view__acciones">
        <button className="btn btn--primario" onClick={onIrCarrito}>
          🛒 Ir al carrito
        </button>

        <button className="btn btn--link" onClick={handleCerrarSesion}>
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}
