import { useCartStore } from "../store/useCartStore.js";

// Zona de "context": vista rápida del carrito.
// Usa Fragment (<>) para agrupar dos bloques sin envoltura extra (tema 9)
// y combina className con estilos inline sobre el mismo tipo de tarjeta
// (tema 10: dos formas de estilizar en un mismo componente).
export function ContextSection() {
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.total());

  return (
    <>
      <div className="context-card">
        <strong>Vista rápida del carrito</strong>
        {items.length === 0 ? (
          <p className="muted">Tu carrito está vacío.</p>
        ) : (
          <p className="muted">
            {items.length} producto(s) · ${total.toFixed(2)}
          </p>
        )}
      </div>
    </>
  );
}
