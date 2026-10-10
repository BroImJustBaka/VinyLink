// Stripe SIMULADO para las pruebas automáticas (pruebas/probar-pagos.mjs).
//
// Imita, en memoria y sin internet, las partes de la API de Stripe que usa
// el backend: PaymentIntents, ConfirmationTokens, Checkout Sessions,
// Customers, Refunds, el simulador de transferencias SPEI y la verificación
// de firmas del webhook. Las respuestas tienen la misma forma que las reales
// (según la documentación de Stripe), así que el backend no nota la
// diferencia. NO sustituye probar con Stripe en modo de prueba: sirve para
// comprobar nuestra lógica (estados, stock, carrito, permisos) en segundos.
import crypto from "node:crypto";

export const WHSEC = "whsec_simulado";

const sim = { pis: new Map(), sesiones: new Map(), customers: new Map(), idem: new Map(), seq: 0, llamadas: [] };
const id = (p) => `${p}_sim${++sim.seq}`;
const ahora = () => Math.floor(Date.now() / 1000);
const copia = (o) => JSON.parse(JSON.stringify(o));
class ErrorStripe extends Error {
  constructor(raw) {
    super(raw.message);
    this.raw = raw;
    this.type = raw.type === "card_error" ? "StripeCardError" : "StripeInvalidRequestError";
    this.code = raw.code;
    this.decline_code = raw.decline_code;
  }
}
const invalido = (message, code = "parameter_invalid") => new ErrorStripe({ type: "invalid_request_error", code, message });

const TOKENS = {
  ctok_visa: { card: { brand: "visa", last4: "4242", funding: "credit" } },
  ctok_debito: { card: { brand: "visa", last4: "5556", funding: "debit" } },
  ctok_prepago: { card: { brand: "mastercard", last4: "5100", funding: "prepaid" } },
  ctok_mx3: { card: { brand: "visa", last4: "0008", funding: "credit" }, plan: { type: "fixed_count", count: 3, interval: "month" } },
  ctok_rechazada: { card: { brand: "visa", last4: "0002", funding: "credit" }, rechazo: { code: "card_declined", decline_code: "generic_decline" } },
  ctok_sinfondos: { card: { brand: "visa", last4: "9995", funding: "credit" }, rechazo: { code: "card_declined", decline_code: "insufficient_funds" } },
  ctok_3ds: { card: { brand: "visa", last4: "3184", funding: "credit" }, tresDs: true },
};

function cargo(pi, tipo, extra = {}) {
  pi.latest_charge = { id: id("ch"), object: "charge", refunded: false, payment_method_details: { type: tipo, ...extra } };
}
function despues(ms, fn) { setTimeout(fn, ms); }

const paymentIntents = {
  async create(p, opts = {}) {
    sim.llamadas.push(["paymentIntents.create", p]);
    if (opts.idempotencyKey && sim.idem.has(opts.idempotencyKey)) return copia(sim.pis.get(sim.idem.get(opts.idempotencyKey)));
    if (!Number.isInteger(p.amount) || p.amount < 1000) throw invalido("Amount must be at least $10.00 mxn");
    if (p.currency !== "mxn") throw invalido("Invalid currency");
    const [tipo] = p.payment_method_types ?? [];
    const pi = {
      id: id("pi"), object: "payment_intent", amount: p.amount, currency: "mxn", status: "requires_payment_method",
      client_secret: null, metadata: p.metadata ?? {}, payment_method_types: p.payment_method_types,
      next_action: null, last_payment_error: null, latest_charge: null, customer: p.customer ?? null,
    };
    pi.client_secret = `${pi.id}_secret_sim`;
    sim.pis.set(pi.id, pi);
    if (opts.idempotencyKey) sim.idem.set(opts.idempotencyKey, pi.id);

    if (tipo === "card") {
      const t = TOKENS[p.confirmation_token];
      if (!t) throw invalido("No such confirmationtoken", "resource_missing");
      const inst = p.payment_method_options?.card?.installments;
      // Como Stripe: el plan elegido viaja en el token y no se puede repetir en la petición.
      if (t.plan && inst?.plan) throw invalido("The provided ConfirmationToken contains an installment plan while payment_method_options[card][installments][plan] was also set on this request.");
      const plan = inst?.enabled ? t.plan ?? null : null;
      if (t.rechazo) {
        pi.last_payment_error = { type: "card_error", ...t.rechazo, message: "Your card was declined." };
        throw new ErrorStripe({ type: "card_error", ...t.rechazo, message: "Your card was declined.", payment_intent: copia(pi) });
      }
      if (t.tresDs) {
        pi.status = "requires_action";
        pi.next_action = { type: "use_stripe_sdk", use_stripe_sdk: {} };
      } else {
        pi.status = "succeeded";
        cargo(pi, "card", { card: { ...t.card, installments: plan ? { plan } : null } });
      }
    } else if (tipo === "oxxo") {
      const b = p.payment_method_data?.billing_details;
      if (!b?.name || !b?.email) throw invalido("billing_details name and email required");
      const dias = p.payment_method_options?.oxxo?.expires_after_days ?? 3;
      pi.status = "requires_action";
      pi.next_action = { type: "oxxo_display_details", oxxo_display_details: { number: "12345678901234567890123456789012", hosted_voucher_url: `https://payments.stripe.com/oxxo/voucher/${pi.id}`, expires_after: ahora() + dias * 86400 } };
      if (b.email.includes("succeed_immediately")) despues(1500, () => { pi.status = "succeeded"; pi.next_action = null; cargo(pi, "oxxo", { oxxo: {} }); });
      if (b.email.includes("expire_immediately")) despues(1500, () => { pi.status = "requires_payment_method"; pi.next_action = null; pi.last_payment_error = { type: "invalid_request_error", code: "payment_intent_payment_attempt_expired", message: "expired" }; });
      if (b.email.includes("expira_sin_error")) despues(1500, () => { pi.status = "requires_payment_method"; pi.next_action = null; });
    } else if (tipo === "customer_balance") {
      if (!sim.customers.has(p.customer)) throw invalido("No such customer", "resource_missing");
      if (p.payment_method_options?.customer_balance?.bank_transfer?.type !== "mx_bank_transfer") throw invalido("bad bank_transfer type");
      pi.status = "requires_action";
      pi.next_action = { type: "display_bank_transfer_instructions", display_bank_transfer_instructions: {
        type: "mx_bank_transfer", amount_remaining: p.amount, currency: "mxn", reference: `REF${pi.id}`,
        hosted_instructions_url: `https://payments.stripe.com/bank_transfers/instructions/${pi.id}`,
        financial_addresses: [{ type: "spei", supported_networks: ["spei"], spei: { bank_code: "002", bank_name: "BANAMEX", clabe: "002180650612345670" } }],
      } };
    } else throw invalido(`payment method type ${tipo} not supported`);
    return copia(pi);
  },
  async retrieve(piId, params = {}) {
    const pi = sim.pis.get(piId);
    if (!pi) throw invalido("No such payment_intent", "resource_missing");
    const c = copia(pi);
    if (!params.expand?.includes("latest_charge") && c.latest_charge) c.latest_charge = c.latest_charge.id;
    return c;
  },
  async cancel(piId) {
    const pi = sim.pis.get(piId);
    if (!pi) throw invalido("No such payment_intent", "resource_missing");
    if (pi.status === "succeeded" || pi.status === "canceled") throw invalido(`You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`, "payment_intent_unexpected_state");
    if (pi.payment_method_types[0] === "oxxo" && pi.status === "requires_action") throw invalido("OXXO vouchers cannot be canceled before they expire.", "payment_intent_unexpected_state");
    pi.status = "canceled"; pi.next_action = null;
    return copia(pi);
  },
};

const checkoutSessions = {
  async create(p, opts = {}) {
    sim.llamadas.push(["checkout.sessions.create", p]);
    if (opts.idempotencyKey && sim.idem.has(opts.idempotencyKey)) return copia(sim.sesiones.get(sim.idem.get(opts.idempotencyKey)));
    if (p.mode !== "payment" || !p.success_url || !p.line_items?.length) throw invalido("bad session params");
    if (p.expires_at > ahora() + 24 * 3600 || p.expires_at < ahora() + 30 * 60) throw invalido("expires_at must be between 30 minutes and 24 hours");
    const total = p.line_items.reduce((a, li) => a + li.price_data.unit_amount * li.quantity, 0);
    const s = { id: id("cs"), object: "checkout.session", status: "open", payment_status: "unpaid", amount_total: total,
      payment_method_types: p.payment_method_types, expires_at: p.expires_at, payment_intent: null, metadata: p.metadata,
      client_reference_id: p.client_reference_id, url: null, _pid: p.payment_intent_data };
    s.url = `https://checkout.stripe.com/c/pay/${s.id}`;
    sim.sesiones.set(s.id, s);
    if (opts.idempotencyKey) sim.idem.set(opts.idempotencyKey, s.id);
    const { _pid, ...vista } = s;
    return copia(vista);
  },
  async retrieve(csId, params = {}) {
    const s = sim.sesiones.get(csId);
    if (!s) throw invalido("No such checkout.session", "resource_missing");
    const { _pid, ...vista } = copia(s);
    if (s.payment_intent) vista.payment_intent = params.expand?.some((e) => e.startsWith("payment_intent")) ? copia(sim.pis.get(s.payment_intent)) : s.payment_intent;
    return vista;
  },
  async expire(csId) {
    const s = sim.sesiones.get(csId);
    if (s.status !== "open") throw invalido("Only open sessions can be expired", "checkout_session_unexpected_state");
    s.status = "expired"; s.url = null;
    return copia(s);
  },
};

// Lo que hace la página de Stripe cuando alguien paga el link.
sim.pagarLink = (csId, tipo) => {
  const s = sim.sesiones.get(csId);
  // Checkout usa UN cobro por sesión: los reintentos reutilizan el mismo.
  const pi = (s.payment_intent && sim.pis.get(s.payment_intent)) ?? { id: id("pi"), object: "payment_intent", client_secret: "x",
    metadata: s._pid?.metadata ?? {}, payment_method_types: s.payment_method_types, customer: null };
  Object.assign(pi, { amount: s.amount_total, currency: "mxn", status: "succeeded", next_action: null, last_payment_error: null, latest_charge: null });
  sim.pis.set(pi.id, pi);
  s.payment_intent = pi.id; s.status = "complete"; s.url = null;
  if (tipo === "card") { cargo(pi, "card", { card: { brand: "visa", last4: "4242", funding: "credit", installments: null } }); s.payment_status = "paid"; }
  else { pi.status = "requires_action"; pi.next_action = { type: "oxxo_display_details", oxxo_display_details: { number: "9".repeat(32), hosted_voucher_url: "https://payments.stripe.com/oxxo/voucher/x", expires_after: ahora() + 86400 } }; }
  return pi;
};

class StripeSimulado {
  constructor(llave) { this.llave = llave; }
  paymentIntents = paymentIntents;
  checkout = { sessions: checkoutSessions };
  confirmationTokens = {
    async retrieve(tok) {
      const t = TOKENS[tok];
      if (!t) throw invalido("No such confirmationtoken", "resource_missing");
      return { id: tok, object: "confirmation_token", payment_method_preview: { type: "card", card: t.card },
        payment_method_options: t.plan ? { card: { cvc_token: null, installments: { plan: t.plan } } } : null };
    },
  };
  customers = {
    async create(p) { const c = { id: id("cus"), object: "customer", ...p }; sim.customers.set(c.id, c); return copia(c); },
    async retrieve(cid) { const c = sim.customers.get(cid); if (!c) throw invalido("No such customer", "resource_missing"); return copia(c); },
  };
  refunds = {
    async create(p) {
      const pi = sim.pis.get(p.payment_intent);
      const ch = pi?.latest_charge;
      if (!ch) throw invalido("No charge");
      if (ch.payment_method_details.type === "oxxo") throw invalido("OXXO payments cannot be refunded.");
      if (ch.refunded) throw invalido("Charge has already been refunded.", "charge_already_refunded");
      ch.refunded = true;
      return { id: id("re"), object: "refund" };
    },
  };
  testHelpers = {
    customers: {
      async fundCashBalance(cid, p) {
        if (!sim.customers.has(cid)) throw invalido("No such customer", "resource_missing");
        // Stripe concilia la transferencia con el cobro por su referencia.
        const pi = [...sim.pis.values()].find((x) => x.customer === cid && x.status === "requires_action" && x.next_action?.display_bank_transfer_instructions?.reference === p.reference);
        despues(800, () => {
          if (!pi) return;
          const ins = pi.next_action.display_bank_transfer_instructions;
          ins.amount_remaining -= p.amount;
          if (ins.amount_remaining <= 0) { pi.status = "succeeded"; pi.next_action = null; cargo(pi, "customer_balance", { customer_balance: {} }); }
        });
        return { id: id("ccsbtxn"), object: "customer_cash_balance_transaction" };
      },
    },
  };
  webhooks = {
    constructEvent(cuerpo, encabezado, secreto) {
      const partes = Object.fromEntries(String(encabezado ?? "").split(",").map((x) => x.split("=")));
      const esperada = crypto.createHmac("sha256", secreto).update(`${partes.t}.${cuerpo.toString()}`).digest("hex");
      if (!partes.v1 || partes.v1 !== esperada) throw new Error("No signatures found matching the expected signature for payload");
      return JSON.parse(cuerpo.toString());
    },
  };
}

export { StripeSimulado, sim, id, cargo, ahora };
