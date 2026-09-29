import { useCartStore } from "../store/useCartStore.js";
import { useAuthStore } from "../store/useAuthStore.js";

// TopBar: marca, buscador (evento HTML controlado), contador del carrito y
// acceso a la sesión. Recibe callbacks del padre (evento custom) para
// navegar sin usar URLs.
export function TopBar({ busqueda, onBuscar, onIrHome, onIrCarrito, onIrPerfil }) {
  const cantidadTotal = useCartStore((s) => s.cantidadTotal());
  const usuario = useAuthStore((s) => s.usuario);

  return (
    <header className="topbar">
      <button className="topbar__logo" onClick={onIrHome}>
        VinyLink
      </button>

      <input
        type="search"
        className="topbar__buscador"
        placeholder="Buscar productos..."
        value={busqueda} 
        onChange={(e) => onBuscar(e.target.value)}
      />

      <button className="topbar__carrito" onClick={onIrCarrito}>
        🛒 Carrito
        {cantidadTotal > 0 && <span className="badge">{cantidadTotal}</span>}
      </button>

      <button className="topbar__perfil" onClick={onIrPerfil}>
        {usuario ? `👤 ${usuario.nombre.split(" ")[0]}` : "Iniciar sesión"}
      </button>
    </header>
  );
}
