// Dueño: Persona B. Migrado de front/src/views/CheckoutView.jsx.
// El comprador es el usuario con sesión, así que ya no se piden nombre/email.
import { useState } from "react";
import { useCartStore } from "../../stores/cart.js";
import { graphqlClient } from "../../lib/graphql.ts";
import { ERROR_SIN_SESION, MUTATION_CREAR_PEDIDO } from "../../lib/queries/pedidos.js";

export default function CheckoutForm({ user = null }) {
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.total());
  const limpiarLocal = useCartStore((s) => s.limpiarLocal);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const sinSesion = error?.includes(ERROR_SIN_SESION);

  async function confirmar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    try {
      const data = { items: items.map((it) => ({ productoId: it.id, cantidad: it.cantidad })) };
      const { crearPedido } = await graphqlClient(MUTATION_CREAR_PEDIDO, { data });
      limpiarLocal(); // el backend ya vació el carrito de la DB
      window.location.href = `/pedido/${crearPedido.id}`;
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  if (items.length === 0) {
    return (
      <section>
        <h2>Checkout</h2>
        <p className="muted">
          No hay nada que pagar: tu carrito está vacío. <a href="/">Seguir comprando</a>
        </p>
      </section>
    );
  }

  return (
    <section>
      <a href="/carrito">← Volver al carrito</a>

      <h2>Checkout</h2>

      <ul className="checkout-resumen">
        {items.map((it) => (
          <li key={it.id}>
            {it.cantidad} × {it.nombre} — ${(it.precio * it.cantidad).toFixed(2)}
          </li>
        ))}
      </ul>
      <p className="cart-total">
        <strong>Total: ${total.toFixed(2)}</strong>
      </p>

      {user && (
        <p className="muted">
          Comprando como {user.nombre} ({user.email})
        </p>
      )}

      <form onSubmit={confirmar} className="checkout-form">
        {error && (
          <div className="error-box">
            <p>
              {sinSesion ? (
                <>
                  Necesitas iniciar sesión para finalizar la compra. <a href="/login">Iniciar sesión</a>
                </>
              ) : (
                <>No se pudo registrar el pedido: {error}</>
              )}
            </p>
          </div>
        )}

        <button className="btn btn--primario" type="submit" disabled={enviando}>
          {enviando ? "Registrando pedido..." : "Finalizar compra"}
        </button>
      </form>
    </section>
  );
}
