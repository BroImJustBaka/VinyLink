// Dueño: Persona B. Hueco del TopBar: botón de carrito con contador.
// Se monta con client:only="react" porque el contador sale de localStorage
// y no existe en el servidor.
//
// Está en TODAS las páginas (vive en el TopBar), así que aquí se dispara la
// sincronización del carrito con la sesión una vez por carga de página.
import { useEffect } from "react";
import { useCartStore } from "../../stores/cart.js";

export default function CartBadge() {
  const cantidadTotal = useCartStore((s) => s.cantidadTotal());

  useEffect(() => {
    useCartStore.getState().sincronizar();
  }, []);

  return (
    <a className="topbar__carrito" href="/carrito">
      🛒 Carrito
      {cantidadTotal > 0 && <span className="badge">{cantidadTotal}</span>}
    </a>
  );
}
