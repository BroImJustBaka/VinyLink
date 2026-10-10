// Revisión periódica de pagos que se quedaron esperando.
//
// Cada pedido pendiente tiene stock apartado. Si nadie lo paga, ese stock
// no se puede vender a otra persona, así que cada 5 minutos:
//   1. Tarjeta (pasados 30 min), SPEI (pasados 3 días) y cobros que nunca
//      llegaron a Stripe (pasados 30 min): se cancelan.
//   2. OXXO y links de pago: Stripe decide cuándo vencen; solo se le
//      pregunta cómo van (por si un webhook no llegó).
import { many } from "../../lib/sql.js";
import { stripe } from "./stripe.js";
import { cancelarPedidoPendiente, sincronizarPedido } from "./servicio.js";

const CADA_MS = 5 * 60 * 1000;

export async function revisarVencimientos() {
  const vencidos = await many(
    `SELECT pe.id
       FROM pedido pe JOIN pago pa ON pa.pedido_id = pe.id
      WHERE pe.estado = 'pendiente'
        AND pa.estado IN ('pendiente', 'requiere_accion')
        AND (   (pa.metodo IN ('credito', 'debito') AND pa.creado_en < NOW() - INTERVAL '30 minutes')
             OR (pa.metodo = 'spei' AND pa.creado_en < NOW() - INTERVAL '3 days')
             -- El cobro nunca llegó a Stripe (p. ej. se cayó el servidor a la mitad).
             OR (pa.stripe_payment_intent_id IS NULL AND pa.stripe_checkout_session_id IS NULL
                 AND pa.creado_en < NOW() - INTERVAL '30 minutes'))`
  );
  for (const { id } of vencidos) {
    try {
      await cancelarPedidoPendiente(id, "Venció el tiempo para pagar.");
      console.log(`Pedido #${id} cancelado: venció el tiempo para pagar.`);
    } catch (err) {
      console.error(`No se pudo cancelar el pedido #${id}:`, err.message);
    }
  }

  const porRevisar = await many(
    `SELECT pe.id
       FROM pedido pe JOIN pago pa ON pa.pedido_id = pe.id
      WHERE pe.estado = 'pendiente'
        AND pa.metodo IN ('oxxo', 'link', 'spei')
        AND pa.actualizado_en < NOW() - INTERVAL '10 minutes'`
  );
  for (const { id } of porRevisar) {
    try {
      await sincronizarPedido(id);
    } catch (err) {
      console.error(`No se pudo revisar el pedido #${id}:`, err.message);
    }
  }
}

export function iniciarRevisionDeVencimientos() {
  if (!stripe) return;
  const correr = () =>
    revisarVencimientos().catch((err) => console.error("Error revisando vencimientos:", err.message));
  correr();
  // unref(): este temporizador no impide que el proceso termine (Ctrl+C).
  setInterval(correr, CADA_MS).unref();
}
