// Dueño: Persona B. Hueco del TopBar: botón de carrito con contador.
// Se monta con client:only="react" porque el contador sale de localStorage
// y no existe en el servidor.
import { useCartStore } from "../../stores/cart.js";

export default function CartBadge() {
  const cantidadTotal = useCartStore((s) => s.cantidadTotal());

  return (
    <a className="topbar__carrito" href="/carrito">
      🛒 Carrito
      {cantidadTotal > 0 && <span className="badge">{cantidadTotal}</span>}
    </a>
  );
}
