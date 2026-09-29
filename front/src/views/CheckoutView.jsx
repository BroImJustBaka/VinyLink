import { useState } from "react";
import { useCartStore } from "../store/useCartStore.js";
import { graphqlRequest } from "../api/client.js";
import { MUTATION_CREAR_PEDIDO } from "../api/queries.js";

export function CheckoutView({ onVolver, onPedidoCreado }) {
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.total());

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    try {
      const data = {
        nombre,
        email,
        items: items.map((it) => ({ productoId: it.id, cantidad: it.cantidad })),
      };
      const res = await graphqlRequest(MUTATION_CREAR_PEDIDO, { data });
      onPedidoCreado(res.crearPedido);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section>
      <button className="btn btn--link" onClick={onVolver}>
        ← Volver al carrito
      </button>

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

      <form onSubmit={handleSubmit} className="checkout-form">
        <label>
          Nombre
          <input
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>

        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {error && (
          <div className="error-box">
            <p>No se pudo registrar el pedido: {error}</p>
          </div>
        )}

        <button className="btn btn--primario" type="submit" disabled={enviando}>
          {enviando ? "Registrando pedido..." : "Finalizar compra"}
        </button>
      </form>
    </section>
  );
}
