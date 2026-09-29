import { useCartStore } from "../store/useCartStore.js";

export function CartView({ onSeguirComprando, onIrCheckout }) {
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.total());
  const cambiarCantidad = useCartStore((s) => s.cambiarCantidad);
  const quitarProducto = useCartStore((s) => s.quitarProducto);

  return (
    <section>
      <h2>Carrito</h2>

      {items.length === 0 ? (
        <p className="muted">
          Tu carrito está vacío. <button className="btn btn--link" onClick={onSeguirComprando}>Seguir comprando</button>
        </p>
      ) : (
        <>
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
                  onChange={(e) => cambiarCantidad(item.id, Number(e.target.value))}
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
            <button className="btn" onClick={onSeguirComprando}>
              Seguir comprando
            </button>
            <button className="btn btn--primario" onClick={onIrCheckout}>
              Ir a checkout
            </button>
          </div>
        </>
      )}
    </section>
  );
}
