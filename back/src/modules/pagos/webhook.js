// Webhook de Stripe: POST /webhooks/stripe
//
// Stripe le avisa al backend cuando algo cambia (se pagó una ficha OXXO,
// llegó una transferencia SPEI, venció un link...). Cada aviso viene firmado
// con STRIPE_WEBHOOK_SECRET; si la firma no coincide se rechaza, así nadie
// puede fingir un pago mandando un POST a mano.
//
// No se confía en el contenido del aviso para decidir el estado: solo se usa
// para saber QUÉ pedido revisar, y sincronizarPedido() le pregunta a Stripe
// el estado actual. Así no importa si los avisos llegan repetidos o en desorden.
import { one } from "../../lib/sql.js";
import { stripe, webhookSecret } from "./stripe.js";
import { sincronizarPedido } from "./servicio.js";

const EVENTOS = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "payment_intent.requires_action",
  "payment_intent.partially_funded",
  "payment_intent.processing",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
]);

// Busca el pedido al que se refiere un evento.
async function pedidoDelEvento(evento) {
  const objeto = evento.data.object;
  let fila = null;
  if (objeto.object === "payment_intent") {
    fila = await one("SELECT pedido_id FROM pago WHERE stripe_payment_intent_id = $1", [objeto.id]);
  } else if (objeto.object === "checkout.session") {
    fila = await one("SELECT pedido_id FROM pago WHERE stripe_checkout_session_id = $1", [objeto.id]);
  } else if (objeto.object === "charge") {
    fila = await one("SELECT pedido_id FROM pago WHERE stripe_payment_intent_id = $1", [
      objeto.payment_intent,
    ]);
  }
  if (fila) return fila.pedido_id;

  // El PaymentIntent de un link de pago aún no está guardado: se usa la metadata.
  const id = objeto.metadata?.pedido_id ?? objeto.client_reference_id;
  if (!/^\d+$/.test(id ?? "")) return null;
  const existe = await one("SELECT pedido_id FROM pago WHERE pedido_id = $1", [id]);
  return existe?.pedido_id ?? null;
}

// Express le pasa el cuerpo SIN parsear (Buffer): la firma se calcula sobre
// los bytes exactos que mandó Stripe.
export async function manejarWebhookStripe(req, res) {
  if (!stripe || !webhookSecret) {
    console.warn("Webhook de Stripe recibido, pero falta STRIPE_WEBHOOK_SECRET en back/.env");
    return res.status(503).send("Webhook no configurado");
  }

  let evento;
  try {
    evento = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], webhookSecret);
  } catch (err) {
    return res.status(400).send(`Firma inválida: ${err.message}`);
  }

  if (!EVENTOS.has(evento.type)) return res.json({ recibido: true, ignorado: true });

  try {
    const pedidoId = await pedidoDelEvento(evento);
    if (pedidoId) {
      const r = await sincronizarPedido(pedidoId);
      console.log(
        `Stripe ${evento.type} → pedido #${pedidoId}: ${r?.pedido.estado ?? "sin cambios"}`
      );
    }
    res.json({ recibido: true });
  } catch (err) {
    // 500 = Stripe vuelve a mandar el aviso más tarde (reintenta hasta 3 días).
    console.error(`Error procesando ${evento.type}:`, err.message);
    res.status(500).send("Error al procesar el evento");
  }
}
