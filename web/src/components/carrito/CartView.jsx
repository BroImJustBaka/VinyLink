// Dueño: Persona B. Migrado de front/src/views/CartView.jsx.
// Isla React (client:only) porque el carrito vive en el navegador.
import { useCartStore } from "../../stores/cart.js";

export default function CartView() {
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.total());
  const sincronizado = useCartStore((s) => s.sincronizado);
  const error = useCartStore((s) => s.error);
  const cambiarCantidad = useCartStore((s) => s.cambiarCantidad);
  const quitarProducto = useCartStore((s) => s.quitarProducto);

  if (items.length === 0) {
    return (
      <section>
        <h2>Carrito</h2>
        {!sincronizado ? (
          <p className="muted">Cargando tu carrito...</p>
        ) : (
          <p className="muted">
            Tu carrito está vacío. <a href="/">Seguir comprando</a>
          </p>
        )}
        {error && <p className="error-box">{error}</p>}
      </section>
    );
  }

  return (
    <section>
      <h2>Carrito</h2>

      {error && (
        <div className="error-box">
          <p>{error}</p>
        </div>
      )}

      <ul className="cart-list">
        {items.map((item) => (
          <li key={item.id} className="cart-item">
            <img src={item.imagen} alt={item.nombre} />
            <div className="cart-item__info">
              <strong>{item.nombre}</strong>
              <span className="muted">${item.precio.toFixed(2)} c/u</span>
            </div>

            <input
              type="number"
              min="1"
              value={item.cantidad}
              aria-label={`Cantidad de ${item.nombre}`}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) cambiarCantidad(item.id, n);
              }}
            />

            <span className="precio">${(item.precio * item.cantidad).toFixed(2)}</span>

            <button className="btn btn--link" onClick={() => quitarProducto(item.id)}>
              Quitar
            </button>
          </li>
        ))}
      </ul>

      <div className="cart-total">
        <strong>Total: ${total.toFixed(2)}</strong>
      </div>

      <div className="cart-acciones">
        <a className="btn" href="/">
          Seguir comprando
        </a>
        <a className="btn btn--primario" href="/checkout">
          Ir a checkout
        </a>
      </div>
    </section>
  );
}
