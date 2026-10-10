// Conexión con Stripe. Las llaves salen de back/.env:
//   STRIPE_SECRET_KEY       sk_test_... (pruebas) o sk_live_... (dinero real)
//   STRIPE_PUBLISHABLE_KEY  pk_test_... / pk_live_...  (la usa el navegador)
//   STRIPE_WEBHOOK_SECRET   whsec_... (la da `stripe listen` o el Dashboard)
//   WEB_URL                 dirección del frontend, para los regresos de Stripe
// Si falta la llave secreta el backend arranca igual, pero sin pagos en línea.
import Stripe from "stripe";
import "dotenv/config";

const limpiar = (valor) => valor?.trim() || null;

const llaveSecreta = limpiar(process.env.STRIPE_SECRET_KEY);

export const stripe = llaveSecreta ? new Stripe(llaveSecreta, { maxNetworkRetries: 2 }) : null;
export const publishableKey = limpiar(process.env.STRIPE_PUBLISHABLE_KEY);
export const webhookSecret = limpiar(process.env.STRIPE_WEBHOOK_SECRET);
export const WEB_URL = (limpiar(process.env.WEB_URL) ?? "http://localhost:4321").replace(/\/+$/, "");

// Las llaves de prueba empiezan con sk_test_ / pk_test_: ahí nunca se mueve dinero.
export const modoPrueba = !llaveSecreta || llaveSecreta.startsWith("sk_test_");

export function requireStripe() {
  if (!stripe) {
    throw new Error(
      "Los pagos en línea no están configurados: falta STRIPE_SECRET_KEY en back/.env"
    );
  }
  return stripe;
}

// Avisos al arrancar, para detectar llaves mal copiadas antes de cobrar.
export function revisarConfiguracion() {
  if (!stripe) {
    console.warn("⚠ Stripe: falta STRIPE_SECRET_KEY en back/.env, los pagos están desactivados.");
    return;
  }
  if (!publishableKey) {
    console.warn("⚠ Stripe: falta STRIPE_PUBLISHABLE_KEY; el formulario de tarjeta no podrá cargar.");
  } else if (publishableKey.startsWith("pk_test_") !== modoPrueba) {
    console.warn("⚠ Stripe: mezclaste una llave de prueba con una real; deben ser del mismo modo.");
  }
  if (!webhookSecret) {
    console.warn(
      "⚠ Stripe: falta STRIPE_WEBHOOK_SECRET; los avisos de Stripe se rechazarán (los pagos se actualizan igual consultando a Stripe)."
    );
  }
  console.log(`Stripe listo en modo ${modoPrueba ? "PRUEBA (sin dinero real)" : "REAL"}.`);

  // Una llamada barata para saber desde el arranque si la llave secreta sirve
  // (mal copiada, borrada o regenerada en el Dashboard).
  stripe.balance.retrieve().catch((err) => {
    if (err.type === "StripeAuthenticationError") {
      console.error(
        "✖ Stripe rechazó STRIPE_SECRET_KEY (llave inválida). Vuelve a copiarla del Dashboard → Desarrolladores → Claves de API y reinicia el backend."
      );
    } else {
      console.warn("⚠ Stripe: no se pudo comprobar la llave secreta:", err.message);
    }
  });
}
