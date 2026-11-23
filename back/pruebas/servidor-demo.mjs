// Backend de demostración:  npm run demo
//
// Levanta el backend REAL en http://localhost:4000 con una base PostgreSQL
// temporal (embedded-postgres), Stripe simulado y las demás APIs de terceros
// simuladas (PayPal, Mercado Libre, Banxico y COPOMEX), igual que las pruebas.
// Sirve para enseñar o probar la tienda y el panel sin cuentas:
//   - Los pagos OXXO, SPEI y link de pago funcionan (simulados).
//   - PayPal abre una página que imita su checkout (Pagar / Cancelar).
//   - Tipo de cambio, autollenado por C.P. (prueba 44100) y comparador de
//     Mercado Libre responden con datos de ejemplo.
//   - Tarjeta NO: el formulario de tarjeta es de Stripe.js y necesita llaves reales.
//   - Los correos quedan como "simulado" en /admin/correos.
// Al cerrar (Ctrl+C) se borra la base; nada se guarda.
import { mock } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { StripeSimulado, WHSEC } from "./stripe-simulado.mjs";
import { apis, iniciarApisSimuladas } from "./apis-simuladas.mjs";

const PUERTO_PG = 5547; // distinto al de las pruebas: se pueden correr con el demo encendido
const carpeta = path.join(os.tmpdir(), `vinylink-demo-${Date.now()}`);
const postgres = new EmbeddedPostgres({
  databaseDir: carpeta,
  user: "postgres",
  password: "demo",
  port: PUERTO_PG,
  persistent: false,
  onLog: () => {},
  // PostgreSQL 18 en Windows deja vivo un proceso "io_worker" al apagarse,
  // que bloquea la carpeta temporal; con io_method=sync no se crean.
  postgresFlags: ["-c", "io_method=sync"],
});
console.log("Levantando PostgreSQL temporal para la demo...");
await postgres.initialise();
await postgres.start();
await postgres.createDatabase("demo");
apis.demo = true;
const simuladas = await iniciarApisSimuladas();

Object.assign(process.env, {
  DATABASE_URL: `postgresql://postgres:demo@localhost:${PUERTO_PG}/demo`,
  PORT: process.env.PORT ?? "4000",
  STRIPE_SECRET_KEY: "sk_test_simulado",
  STRIPE_PUBLISHABLE_KEY: "pk_test_simulado",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  WEB_URL: process.env.WEB_URL ?? "http://localhost:4321",
  SMTP_HOST: "",
  AGENTE_URL: process.env.AGENTE_URL ?? "",
  ...simuladas.env,
});
mock.module("stripe", { exports: { default: StripeSimulado } });

async function apagar() {
  console.log("\nApagando la demo y borrando la base temporal...");
  const { pool } = await import("../src/db.js");
  await pool.end().catch(() => {});
  simuladas.servidor.close();
  await postgres.stop().catch(() => {});
  await fs.rm(carpeta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);

await import("../src/index.js");
console.log("Demo lista: usuarios admin@tienda.com / admin123 e invitado@tienda.com / invitado123.");
