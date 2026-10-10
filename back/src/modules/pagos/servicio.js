// Cobros con Stripe para los cinco métodos de pago de la tienda:
//
//   credito / debito → Payment Element + PaymentIntent (con meses sin intereses en crédito)
//   oxxo             → PaymentIntent que genera una ficha para pagar en efectivo
//   spei             → PaymentIntent que da una CLABE para transferir desde el banco
//   link             → Checkout Session: una página de Stripe que se puede compartir
//
// Flujo común: se crea el pedido "pendiente" apartando el stock, se le pide
// el cobro a Stripe y se guarda lo que respondió. Después, el webhook, la
// página del pedido o la revisión periódica le vuelven a preguntar a Stripe y
// llaman a aplicarEstado(), que es el ÚNICO lugar donde cambia un estado.
import { randomUUID } from "node:crypto";
import { one, transaccion } from "../../lib/sql.js";
import {
  crearPedidoPendiente,
  devolverStock,
  volverAApartarStock,
  vaciarCarrito,
} from "../pedidos/servicio.js";
import { stripe, requireStripe, WEB_URL, modoPrueba } from "./stripe.js";

export const METODOS = ["credito", "debito", "oxxo", "spei", "link"];
const METODOS_TARJETA = ["credito", "debito"];

export const MINIMO_CENTAVOS = 1000; // Stripe no cobra menos de $10.00 MXN
export const MAXIMO_OXXO_CENTAVOS = 1000000; // una ficha OXXO admite hasta $10,000.00 MXN
const DIAS_FICHA_OXXO = 3; // la ficha OXXO vence a los 3 días
const SEGUNDOS_LINK = 24 * 60 * 60 - 5 * 60; // el link dura 24 h (menos 5 min de margen)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const segundosAIso = (segundos) => (segundos ? new Date(segundos * 1000).toISOString() : null);
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

const descripcion = (pedidoId) => `VinyLink · pedido #${pedidoId}`;
const metadatos = (pedidoId, usuarioId) => ({
  pedido_id: String(pedidoId),
  usuario_id: String(usuarioId),
});

// ------------------------------------------------------------
// Mensajes de error en español
// ------------------------------------------------------------

// Por seguridad no se le dice al cliente si la tarjeta está reportada como
// robada o fraudulenta: solo que el banco la rechazó.
const MENSAJES_RECHAZO = {
  insufficient_funds: "La tarjeta no tiene fondos suficientes.",
  card_declined: "El banco rechazó la tarjeta.",
  generic_decline: "El banco rechazó la tarjeta.",
  do_not_honor: "El banco rechazó la tarjeta.",
  fraudulent: "El banco rechazó la tarjeta.",
  lost_card: "El banco rechazó la tarjeta.",
  stolen_card: "El banco rechazó la tarjeta.",
  expired_card: "La tarjeta está vencida.",
  incorrect_cvc: "El código de seguridad (CVC) es incorrecto.",
  invalid_cvc: "El código de seguridad (CVC) es incorrecto.",
  incorrect_number: "El número de tarjeta es incorrecto.",
  invalid_number: "El número de tarjeta es incorrecto.",
  invalid_expiry_month: "La fecha de vencimiento es incorrecta.",
  invalid_expiry_year: "La fecha de vencimiento es incorrecta.",
  processing_error: "Hubo un error al procesar la tarjeta. Intenta de nuevo.",
  card_velocity_exceeded: "La tarjeta superó su límite de compras. Prueba con otra.",
  authentication_required: "Tu banco pidió verificar la compra y no se completó.",
  payment_intent_authentication_failure:
    "No se completó la verificación de tu banco (3D Secure). Intenta de nuevo.",
  transaction_not_allowed:
    "Tu banco no permitió este cargo. Si elegiste meses sin intereses, prueba sin meses.",
  payment_intent_payment_attempt_expired: "La ficha OXXO venció sin pagarse.",
};

// Convierte un error de Stripe (o el `last_payment_error` de un cobro) en un
// mensaje para el cliente.
export function mensajeDeError(err) {
  const e = err?.raw ?? err ?? {};
  const conocido = MENSAJES_RECHAZO[e.decline_code] ?? MENSAJES_RECHAZO[e.code];
  if (conocido) return conocido;
  if (e.type === "card_error") return `El pago fue rechazado: ${e.message}`;
  if (e.type === "invalid_request_error") return `Stripe rechazó la operación: ${e.message}`;
  if (e.type === "authentication_error" || err?.type === "StripeAuthenticationError") {
    return "Los pagos no están bien configurados en la tienda (llave de Stripe inválida).";
  }
  return "No pudimos comunicarnos con Stripe. Intenta de nuevo en unos segundos.";
}

// ------------------------------------------------------------
// Leer lo que responde Stripe
// ------------------------------------------------------------

// Traduce un PaymentIntent a nuestro estado de pago y a los datos que se le
// muestran al cliente (ficha OXXO, CLABE, tarjeta usada).
export function leerPaymentIntent(pi) {
  const detalle = {};
  const accion = pi.next_action;

  if (accion?.oxxo_display_details) {
    const o = accion.oxxo_display_details;
    detalle.oxxo = {
      referencia: o.number,
      urlFicha: o.hosted_voucher_url,
      expiraEn: segundosAIso(o.expires_after),
    };
  }

  if (accion?.display_bank_transfer_instructions) {
    const b = accion.display_bank_transfer_instructions;
    const spei = b.financial_addresses?.find((f) => f.type === "spei")?.spei;
    detalle.spei = {
      clabe: spei?.clabe ?? null,
      banco: spei?.bank_name ?? null,
      referencia: b.reference ?? null,
      montoRestanteCentavos: b.amount_remaining ?? null,
      urlInstrucciones: b.hosted_instructions_url ?? null,
    };
  }

  // `latest_charge` solo trae datos si se pidió con expand: ["latest_charge"].
  const cargo = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const tarjeta = cargo?.payment_method_details?.card;
  if (tarjeta) {
    detalle.tarjeta = { marca: tarjeta.brand, ultimos4: tarjeta.last4, fondos: tarjeta.funding };
    if (tarjeta.installments?.plan?.count) detalle.meses = tarjeta.installments.plan.count;
  }
  if (cargo?.payment_method_details?.type) detalle.tipoStripe = cargo.payment_method_details.type;

  let estadoPago = "pendiente";
  let error = null;
  if (pi.status === "succeeded") {
    estadoPago = cargo?.refunded ? "reembolsado" : "pagado";
  } else if (pi.status === "requires_action") {
    estadoPago = "requiere_accion";
  } else if (pi.status === "canceled") {
    estadoPago = "cancelado";
  } else if (pi.status === "requires_payment_method") {
    // Nuestros cobros se confirman al crearse (confirm: true), así que volver
    // a "requiere método de pago" solo pasa si el intento falló: tarjeta
    // rechazada, 3D Secure fallido o ficha OXXO vencida. (El link de pago es
    // la excepción y lo corrige leerCheckoutSession.)
    estadoPago = "fallido";
    error = pi.last_payment_error
      ? mensajeDeError(pi.last_payment_error)
      : pi.payment_method_types?.includes("oxxo")
        ? "La ficha OXXO venció sin pagarse."
        : "El pago no se completó.";
  }

  return { estadoPago, detalle, error, paymentIntentId: pi.id };
}

// Traduce una Checkout Session (link de pago).
export function leerCheckoutSession(session) {
  const pi =
    session.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent
      : null;
  const lectura = pi
    ? leerPaymentIntent(pi)
    : { estadoPago: "pendiente", detalle: {}, error: null, paymentIntentId: null };
  lectura.checkoutSessionId = session.id;
  // Stripe borra la URL cuando el link se usa o vence; la guardada se conserva.
  if (session.url) {
    lectura.detalle.link = { url: session.url, expiraEn: segundosAIso(session.expires_at) };
  }

  if (session.status === "open") {
    // Mientras el link siga abierto, un intento rechazado no cancela el pedido:
    // quien paga puede volver a intentar con otra tarjeta en la misma página.
    if (lectura.estadoPago !== "pagado") {
      lectura.estadoPago = "pendiente";
      lectura.error = null;
    }
  } else if (session.status === "expired") {
    if (!["pagado", "reembolsado"].includes(lectura.estadoPago)) {
      lectura.estadoPago = "cancelado";
      lectura.error = "El link de pago venció sin pagarse.";
    }
  } else if (session.payment_status === "paid" && lectura.estadoPago !== "reembolsado") {
    lectura.estadoPago = "pagado";
  }
  return lectura;
}

// ------------------------------------------------------------
// Cambios de estado
// ------------------------------------------------------------

// Reglas para que un aviso viejo o repetido no "regrese" un pago en el tiempo.
function siguienteEstadoPago(actual, propuesto) {
  if (!propuesto || actual === propuesto) return actual;
  if (actual === "reembolsado") return actual; // estado final
  if (actual === "pagado") return propuesto === "reembolsado" ? propuesto : actual;
  // Un pago que se pagó tarde (después de cancelarse) sí se respeta.
  if (actual === "fallido" || actual === "cancelado") return propuesto === "pagado" ? propuesto : actual;
  return propuesto; // pendiente o requiere_accion pueden pasar a cualquiera
}

async function cancelarIntentSinError(paymentIntentId) {
  try {
    await stripe?.paymentIntents.cancel(paymentIntentId);
  } catch {
    /* ya estaba cancelado o en un estado que no se puede cancelar */
  }
}

// Único lugar donde cambian el estado del pago y el de su pedido. Es
// idempotente: aplicar dos veces la misma lectura no hace nada nuevo, así
// que da igual si el aviso llega por webhook, por sondeo o por las dos vías.
//   lectura = { estadoPago, detalle, error, paymentIntentId, checkoutSessionId }
export async function aplicarEstado(pedidoId, lectura, { reponerStock = false } = {}) {
  const resultado = await transaccion(async (client) => {
    // FOR UPDATE: si llegan dos avisos al mismo tiempo, el segundo espera al primero.
    const { rows: pedidos } = await client.query("SELECT * FROM pedido WHERE id = $1 FOR UPDATE", [
      pedidoId,
    ]);
    const { rows: pagos } = await client.query(
      "SELECT * FROM pago WHERE pedido_id = $1 FOR UPDATE",
      [pedidoId]
    );
    const pedido = pedidos[0];
    const pago = pagos[0];
    if (!pedido || !pago) return null;

    const nuevo = siguienteEstadoPago(pago.estado, lectura.estadoPago);
    const error = nuevo === "pagado" ? null : lectura.error ?? pago.error;
    await client.query(
      `UPDATE pago
          SET estado = $2,
              detalle = detalle || $3::jsonb,
              error = $4,
              -- Si Stripe reporta un id, se guarda el más reciente (en un link de
              -- pago el cobro puede aparecer después); si no, se conserva el que había.
              stripe_payment_intent_id = COALESCE($5, stripe_payment_intent_id),
              stripe_checkout_session_id = COALESCE($6, stripe_checkout_session_id),
              actualizado_en = NOW()
        WHERE id = $1`,
      [
        pago.id,
        nuevo,
        JSON.stringify(lectura.detalle ?? {}),
        error,
        lectura.paymentIntentId ?? null,
        lectura.checkoutSessionId ?? null,
      ]
    );

    let estado = pedido.estado;
    let pagadoEn = pedido.pagado_en;
    let nota = pedido.nota;
    const cambio = nuevo !== pago.estado;

    if (cambio && nuevo === "pagado") {
      pagadoEn = new Date();
      if (pedido.estado === "pendiente") {
        estado = "pagado";
      } else if (pedido.estado === "cancelado") {
        // Caso raro: se pagó cuando el pedido ya se había cancelado.
        estado = "pagado";
        nota = (await volverAApartarStock(client, pedidoId))
          ? "Se pagó después de cancelarse; el stock se volvió a apartar."
          : "Se pagó después de cancelarse y ya no hay stock suficiente: consigue las piezas o reembolsa el pago.";
      }
    } else if (cambio && (nuevo === "fallido" || nuevo === "cancelado") && pedido.estado === "pendiente") {
      estado = "cancelado";
      await devolverStock(client, pedidoId);
    } else if (cambio && nuevo === "reembolsado") {
      estado = "reembolsado";
      if (reponerStock) await devolverStock(client, pedidoId);
    }

    if (estado !== pedido.estado || nota !== pedido.nota) {
      await client.query(
        "UPDATE pedido SET estado = $2, pagado_en = $3, nota = $4 WHERE id = $1",
        [pedidoId, estado, pagadoEn, nota]
      );
    }
    return {
      pedido: { ...pedido, estado },
      pago: { ...pago, estado: nuevo, error },
      cambio,
    };
  });

  // Efectos fuera de la transacción (no deben deshacer el cambio si fallan).
  if (resultado?.cambio) {
    const { pedido, pago } = resultado;
    // Con tarjeta el carrito se vacía hasta que el cobro pasa: si se rechaza,
    // el cliente conserva su carrito para intentar con otra tarjeta.
    if (pago.estado === "pagado" && METODOS_TARJETA.includes(pago.metodo)) {
      await vaciarCarrito(pedido.usuario_id);
    }
    // Un cobro directo que falló se cancela también en Stripe, para que nadie
    // lo pueda reintentar cuando el stock ya se devolvió.
    if (pago.estado === "fallido" && pago.metodo !== "link" && lectura.paymentIntentId) {
      await cancelarIntentSinError(lectura.paymentIntentId);
    }
  }
  return resultado;
}

// Le pregunta a Stripe cómo va el cobro de un pedido y lo aplica. Lo usan el
// webhook, la página del pedido (sondeo) y la revisión periódica.
export async function sincronizarPedido(pedidoId) {
  if (!stripe) return null;
  const pago = await one("SELECT * FROM pago WHERE pedido_id = $1", [pedidoId]);
  if (!pago) return null;

  let lectura;
  if (pago.stripe_checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(pago.stripe_checkout_session_id, {
      expand: ["payment_intent.latest_charge"],
    });
    lectura = leerCheckoutSession(session);
  } else if (pago.stripe_payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(pago.stripe_payment_intent_id, {
      expand: ["latest_charge"],
    });
    lectura = leerPaymentIntent(pi);
  } else {
    return null; // el cobro nunca llegó a Stripe; lo resuelve la revisión de vencimientos
  }
  return aplicarEstado(pedidoId, lectura);
}

// ------------------------------------------------------------
// Cobrar (un método por función)
// ------------------------------------------------------------

function validadorDeTotal(metodo) {
  return (totalCentavos) => {
    if (totalCentavos < MINIMO_CENTAVOS) {
      throw new Error("El total mínimo para pagar en línea es de $10.00 MXN");
    }
    if (metodo === "oxxo" && totalCentavos > MAXIMO_OXXO_CENTAVOS) {
      throw new Error("OXXO solo acepta pagos de hasta $10,000.00 MXN. Elige otro método de pago.");
    }
  };
}

// El cobro ni siquiera se pudo crear (tarjeta rechazada, error de Stripe):
// se cancela el pedido para devolver el stock y se avisa al cliente.
// Llave de idempotencia: si la red falla y stripe-node reintenta la MISMA
// llamada, Stripe reconoce la llave y no cobra dos veces. Lleva un UUID porque
// el número de pedido solo es único dentro de una base de datos: otra base
// (por ejemplo una de pruebas) conectada a la misma cuenta de Stripe repetiría
// "pedido-14-cobro" y Stripe rechazaría el cobro por reusar la llave.
function llaveIdempotencia(pedidoId, accion) {
  return `pedido-${pedidoId}-${accion}-${randomUUID()}`;
}

async function fallarCobro(pedidoId, err) {
  const mensaje = mensajeDeError(err);
  // Los rechazos de tarjeta son normales; lo demás se muestra completo para depurar.
  if (err?.type !== "StripeCardError") {
    console.error(`Stripe rechazó el cobro del pedido ${pedidoId}:`, err?.type, err?.message);
  }
  await aplicarEstado(pedidoId, {
    estadoPago: "fallido",
    detalle: {},
    error: mensaje,
    paymentIntentId: err?.raw?.payment_intent?.id ?? null,
  });
  throw new Error(mensaje);
}

// Stripe dice si la tarjeta es de crédito, débito o prepago (`funding`).
function validarTipoDeTarjeta(metodo, funding) {
  if (!funding || funding === "unknown") return; // el banco no lo informa: se acepta
  if (metodo === "credito" && funding !== "credit") {
    throw new Error(
      "Esta tarjeta es de débito. Elige «Tarjeta de débito» o usa una tarjeta de crédito."
    );
  }
  if (metodo === "debito" && funding === "credit") {
    throw new Error(
      "Esta tarjeta es de crédito. Elige «Tarjeta de crédito» (ahí también puedes pagar a meses)."
    );
  }
}

async function pagarConTarjeta({ usuario, items, metodo, confirmationTokenId }) {
  const s = requireStripe();
  if (!confirmationTokenId) throw new Error("Faltan los datos de la tarjeta");

  // 1) Revisar la tarjeta ANTES de apartar stock o cobrar.
  let token;
  try {
    token = await s.confirmationTokens.retrieve(confirmationTokenId);
  } catch (err) {
    console.error("Stripe no pudo leer el ConfirmationToken:", err.message);
    if (err.type === "StripeAuthenticationError") {
      throw new Error("Los pagos no están bien configurados en la tienda (llave de Stripe inválida).");
    }
    throw new Error("No pudimos leer los datos de la tarjeta. Vuelve a escribirlos.");
  }
  const tarjeta = token.payment_method_preview?.card;
  if (!tarjeta) throw new Error("Este método solo acepta tarjetas");
  validarTipoDeTarjeta(metodo, tarjeta.funding);
  // Plan de meses sin intereses que el cliente eligió en el formulario (o null).
  const plan = token.payment_method_options?.card?.installments?.plan ?? null;
  if (plan && metodo !== "credito") {
    throw new Error("Los meses sin intereses solo aplican con tarjeta de crédito");
  }

  // 2) Pedido pendiente con el stock apartado.
  const { pedido, totalCentavos } = await crearPedidoPendiente({
    usuarioId: usuario.id,
    items,
    metodo,
    validarTotal: validadorDeTotal(metodo),
  });

  // 3) Cobrar. confirm: true = crear y cobrar en la misma llamada.
  let intent;
  try {
    intent = await s.paymentIntents.create(
      {
        amount: totalCentavos,
        currency: "mxn",
        payment_method_types: ["card"],
        confirmation_token: confirmationTokenId,
        confirm: true,
        // Activa meses sin intereses. El plan que eligió el cliente ya viaja
        // dentro del token; Stripe rechaza que se mande otra vez aquí.
        payment_method_options:
          metodo === "credito" ? { card: { installments: { enabled: true } } } : undefined,
        description: descripcion(pedido.id),
        metadata: metadatos(pedido.id, usuario.id),
        return_url: `${WEB_URL}/pedido/${pedido.id}`,
        expand: ["latest_charge"],
      },
      // Si la red falla y la librería reintenta, Stripe no cobra dos veces.
      { idempotencyKey: llaveIdempotencia(pedido.id, "cobro") }
    );
  } catch (err) {
    return fallarCobro(pedido.id, err);
  }

  const resultado = await aplicarEstado(pedido.id, leerPaymentIntent(intent));
  if (resultado?.pago.estado === "fallido") throw new Error(resultado.pago.error);

  // requires_action = el banco pide 3D Secure; el navegador lo completa con
  // stripe.handleNextAction(clientSecret) y luego llama a sincronizarPago.
  const requiereAccion = intent.status === "requires_action";
  return {
    pedidoId: pedido.id,
    requiereAccion,
    clientSecret: requiereAccion ? intent.client_secret : null,
  };
}

async function pagarConOxxo({ usuario, items, nombre, email }) {
  const s = requireStripe();
  nombre = String(nombre ?? "").trim().replace(/\s+/g, " ");
  email = String(email ?? "").trim().toLowerCase();
  const palabras = nombre.split(" ");
  if (palabras.length < 2 || palabras.some((p) => p.length < 2)) {
    throw new Error("Para la ficha OXXO escribe tu nombre y apellido (de al menos 2 letras cada uno)");
  }
  if (!EMAIL.test(email)) throw new Error("Escribe un email válido para la ficha OXXO");

  const { pedido, totalCentavos } = await crearPedidoPendiente({
    usuarioId: usuario.id,
    items,
    metodo: "oxxo",
    validarTotal: validadorDeTotal("oxxo"),
  });

  let intent;
  try {
    intent = await s.paymentIntents.create(
      {
        amount: totalCentavos,
        currency: "mxn",
        payment_method_types: ["oxxo"],
        payment_method_data: { type: "oxxo", billing_details: { name: nombre, email } },
        payment_method_options: { oxxo: { expires_after_days: DIAS_FICHA_OXXO } },
        confirm: true,
        description: descripcion(pedido.id),
        metadata: metadatos(pedido.id, usuario.id),
      },
      { idempotencyKey: llaveIdempotencia(pedido.id, "cobro") }
    );
  } catch (err) {
    return fallarCobro(pedido.id, err);
  }

  await aplicarEstado(pedido.id, leerPaymentIntent(intent));
  await vaciarCarrito(usuario.id); // el pedido ya está hecho; falta que paguen la ficha
  return { pedidoId: pedido.id, requiereAccion: false, clientSecret: null };
}

// SPEI necesita un Customer de Stripe: así el cliente recibe una CLABE propia
// y Stripe sabe a qué pago aplicar cada transferencia que llega.
async function customerDeStripe(usuario) {
  const s = requireStripe();
  const fila = await one("SELECT stripe_customer_id FROM usuario WHERE id = $1", [usuario.id]);
  if (fila?.stripe_customer_id) {
    try {
      const existente = await s.customers.retrieve(fila.stripe_customer_id);
      if (!existente.deleted) return existente.id;
    } catch (err) {
      // resource_missing: el id es de otra cuenta de Stripe (cambiaste de llaves).
      if (err?.code !== "resource_missing") throw err;
    }
  }
  const customer = await s.customers.create({
    name: usuario.nombre,
    email: usuario.email,
    metadata: { usuario_id: String(usuario.id) },
  });
  await one("UPDATE usuario SET stripe_customer_id = $1 WHERE id = $2 RETURNING id", [
    customer.id,
    usuario.id,
  ]);
  return customer.id;
}

async function pagarConSpei({ usuario, items }) {
  const s = requireStripe();
  const customer = await customerDeStripe(usuario);

  const { pedido, totalCentavos } = await crearPedidoPendiente({
    usuarioId: usuario.id,
    items,
    metodo: "spei",
    validarTotal: validadorDeTotal("spei"),
  });

  let intent;
  try {
    intent = await s.paymentIntents.create(
      {
        amount: totalCentavos,
        currency: "mxn",
        customer,
        payment_method_types: ["customer_balance"],
        payment_method_data: { type: "customer_balance" },
        payment_method_options: {
          customer_balance: {
            funding_type: "bank_transfer",
            bank_transfer: { type: "mx_bank_transfer" },
          },
        },
        confirm: true,
        description: descripcion(pedido.id),
        metadata: metadatos(pedido.id, usuario.id),
      },
      { idempotencyKey: llaveIdempotencia(pedido.id, "cobro") }
    );
  } catch (err) {
    return fallarCobro(pedido.id, err);
  }

  await aplicarEstado(pedido.id, leerPaymentIntent(intent));
  await vaciarCarrito(usuario.id);
  return { pedidoId: pedido.id, requiereAccion: false, clientSecret: null };
}

const imagenValida = (url) => /^https:\/\/\S+$/.test(url ?? "") && url.length <= 2048;

// Link de pago = Checkout Session de Stripe: una página segura con su propia
// URL que cualquiera puede abrir para pagar (con tarjeta u OXXO).
export async function crearLinkDePago({ usuario, items }) {
  const s = requireStripe();
  const { pedido, renglones, totalCentavos } = await crearPedidoPendiente({
    usuarioId: usuario.id,
    items,
    metodo: "link",
    validarTotal: validadorDeTotal("link"),
  });
  const metodos = totalCentavos <= MAXIMO_OXXO_CENTAVOS ? ["card", "oxxo"] : ["card"];

  let session;
  try {
    session = await s.checkout.sessions.create(
      {
        mode: "payment",
        locale: "es-419",
        line_items: renglones.map(({ producto, cantidad, centavos }) => ({
          quantity: cantidad,
          price_data: {
            currency: "mxn",
            unit_amount: centavos,
            product_data: {
              name: producto.nombre,
              ...(imagenValida(producto.imagen) ? { images: [producto.imagen] } : {}),
            },
          },
        })),
        payment_method_types: metodos,
        payment_method_options: {
          card: { installments: { enabled: true } },
          ...(metodos.includes("oxxo") ? { oxxo: { expires_after_days: DIAS_FICHA_OXXO } } : {}),
        },
        customer_email: usuario.email,
        client_reference_id: String(pedido.id),
        metadata: metadatos(pedido.id, usuario.id),
        payment_intent_data: {
          description: descripcion(pedido.id),
          metadata: metadatos(pedido.id, usuario.id),
        },
        expires_at: Math.floor(Date.now() / 1000) + SEGUNDOS_LINK,
        success_url: `${WEB_URL}/pago/gracias?pedido=${pedido.id}`,
      },
      { idempotencyKey: llaveIdempotencia(pedido.id, "cobro") }
    );
  } catch (err) {
    return fallarCobro(pedido.id, err);
  }

  await aplicarEstado(pedido.id, leerCheckoutSession(session));
  return { pedidoId: pedido.id, requiereAccion: false, clientSecret: null };
}

// Punto de entrada de la mutación crearPedido: elige el método.
export async function cobrar({ usuario, items, pago }) {
  requireStripe();
  const metodo = pago?.metodo;
  if (!METODOS.includes(metodo)) throw new Error("Elige un método de pago válido");
  if (METODOS_TARJETA.includes(metodo)) {
    return pagarConTarjeta({
      usuario,
      items,
      metodo,
      confirmationTokenId: pago.confirmationTokenId,
    });
  }
  if (metodo === "oxxo") return pagarConOxxo({ usuario, items, nombre: pago.nombre, email: pago.email });
  if (metodo === "spei") return pagarConSpei({ usuario, items });
  // El cliente comparte el link, así que su carrito ya se puede vaciar.
  const resultado = await crearLinkDePago({ usuario, items });
  await vaciarCarrito(usuario.id);
  return resultado;
}

// ------------------------------------------------------------
// Cancelar, reembolsar y simular (panel admin y página del pedido)
// ------------------------------------------------------------

// Cancela un pedido que sigue esperando su pago. Primero se cancela en Stripe
// (para que ya no se pueda pagar) y después se devuelve el stock.
export async function cancelarPedidoPendiente(pedidoId, motivo) {
  const pedido = await one("SELECT * FROM pedido WHERE id = $1", [pedidoId]);
  if (!pedido) throw new Error(`No existe el pedido #${pedidoId}`);
  if (pedido.estado !== "pendiente") {
    throw new Error("Solo se pueden cancelar pedidos que siguen esperando su pago");
  }
  const pago = await one("SELECT * FROM pago WHERE pedido_id = $1", [pedidoId]);
  if (!pago) {
    // Pedido sin cobro (no debería pasar): solo se cancela y se devuelve el stock.
    await transaccion(async (client) => {
      await client.query("UPDATE pedido SET estado = 'cancelado', nota = $2 WHERE id = $1", [
        pedidoId,
        motivo,
      ]);
      await devolverStock(client, pedidoId);
    });
    return null;
  }
  if (pago.estado === "requiere_accion" && pago.detalle?.oxxo) {
    throw new Error(
      "Stripe no permite cancelar una ficha OXXO antes de que venza. Si no se paga, el pedido se cancela solo."
    );
  }

  if (stripe) {
    try {
      if (pago.stripe_checkout_session_id) {
        await stripe.checkout.sessions.expire(pago.stripe_checkout_session_id);
      } else if (pago.stripe_payment_intent_id) {
        await stripe.paymentIntents.cancel(pago.stripe_payment_intent_id);
      }
    } catch (err) {
      // Stripe no lo deja cancelar: puede ser que justo se haya pagado.
      const r = await sincronizarPedido(pedidoId);
      if (r && r.pedido.estado !== "pendiente") {
        throw new Error(`Ya no se puede cancelar: el pedido quedó como "${r.pedido.estado}".`);
      }
      throw new Error(`Stripe no permitió cancelar el pago: ${mensajeDeError(err)}`);
    }
  }
  return aplicarEstado(pedidoId, { estadoPago: "cancelado", detalle: {}, error: motivo });
}

export async function reembolsarPedido(pedidoId, { reponerStock = true } = {}) {
  const s = requireStripe();
  const pedido = await one("SELECT * FROM pedido WHERE id = $1", [pedidoId]);
  const pago = await one("SELECT * FROM pago WHERE pedido_id = $1", [pedidoId]);
  if (!pedido) throw new Error(`No existe el pedido #${pedidoId}`);
  if (!["pagado", "enviado", "entregado"].includes(pedido.estado)) {
    throw new Error("Solo se pueden reembolsar pedidos pagados");
  }
  if (!pago?.stripe_payment_intent_id || pago.estado !== "pagado") {
    throw new Error("Este pedido no se cobró con Stripe; no hay un pago en línea que reembolsar");
  }

  const pi = await s.paymentIntents.retrieve(pago.stripe_payment_intent_id, {
    expand: ["latest_charge"],
  });
  const tipo = pi.latest_charge?.payment_method_details?.type;
  if (tipo !== "card") {
    throw new Error(
      tipo === "oxxo"
        ? "Stripe no permite reembolsar pagos hechos en OXXO. Devuelve el dinero por otro medio (por ejemplo, una transferencia)."
        : "Los pagos por SPEI se reembolsan desde el Dashboard de Stripe, porque se necesita la cuenta bancaria del cliente."
    );
  }

  let reembolso;
  try {
    reembolso = await s.refunds.create(
      { payment_intent: pi.id, reason: "requested_by_customer", metadata: { pedido_id: String(pedidoId) } },
      { idempotencyKey: llaveIdempotencia(pedidoId, "reembolso") }
    );
  } catch (err) {
    throw new Error(`Stripe no pudo hacer el reembolso: ${mensajeDeError(err)}`);
  }
  await one("UPDATE pago SET stripe_reembolso_id = $2 WHERE id = $1 RETURNING id", [
    pago.id,
    reembolso.id,
  ]);
  return aplicarEstado(
    pedidoId,
    { estadoPago: "reembolsado", detalle: {}, error: null },
    { reponerStock }
  );
}

// Solo en modo de prueba: Stripe deja "fingir" que llegó la transferencia SPEI.
export async function simularTransferenciaSpei(pedidoId) {
  const s = requireStripe();
  if (!modoPrueba) throw new Error("La simulación solo existe en modo de prueba");
  const pago = await one("SELECT * FROM pago WHERE pedido_id = $1", [pedidoId]);
  if (pago?.metodo !== "spei" || !["pendiente", "requiere_accion"].includes(pago.estado)) {
    throw new Error("Este pedido no está esperando una transferencia SPEI");
  }
  const pi = await s.paymentIntents.retrieve(pago.stripe_payment_intent_id);
  const instrucciones = pi.next_action?.display_bank_transfer_instructions;
  await s.testHelpers.customers.fundCashBalance(pi.customer, {
    amount: instrucciones?.amount_remaining ?? pi.amount,
    currency: "mxn",
    reference: instrucciones?.reference ?? `PEDIDO${pedidoId}`,
  });
  // Stripe concilia el depósito con el pago en uno o dos segundos.
  let resultado = null;
  for (let intento = 0; intento < 6; intento++) {
    await esperar(1500);
    resultado = await sincronizarPedido(pedidoId);
    if (resultado?.pago.estado === "pagado") break;
  }
  return resultado;
}
