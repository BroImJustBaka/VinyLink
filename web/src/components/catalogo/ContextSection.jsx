// Dueño: Persona A. Migrado de front/src/components/ContextSection.jsx.
// Vista rápida del carrito en la home. Es una isla client:only="react"
// porque el carrito vive en localStorage y no existe en el servidor;
// mientras carga, index.astro muestra un skeleton como fallback.
import { useCartStore } from "../../stores/cart.js";

export default function ContextSection() {
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.total());

  return (
    <div className="context-card">
      <strong>Vista rápida del carrito</strong>
      {items.length === 0 ? (
        <p className="muted">Tu carrito está vacío.</p>
      ) : (
        <p className="muted">
          {items.length} producto(s) · ${total.toFixed(2)} ·{" "}
          <a className="btn btn--link" href="/carrito">
            Ver carrito
          </a>
        </p>
      )}
    </div>
  );
}
