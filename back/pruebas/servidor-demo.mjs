// Backend de demostración:  npm run demo
//
// Levanta el backend REAL en http://localhost:4000 con una base PostgreSQL
// temporal (embedded-postgres) y Stripe simulado, igual que las pruebas.
// Sirve para enseñar o probar el panel sin cuenta de Neon ni de Stripe:
//   - Los pagos OXXO, SPEI y link de pago funcionan (simulados).
//   - Tarjeta NO: el formulario de tarjeta es de Stripe.js y necesita llaves reales.
//   - Los correos quedan como "simulado" en /admin/correos.
// Al cerrar (Ctrl+C) se borra la base; nada se guarda.
import { mock } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { StripeSimulado, WHSEC } from "./stripe-simulado.mjs";

const PUERTO_PG = 5546;
const carpeta = path.join(os.tmpdir(), `vinylink-demo-${Date.now()}`);
const postgres = new EmbeddedPostgres({
  databaseDir: carpeta,
  user: "postgres",
  password: "demo",
  port: PUERTO_PG,
  persistent: false,
  onLog: () => {},
});
console.log("Levantando PostgreSQL temporal para la demo...");
await postgres.initialise();
await postgres.start();
await postgres.createDatabase("demo");

Object.assign(process.env, {
  DATABASE_URL: `postgresql://postgres:demo@localhost:${PUERTO_PG}/demo`,
  PORT: process.env.PORT ?? "4000",
  STRIPE_SECRET_KEY: "sk_test_simulado",
  STRIPE_PUBLISHABLE_KEY: "pk_test_simulado",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  WEB_URL: process.env.WEB_URL ?? "http://localhost:4321",
  SMTP_HOST: "",
});
mock.module("stripe", { exports: { default: StripeSimulado } });

async function apagar() {
  console.log("\nApagando la demo y borrando la base temporal...");
  const { pool } = await import("../src/db.js");
  await pool.end().catch(() => {});
  await postgres.stop().catch(() => {});
  await fs.rm(carpeta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);

await import("../src/index.js");
console.log("Demo lista: usuarios admin@tienda.com / admin123 e invitado@tienda.com / invitado123.");
