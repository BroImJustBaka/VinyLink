// Conexión con PayPal (REST API, Orders v2). Variables de back/.env:
//   PAYPAL_CLIENT_ID      Client ID de la app (developer.paypal.com → Apps & Credentials)
//   PAYPAL_CLIENT_SECRET  Secret de la misma app
//   PAYPAL_API_URL        https://api-m.sandbox.paypal.com (pruebas, por defecto)
//                         o https://api-m.paypal.com (dinero real)
// Sin Client ID o Secret el backend arranca igual, sin el método PayPal.
//
// Flujo de un pago:
//   1. crearOrden(): PayPal regresa un link de aprobación ("payer-action").
//   2. El cliente entra a PayPal, inicia sesión y aprueba el pago.
//   3. PayPal lo regresa a /pedido/[id] y el backend CAPTURA la orden
//      (capturarOrden): hasta ese momento no se ha cobrado nada.
import "dotenv/config";
import { pedirJson, limpiarEnv, ErrorDeServicio } from "../../lib/http.js";

const clientId = limpiarEnv(process.env.PAYPAL_CLIENT_ID);
const secreto = limpiarEnv(process.env.PAYPAL_CLIENT_SECRET);
const API = (limpiarEnv(process.env.PAYPAL_API_URL) ?? "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");

export const paypalHabilitado = Boolean(clientId && secreto);
export const paypalModoPrueba = !API.includes("api-m.paypal.com");

// ------------------------------------------------------------ autenticación
// PayPal usa OAuth 2 "client credentials": se cambia el Client ID y el
// Secret por un token que dura ~9 horas. Se guarda y se renueva un minuto antes.
let token = null;
let tokenVence = 0;

async function obtenerToken() {
  if (token && Date.now() < tokenVence) return token;
  const basica = Buffer.from(`${clientId}:${secreto}`).toString("base64");
  const r = await pedirJson("PayPal", `${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basica}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  token = r.access_token;
  tokenVence = Date.now() + (Number(r.expires_in) - 60) * 1000;
  return token;
}

export function requirePaypal() {
  if (!paypalHabilitado) {
    throw new Error("PayPal no está configurado: faltan PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET en back/.env");
  }
}

// `idempotencia` = PayPal-Request-Id: si la red falla y se repite la misma
// petición, PayPal responde lo mismo en vez de crear o cobrar dos veces.
async function llamar(ruta, { method = "GET", body, idempotencia } = {}) {
  requirePaypal();
  return pedirJson("PayPal", `${API}${ruta}`, {
    method,
    timeoutMs: 15000,
    headers: {
      Authorization: `Bearer ${await obtenerToken()}`,
      "Content-Type": "application/json",
      ...(idempotencia ? { "PayPal-Request-Id": idempotencia } : {}),
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const montoPayPal = (centavos) => ({ currency_code: "MXN", value: (centavos / 100).toFixed(2) });

// ------------------------------------------------------------ operaciones
export function crearOrden({ pedidoId, totalCentavos, descripcion, returnUrl, cancelUrl, idempotencia }) {
  return llamar("/v2/checkout/orders", {
    method: "POST",
    idempotencia,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `pedido-${pedidoId}`,
          custom_id: String(pedidoId),
          description: descripcion.slice(0, 127),
          amount: montoPayPal(totalCentavos),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "VinyLink",
            locale: "es-MX",
            landing_page: "LOGIN",
            // La dirección de envío ya la capturamos en el checkout.
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });
}

export const verOrden = (ordenId) => llamar(`/v2/checkout/orders/${encodeURIComponent(ordenId)}`);

export const capturarOrden = (ordenId) =>
  llamar(`/v2/checkout/orders/${encodeURIComponent(ordenId)}/capture`, {
    method: "POST",
    idempotencia: `captura-${ordenId}`,
    body: {},
  });

export const reembolsarCaptura = (capturaId, centavos, { idempotencia, nota } = {}) =>
  llamar(`/v2/payments/captures/${encodeURIComponent(capturaId)}/refund`, {
    method: "POST",
    idempotencia,
    body: { amount: montoPayPal(centavos), ...(nota ? { note_to_payer: nota.slice(0, 255) } : {}) },
  });

// ------------------------------------------------------------ lectura
// Traduce una orden de PayPal a nuestro estado de pago (igual que
// leerPaymentIntent hace con Stripe).
export function leerOrden(orden) {
  const unidad = orden.purchase_units?.[0];
  const captura = unidad?.payments?.captures?.[0] ?? null;
  const aprobacion = orden.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;

  const detalle = {
    paypal: {
      ordenId: orden.id,
      ...(aprobacion ? { url: aprobacion } : {}),
      ...(orden.payer?.email_address ? { correoPagador: orden.payer.email_address } : {}),
    },
  };

  let estadoPago = "requiere_accion"; // falta que el cliente apruebe en PayPal
  let error = null;
  if (orden.status === "APPROVED") {
    estadoPago = "requiere_accion"; // aprobada: falta capturarla
  } else if (orden.status === "VOIDED") {
    estadoPago = "cancelado";
    error = "La orden de PayPal se anuló.";
  } else if (orden.status === "COMPLETED") {
    const st = captura?.status;
    if (st === "COMPLETED") estadoPago = "pagado";
    else if (st === "REFUNDED") estadoPago = "reembolsado";
    else if (st === "PENDING") estadoPago = "pendiente"; // PayPal lo está revisando
    else {
      estadoPago = "fallido";
      error = "PayPal rechazó el cobro. Intenta con otra cuenta o método de pago.";
    }
  }

  return {
    estadoPago,
    detalle,
    error,
    paypalOrderId: orden.id,
    paypalCaptureId: captura?.id ?? null,
    aprobada: orden.status === "APPROVED",
  };
}

// Mensaje para el cliente cuando PayPal rechaza una operación.
export function mensajeDeErrorPaypal(err) {
  if (!(err instanceof ErrorDeServicio)) return "No pudimos comunicarnos con PayPal. Intenta de nuevo.";
  const detalle = err.cuerpo?.details?.[0]?.issue;
  if (err.status === 401) return "Los pagos con PayPal no están bien configurados en la tienda (credenciales inválidas).";
  if (detalle === "INSTRUMENT_DECLINED") return "PayPal rechazó el método de pago. Elige otro dentro de PayPal.";
  if (detalle === "ORDER_NOT_APPROVED") return "Todavía no apruebas el pago en PayPal.";
  if (detalle === "CURRENCY_NOT_SUPPORTED") return "PayPal no aceptó pesos mexicanos en esta cuenta.";
  return err.message;
}

export function revisarConfiguracionPaypal() {
  if (!paypalHabilitado) {
    console.warn("⚠ PayPal: faltan PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET en back/.env, el método PayPal está desactivado.");
    return;
  }
  console.log(`PayPal listo en modo ${paypalModoPrueba ? "SANDBOX (sin dinero real)" : "REAL"}.`);
  obtenerToken().catch((err) =>
    console.error(
      err?.status === 401
        ? "✖ PayPal rechazó PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET. Vuelve a copiarlos de developer.paypal.com y reinicia el backend."
        : `⚠ PayPal: no se pudo comprobar la configuración: ${err.message}`
    )
  );
}

// Solo para las pruebas automáticas: olvida el token guardado.
export function _reiniciarToken() {
  token = null;
  tokenVence = 0;
}
