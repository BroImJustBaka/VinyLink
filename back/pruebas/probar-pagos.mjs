// Pruebas automáticas de pagos y del panel admin:  npm run probar-pagos
//
// 1. Levanta un PostgreSQL temporal (embedded-postgres) en una carpeta
//    temporal: tu base de Neon no se toca.
// 2. Arranca el backend REAL (src/index.js) pero con Stripe simulado
//    (pruebas/stripe-simulado.mjs): no necesita cuenta ni internet.
// 3. Recorre los cinco métodos de pago, rechazos, 3D Secure, fichas
//    vencidas, reembolsos, webhooks, permisos y concurrencia, revisando la
//    base de datos después de cada paso. Al final apaga todo y borra la base.
//
// Se corre con la bandera --experimental-test-module-mocks (ya viene en el
// script de package.json), que permite cambiar el paquete "stripe" por el simulado.
import { mock } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { StripeSimulado, sim, id, cargo, ahora, WHSEC } from "./stripe-simulado.mjs";

const PUERTO = 4599; // backend de prueba
const PUERTO_PG = 5544; // PostgreSQL temporal

// ---------------------------------------------------------------- arranque
const carpeta = path.join(os.tmpdir(), `vinylink-pruebas-${Date.now()}`);
const postgres = new EmbeddedPostgres({
  databaseDir: carpeta,
  user: "postgres",
  password: "pruebas",
  port: PUERTO_PG,
  persistent: false, // al apagarlo borra la carpeta
  onLog: () => {},
});
console.log("Levantando PostgreSQL temporal...");
await postgres.initialise();
await postgres.start();
await postgres.createDatabase("pruebas");

// Variables que lee el backend (tienen prioridad sobre back/.env).
Object.assign(process.env, {
  DATABASE_URL: `postgresql://postgres:pruebas@localhost:${PUERTO_PG}/pruebas`,
  PORT: String(PUERTO),
  STRIPE_SECRET_KEY: "sk_test_simulado",
  STRIPE_PUBLISHABLE_KEY: "pk_test_simulado",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  WEB_URL: "http://localhost:4321",
});

// Desde aquí, quien haga `import Stripe from "stripe"` recibe el simulado.
mock.module("stripe", { exports: { default: StripeSimulado } });

await import("../src/index.js"); // el backend de verdad
const { revisarVencimientos } = await import("../src/modules/pagos/vencimientos.js");
const db = new pg.Client(process.env.DATABASE_URL);
await db.connect();

async function terminar(codigo) {
  const { pool } = await import("../src/db.js");
  await pool.end(); // conexiones del backend
  await db.end(); // conexión de las pruebas
  await postgres.stop();
  // En Windows embedded-postgres a veces no alcanza a borrarla: se borra aquí.
  await fs.rm(carpeta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
  process.exit(codigo);
}

// ---------------------------------------------------------------- utilidades
let fallas = 0;
const ok = (cond, nombre, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${nombre}${!cond && extra ? "  → " + extra : ""}`);
  if (!cond) fallas++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function gql(query, variables = {}, token) {
  const r = await fetch(`http://localhost:${PUERTO}/`, { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
const intenta = async (fn) => { try { return { data: await fn() }; } catch (e) { return { error: e.message }; } };
const login = async (e, p) => (await gql(`mutation($e:String!,$p:String!){ login(email:$e,password:$p){ token } }`, { e, p })).login.token;
async function webhook(tipo, objeto) {
  const cuerpo = JSON.stringify({ id: id("evt"), object: "event", type: tipo, data: { object: objeto } });
  const t = ahora();
  const firma = crypto.createHmac("sha256", WHSEC).update(`${t}.${cuerpo}`).digest("hex");
  return fetch(`http://localhost:${PUERTO}/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${firma}` }, body: cuerpo });
}

const CREAR = `mutation($data: PedidoInput!, $pago: DatosPagoInput!) { crearPedido(data: $data, pago: $pago) { requiereAccion clientSecret pedido { id estado total } } }`;
const PEDIDO = `query($id: ID!) { pedido(id: $id) { id estado total metodoPago pagadoEn nota
  pago { estado error meses monto tarjeta { marca ultimos4 fondos } oxxo { referencia urlFicha expiraEn }
         spei { clabe banco referencia montoRestante urlInstrucciones } link { url expiraEn } stripePaymentIntentId stripeCheckoutSessionId } } }`;
const SYNC = `mutation($id: ID!) { sincronizarPago(pedidoId: $id) { id estado pago { estado error } } }`;
const CANCELAR = `mutation($id: ID!) { cancelarPedido(id: $id) { id estado } }`;
const stock = async (pid) => (await db.query("SELECT stock FROM producto WHERE id = $1", [pid])).rows[0].stock;
const contar = async () => Number((await db.query("SELECT COUNT(*) FROM pedido")).rows[0].count);
const carrito = async (uid) => Number((await db.query("SELECT COUNT(*) FROM detalle_carrito dc JOIN carrito c ON c.id = dc.carrito_id WHERE c.usuario_id = $1", [uid])).rows[0].count);
const items = (productoId, cantidad = 1) => ({ items: [{ productoId: String(productoId), cantidad }] });
const ver = async (pid, tok) => (await gql(PEDIDO, { id: pid }, tok)).pedido;
const crear = (pago, data, tok) => intenta(() => gql(CREAR, { data, pago }, tok));

await db.query("UPDATE producto SET stock = 50 WHERE id IN (1, 2, 3, 7, 8)");
const cliente = await login("invitado@tienda.com", "invitado123");
const admin = await login("admin@tienda.com", "admin123");
const agregarAlCarrito = (pid) => gql(`mutation($p: ID!){ agregarAlCarrito(productoId: $p, cantidad: 1) { id } }`, { p: String(pid) }, cliente);

// ================================================================= PRUEBAS
console.log("\n== Configuración ==");
let r = await intenta(() => gql(`{ configPagos { habilitado publishableKey modoPrueba minimo maximoOxxo } }`));
ok(r.data?.configPagos.habilitado && r.data.configPagos.publishableKey === "pk_test_simulado" && r.data.configPagos.modoPrueba, "configPagos", JSON.stringify(r));

console.log("\n== Permisos y validaciones ==");
r = await crear({ metodo: "spei" }, items(7));
ok(r.error?.includes("Necesitas iniciar sesión"), "sin sesión se rechaza", r.error);
r = await crear({ metodo: "bitcoin" }, items(7), cliente);
ok(r.error?.includes("método de pago válido"), "método inválido", r.error);
r = await crear({ metodo: "spei" }, { items: [] }, cliente);
ok(r.error?.includes("al menos un producto"), "pedido vacío", r.error);
r = await crear({ metodo: "spei" }, items(7, 0), cliente);
ok(r.error?.includes("entero mayor a 0"), "cantidad 0", r.error);
r = await crear({ metodo: "spei" }, items(999), cliente);
ok(r.error?.includes("No existe el producto"), "producto inexistente", r.error);
r = await crear({ metodo: "spei" }, items(7, 9999), cliente);
ok(r.error?.includes("Stock insuficiente"), "sin stock", r.error);
r = await intenta(() => gql(`{ adminResumen { ingresos } }`, {}, cliente));
ok(r.error?.includes("Solo un administrador"), "panel admin rechaza clientes", r.error);
r = await crear({ metodo: "credito" }, items(7), cliente);
ok(r.error?.includes("Faltan los datos de la tarjeta"), "tarjeta sin token", r.error);
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_inventado" }, items(7), cliente);
ok(r.error?.includes("No pudimos leer los datos de la tarjeta"), "token inválido", r.error);
await db.query("UPDATE producto SET precio = 5 WHERE id = 1");
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_visa" }, items(1), cliente);
ok(r.error?.includes("mínimo"), "total < $10 se rechaza", r.error);
await db.query("UPDATE producto SET precio = 899.99 WHERE id = 1");

console.log("\n== Crédito ==");
await agregarAlCarrito(8);
let s0 = await stock(7);
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_visa" }, items(7, 2), cliente);
const pCredito = r.data?.crearPedido.pedido.id;
ok(r.data?.crearPedido.pedido.estado === "pagado" && !r.data.crearPedido.requiereAccion, "crédito aprobado → pagado", r.error);
ok((await stock(7)) === s0 - 2, "stock -2");
let p = await ver(pCredito, cliente);
ok(p.pago.tarjeta?.ultimos4 === "4242" && p.pago.tarjeta.fondos === "credit" && p.pagadoEn && p.metodoPago === "credito", "tarjeta, pagadoEn y método guardados", JSON.stringify(p));
ok(p.pago.stripePaymentIntentId === null, "el cliente no ve ids de Stripe");
ok((await carrito(1)) === 0, "carrito vaciado al pagar con tarjeta");
const llamadaCredito = sim.llamadas.filter((l) => l[0] === "paymentIntents.create").at(-1)[1];
ok(llamadaCredito.amount === Math.round(599 * 2 * 100) && llamadaCredito.payment_method_options?.card?.installments?.enabled === true && llamadaCredito.metadata.pedido_id === String(pCredito) && llamadaCredito.return_url.endsWith(`/pedido/${pCredito}`), "parámetros enviados a Stripe (monto, MSI, metadata, return_url)", JSON.stringify(llamadaCredito));
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_mx3" }, items(2), cliente);
p = r.data && (await ver(r.data.crearPedido.pedido.id, cliente));
ok(p?.estado === "pagado" && p.pago.meses === 3, "crédito a 3 meses sin intereses", r.error ?? JSON.stringify(p?.pago));
ok(sim.llamadas.filter((l) => l[0] === "paymentIntents.create").at(-1)[1].payment_method_options.card.installments.plan === undefined, "el plan viaja en el token, no se repite en la petición");

console.log("\n== Débito ==");
let n0 = await contar();
r = await crear({ metodo: "debito", confirmationTokenId: "ctok_visa" }, items(7), cliente);
ok(r.error?.includes("es de crédito") && (await contar()) === n0, "crédito en 'débito' se rechaza sin crear pedido", r.error);
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_debito" }, items(7), cliente);
ok(r.error?.includes("es de débito") && (await contar()) === n0, "débito en 'crédito' se rechaza sin crear pedido", r.error);
r = await crear({ metodo: "debito", confirmationTokenId: "ctok_mx3" }, items(7), cliente);
ok(Boolean(r.error) && (await contar()) === n0, "MSI en 'débito' se rechaza", r.error);
r = await crear({ metodo: "debito", confirmationTokenId: "ctok_debito" }, items(7), cliente);
p = r.data && (await ver(r.data.crearPedido.pedido.id, cliente));
ok(p?.estado === "pagado" && p.pago.tarjeta.fondos === "debit", "débito aprobado", r.error);
ok(!sim.llamadas.filter((l) => l[0] === "paymentIntents.create").at(-1)[1].payment_method_options, "débito no manda opciones de meses");
r = await crear({ metodo: "debito", confirmationTokenId: "ctok_prepago" }, items(7), cliente);
ok(r.data?.crearPedido.pedido.estado === "pagado", "prepago se acepta como débito", r.error);

console.log("\n== Rechazos ==");
await agregarAlCarrito(8);
s0 = await stock(8);
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_rechazada" }, items(8, 3), cliente);
ok(r.error === "El banco rechazó la tarjeta.", "rechazo genérico → mensaje", r.error);
let fila = (await db.query("SELECT pe.estado, pa.estado AS pago, pa.error, pa.stripe_payment_intent_id AS pi FROM pedido pe JOIN pago pa ON pa.pedido_id = pe.id ORDER BY pe.id DESC LIMIT 1")).rows[0];
ok(fila.estado === "cancelado" && fila.pago === "fallido" && fila.error === "El banco rechazó la tarjeta.", "pedido cancelado y pago fallido con motivo", JSON.stringify(fila));
ok((await stock(8)) === s0, "stock devuelto");
ok(sim.pis.get(fila.pi)?.status === "canceled", "el cobro rechazado se canceló en Stripe", sim.pis.get(fila.pi)?.status);
ok((await carrito(1)) > 0, "el carrito se conserva para reintentar");
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_sinfondos" }, items(8), cliente);
ok(r.error === "La tarjeta no tiene fondos suficientes.", "fondos insuficientes → mensaje", r.error);

console.log("\n== 3D Secure ==");
s0 = await stock(8);
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_3ds" }, items(8), cliente);
const p3ds = r.data?.crearPedido.pedido.id;
ok(r.data?.crearPedido.requiereAccion && r.data.crearPedido.clientSecret?.includes("_secret_"), "3DS → requiereAccion + clientSecret", r.error);
ok((await stock(8)) === s0 - 1, "stock apartado durante la verificación");
// El banco aprueba la verificación:
const pi3 = [...sim.pis.values()].find((x) => x.metadata.pedido_id === String(p3ds));
pi3.status = "succeeded"; pi3.next_action = null; cargo(pi3, "card", { card: { brand: "visa", last4: "3184", funding: "credit", installments: null } });
r = await intenta(() => gql(SYNC, { id: p3ds }, cliente));
ok(r.data?.sincronizarPago.estado === "pagado", "3DS aprobado → pagado tras sincronizar", r.error ?? r.data?.sincronizarPago.estado);
// Verificación fallida:
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_3ds" }, items(8), cliente);
const p3dsMal = r.data.crearPedido.pedido.id;
const pi3m = [...sim.pis.values()].find((x) => x.metadata.pedido_id === String(p3dsMal));
pi3m.status = "requires_payment_method"; pi3m.next_action = null; pi3m.last_payment_error = { type: "invalid_request_error", code: "payment_intent_authentication_failure", message: "auth failed" };
r = await intenta(() => gql(SYNC, { id: p3dsMal }, cliente));
p = await ver(p3dsMal, cliente);
ok(p.estado === "cancelado" && p.pago.error?.includes("3D Secure"), "3DS fallido → cancelado con motivo", JSON.stringify(p.pago));
// Abandonada (se queda en requires_action): la cancela el navegador o la revisión de vencimientos.
r = await crear({ metodo: "credito", confirmationTokenId: "ctok_3ds" }, items(8), cliente);
const p3dsAbandono = r.data.crearPedido.pedido.id;
s0 = await stock(8);
await db.query("UPDATE pago SET creado_en = NOW() - INTERVAL '31 minutes' WHERE pedido_id = $1", [p3dsAbandono]);
await revisarVencimientos();
p = await ver(p3dsAbandono, cliente);
ok(p.estado === "cancelado" && (await stock(8)) === s0 + 1, "tarjeta abandonada >30 min → cancelada por la revisión", p.estado);
ok(sim.pis.get(pi3m.id).status === "canceled", "el cobro fallido también se canceló en Stripe");

console.log("\n== OXXO ==");
await db.query("UPDATE producto SET stock = 5 WHERE id = 6");
r = await crear({ metodo: "oxxo", nombre: "Ana López", email: "a@test.com" }, items(6, 2), cliente);
ok(r.error?.includes("hasta $10,000"), "OXXO > $10,000 se rechaza", r.error);
ok((await stock(6)) === 5, "y no aparta stock");
r = await crear({ metodo: "oxxo", nombre: "Ana", email: "a@test.com" }, items(7), cliente);
ok(r.error?.includes("nombre y apellido"), "OXXO pide nombre y apellido", r.error);
r = await crear({ metodo: "oxxo", nombre: "Ana López", email: "no-es-email" }, items(7), cliente);
ok(r.error?.includes("email válido"), "OXXO pide email válido", r.error);
await agregarAlCarrito(8);
r = await crear({ metodo: "oxxo", nombre: "  Ana   López ", email: "Succeed_Immediately@Test.com" }, items(7), cliente);
const pOxxo = r.data?.crearPedido.pedido.id;
p = await ver(pOxxo, cliente);
ok(p.estado === "pendiente" && p.pago.estado === "requiere_accion" && p.pago.oxxo.referencia.length === 32 && p.pago.oxxo.urlFicha && p.pago.oxxo.expiraEn, "ficha OXXO generada", JSON.stringify(p.pago.oxxo));
ok((await carrito(1)) === 0, "carrito vaciado al generar la ficha");
const llamadaOxxo = sim.llamadas.filter((l) => l[0] === "paymentIntents.create").at(-1)[1];
ok(llamadaOxxo.payment_method_data.billing_details.name === "Ana López" && llamadaOxxo.payment_method_data.billing_details.email === "succeed_immediately@test.com" && llamadaOxxo.payment_method_options.oxxo.expires_after_days === 3, "nombre/email limpios y vencimiento a 3 días", JSON.stringify(llamadaOxxo.payment_method_data));
r = await intenta(() => gql(CANCELAR, { id: pOxxo }, cliente));
ok(r.error?.includes("ficha OXXO"), "una ficha OXXO no se cancela", r.error);
await esperar(1800);
// Esta vez llega por WEBHOOK (sin que nadie sondee):
const piOxxo = [...sim.pis.values()].find((x) => x.metadata.pedido_id === String(pOxxo));
let w = await webhook("payment_intent.succeeded", { id: piOxxo.id, object: "payment_intent", metadata: piOxxo.metadata });
ok(w.status === 200, "webhook firmado aceptado", String(w.status));
p = await ver(pOxxo, cliente);
ok(p.estado === "pagado" && p.pagadoEn, "ficha pagada → pedido pagado (vía webhook)", p.estado);
w = await webhook("payment_intent.succeeded", { id: piOxxo.id, object: "payment_intent", metadata: piOxxo.metadata });
ok(w.status === 200 && (await ver(pOxxo, cliente)).estado === "pagado", "webhook repetido no cambia nada");
s0 = await stock(3);
r = await crear({ metodo: "oxxo", nombre: "Ana López", email: "expire_immediately@test.com" }, items(3), cliente);
const pVencido = r.data.crearPedido.pedido.id;
r = await crear({ metodo: "oxxo", nombre: "Ana López", email: "expira_sin_error@test.com" }, items(3), cliente);
const pVencido2 = r.data.crearPedido.pedido.id;
await esperar(1800);
await gql(SYNC, { id: pVencido }, cliente);
await revisarVencimientos(); // no la vence: OXXO lo decide Stripe
p = await ver(pVencido, cliente);
ok(p.estado === "cancelado" && p.pago.error === "La ficha OXXO venció sin pagarse.", "ficha vencida → cancelado (sondeo)", JSON.stringify(p.pago));
await db.query("UPDATE pago SET actualizado_en = NOW() - INTERVAL '11 minutes' WHERE pedido_id = $1", [pVencido2]);
await revisarVencimientos();
p = await ver(pVencido2, cliente);
ok(p.estado === "cancelado" && p.pago.error === "La ficha OXXO venció sin pagarse.", "ficha vencida sin last_payment_error → cancelado (revisión periódica)", JSON.stringify(p.pago));
ok((await stock(3)) === s0, "stock de las fichas vencidas devuelto", `${s0} vs ${await stock(3)}`);

console.log("\n== Pago tardío (ficha pagada después de cancelarse) ==");
const piVencido = [...sim.pis.values()].find((x) => x.metadata.pedido_id === String(pVencido));
piVencido.status = "succeeded"; piVencido.last_payment_error = null; cargo(piVencido, "oxxo", { oxxo: {} });
s0 = await stock(3);
await webhook("payment_intent.succeeded", { id: piVencido.id, object: "payment_intent", metadata: piVencido.metadata });
p = await ver(pVencido, admin);
ok(p.estado === "pagado" && p.nota?.includes("se volvió a apartar") && (await stock(3)) === s0 - 1, "se respeta el pago y se vuelve a apartar el stock", JSON.stringify({ e: p.estado, n: p.nota }));

console.log("\n== SPEI ==");
r = await crear({ metodo: "spei" }, items(2), cliente);
const pSpei = r.data?.crearPedido.pedido.id;
p = await ver(pSpei, cliente);
ok(p.pago.spei?.clabe === "002180650612345670" && p.pago.spei.banco === "BANAMEX" && p.pago.spei.montoRestante === p.total && p.pago.spei.referencia, "CLABE, banco, monto y referencia", JSON.stringify(p.pago.spei));
const cusId = (await db.query("SELECT stripe_customer_id FROM usuario WHERE id = 1")).rows[0].stripe_customer_id;
ok(cusId?.startsWith("cus_"), "Customer de Stripe guardado en el usuario");
r = await crear({ metodo: "spei" }, items(2), cliente);
const pSpei2 = r.data.crearPedido.pedido.id;
ok((await db.query("SELECT stripe_customer_id FROM usuario WHERE id = 1")).rows[0].stripe_customer_id === cusId && sim.customers.size === 1, "se reutiliza el mismo Customer");
sim.customers.clear(); // como si hubieras cambiado de cuenta de Stripe
r = await crear({ metodo: "spei" }, items(2), cliente);
ok(r.data?.crearPedido.pedido.estado === "pendiente" && sim.customers.size === 1, "Customer inexistente → se crea uno nuevo", r.error);
r = await intenta(() => gql(`mutation($id: ID!){ simularTransferenciaSpei(pedidoId: $id) { estado } }`, { id: pSpei2 }, cliente));
ok(Boolean(r.error) || r.data?.simularTransferenciaSpei.estado !== "pagado", "(el pedido con el Customer borrado no se puede pagar)");
const otroSpei = (await crear({ metodo: "spei" }, items(2), cliente)).data.crearPedido.pedido.id;
r = await intenta(() => gql(`mutation($id: ID!){ simularTransferenciaSpei(pedidoId: $id) { estado } }`, { id: otroSpei }, cliente));
ok(r.data?.simularTransferenciaSpei.estado === "pagado", "simular transferencia → pagado", r.error ?? r.data?.simularTransferenciaSpei.estado);
await db.query("UPDATE pago SET creado_en = NOW() - INTERVAL '4 days' WHERE pedido_id = $1", [pSpei]);
s0 = await stock(2);
await revisarVencimientos();
ok((await ver(pSpei, cliente)).estado === "cancelado" && (await stock(2)) === s0 + 1, "SPEI sin pagar >3 días → cancelado y stock devuelto");

console.log("\n== Link de pago ==");
await agregarAlCarrito(8);
r = await crear({ metodo: "link" }, { items: [{ productoId: "7", cantidad: 1 }, { productoId: "8", cantidad: 2 }, { productoId: "7", cantidad: 1 }] }, cliente);
const pLink = r.data?.crearPedido.pedido.id;
p = await ver(pLink, admin);
ok(p.pago.link?.url?.startsWith("https://checkout.stripe.com/") && p.pago.link.expiraEn, "link generado", JSON.stringify(p.pago.link));
ok((await carrito(1)) === 0, "carrito vaciado al generar el link");
const llamadaLink = sim.llamadas.filter((l) => l[0] === "checkout.sessions.create").at(-1)[1];
ok(llamadaLink.line_items.length === 2 && llamadaLink.line_items.find((li) => li.price_data.product_data.name.includes("Abbey")).quantity === 2, "renglones repetidos se agrupan", JSON.stringify(llamadaLink.line_items.map((l) => l.quantity)));
ok(sim.sesiones.get(p.pago.stripeCheckoutSessionId).amount_total === Math.round(p.total * 100), "total del link = total del pedido");
ok(JSON.stringify(llamadaLink.payment_method_types) === '["card","oxxo"]' && llamadaLink.locale === "es-419" && llamadaLink.success_url.includes(`/pago/gracias?pedido=${pLink}`), "métodos, idioma y regreso", JSON.stringify(llamadaLink.payment_method_types));
const sesionLink = p.pago.stripeCheckoutSessionId;
// Primer intento rechazado dentro de Stripe Checkout: el pedido sigue pendiente.
const piFallido = { id: id("pi"), object: "payment_intent", status: "requires_payment_method", last_payment_error: { type: "card_error", code: "card_declined" }, metadata: { pedido_id: String(pLink) }, payment_method_types: ["card", "oxxo"], next_action: null, latest_charge: null };
sim.pis.set(piFallido.id, piFallido);
sim.sesiones.get(sesionLink).payment_intent = piFallido.id;
await webhook("payment_intent.payment_failed", { id: piFallido.id, object: "payment_intent", metadata: piFallido.metadata });
ok((await ver(pLink, cliente)).estado === "pendiente", "un rechazo dentro del link no cancela el pedido");
sim.pagarLink(sesionLink, "card");
w = await webhook("checkout.session.completed", { id: sesionLink, object: "checkout.session", metadata: { pedido_id: String(pLink) } });
p = await ver(pLink, admin);
ok(p.estado === "pagado" && p.pago.tarjeta?.ultimos4 === "4242" && p.pago.link?.url, "link pagado con tarjeta → pagado (conserva la URL)", JSON.stringify(p.pago));
// Link pagado en OXXO desde la página de Stripe:
r = await crear({ metodo: "link" }, items(7), cliente);
const pLinkOxxo = r.data.crearPedido.pedido.id;
const sLinkOxxo = (await ver(pLinkOxxo, admin)).pago.stripeCheckoutSessionId;
const piLO = sim.pagarLink(sLinkOxxo, "oxxo");
await webhook("checkout.session.completed", { id: sLinkOxxo, object: "checkout.session", metadata: {} });
p = await ver(pLinkOxxo, cliente);
ok(p.estado === "pendiente" && p.pago.estado === "requiere_accion" && p.pago.oxxo?.referencia, "link pagado con ficha OXXO → esperando la ficha", JSON.stringify(p.pago));
piLO.status = "succeeded"; piLO.next_action = null; cargo(piLO, "oxxo", { oxxo: {} });
await webhook("checkout.session.async_payment_succeeded", { id: sLinkOxxo, object: "checkout.session", metadata: {} });
ok((await ver(pLinkOxxo, cliente)).estado === "pagado", "ficha del link pagada → pagado");
// Link vencido:
r = await crear({ metodo: "link" }, items(7), cliente);
const pLinkVence = r.data.crearPedido.pedido.id;
s0 = await stock(7);
const sVence = (await ver(pLinkVence, admin)).pago.stripeCheckoutSessionId;
sim.sesiones.get(sVence).status = "expired"; sim.sesiones.get(sVence).url = null;
await webhook("checkout.session.expired", { id: sVence, object: "checkout.session", metadata: {} });
p = await ver(pLinkVence, cliente);
ok(p.estado === "cancelado" && p.pago.error?.includes("venció") && (await stock(7)) === s0 + 1, "link vencido → cancelado y stock devuelto", JSON.stringify(p.pago));
// Cancelado por el cliente:
r = await crear({ metodo: "link" }, items(7), cliente);
const pLinkCancel = r.data.crearPedido.pedido.id;
r = await intenta(() => gql(CANCELAR, { id: pLinkCancel }, cliente));
const sCancel = (await ver(pLinkCancel, admin)).pago.stripeCheckoutSessionId;
ok(r.data?.cancelarPedido.estado === "cancelado" && sim.sesiones.get(sCancel).status === "expired", "cancelar link vence la sesión en Stripe", r.error);
// El admin crea un link para un cliente:
r = await intenta(() => gql(`mutation($u: ID!, $i: [DetallePedidoInput!]!) { crearLinkDePagoAdmin(usuarioId: $u, items: $i) { pedido { id usuario { email } pago { link { url } } } } }`, { u: "1", i: [{ productoId: "3", cantidad: 1 }] }, admin));
ok(r.data?.crearLinkDePagoAdmin.pedido.usuario.email === "invitado@tienda.com" && r.data.crearLinkDePagoAdmin.pedido.pago.link.url, "admin crea link a nombre del cliente", r.error);
r = await intenta(() => gql(`mutation($u: ID!, $i: [DetallePedidoInput!]!) { crearLinkDePagoAdmin(usuarioId: $u, items: $i) { pedido { id } } }`, { u: "999", i: [{ productoId: "3", cantidad: 1 }] }, admin));
ok(r.error?.includes("Elige un cliente"), "cliente inexistente", r.error);

console.log("\n== Admin: estados y reembolsos ==");
r = await intenta(() => gql(`mutation($id: ID!){ actualizarEstadoPedido(id: $id, estado: "entregado") { estado } }`, { id: pCredito }, admin));
ok(r.error?.includes("no puede pasar"), "no se salta de pagado a entregado", r.error);
r = await intenta(() => gql(`mutation($id: ID!){ actualizarEstadoPedido(id: $id, estado: "enviado") { estado } }`, { id: pCredito }, admin));
ok(r.data?.actualizarEstadoPedido.estado === "enviado", "pagado → enviado", r.error);
s0 = await stock(7);
r = await intenta(() => gql(`mutation($id: ID!){ reembolsarPedido(id: $id, reponerStock: true) { estado } }`, { id: pCredito }, admin));
ok(r.data?.reembolsarPedido.estado === "reembolsado" && (await stock(7)) === s0 + 2, "reembolso con tarjeta + stock repuesto", r.error);
r = await intenta(() => gql(`mutation($id: ID!){ reembolsarPedido(id: $id) { estado } }`, { id: pCredito }, admin));
ok(Boolean(r.error), "no se reembolsa dos veces", r.error);
const piCredito = (await db.query("SELECT stripe_payment_intent_id FROM pago WHERE pedido_id = $1", [pCredito])).rows[0].stripe_payment_intent_id;
await webhook("payment_intent.succeeded", { id: piCredito, object: "payment_intent", metadata: {} });
ok((await ver(pCredito, admin)).estado === "reembolsado", "un aviso viejo de 'pagado' no deshace el reembolso");
r = await intenta(() => gql(`mutation($id: ID!){ reembolsarPedido(id: $id) { estado } }`, { id: pOxxo }, admin));
ok(r.error?.includes("OXXO"), "OXXO no se reembolsa (mensaje claro)", r.error);
r = await intenta(() => gql(`mutation($id: ID!){ reembolsarPedido(id: $id) { estado } }`, { id: otroSpei }, admin));
ok(r.error?.includes("SPEI"), "SPEI no se reembolsa desde el panel (mensaje claro)", r.error);
const pLinkCard = pLink;
s0 = await stock(8);
r = await intenta(() => gql(`mutation($id: ID!){ reembolsarPedido(id: $id, reponerStock: false) { estado } }`, { id: pLinkCard }, admin));
ok(r.data?.reembolsarPedido.estado === "reembolsado" && (await stock(8)) === s0, "reembolso de link pagado con tarjeta, sin reponer stock", r.error);
// Reembolso hecho desde el Dashboard de Stripe (llega como charge.refunded):
const pDash = (await crear({ metodo: "credito", confirmationTokenId: "ctok_visa" }, items(7), cliente)).data.crearPedido.pedido.id;
const piDash = [...sim.pis.values()].find((x) => x.metadata.pedido_id === String(pDash));
piDash.latest_charge.refunded = true;
await webhook("charge.refunded", { id: piDash.latest_charge.id, object: "charge", payment_intent: piDash.id });
ok((await ver(pDash, admin)).estado === "reembolsado", "reembolso hecho en el Dashboard de Stripe se refleja");
r = await intenta(() => gql(`mutation($id: ID!){ cancelarPedido(id: $id) { estado } }`, { id: pCredito }, admin));
ok(r.error?.includes("esperando su pago"), "no se cancela un pedido que no está pendiente", r.error);

console.log("\n== Webhook: seguridad ==");
w = await fetch(`http://localhost:${PUERTO}/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=falsa" }, body: JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "pi_x", object: "payment_intent" } } }) });
ok(w.status === 400, "firma falsa → 400", String(w.status));
w = await fetch(`http://localhost:${PUERTO}/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
ok(w.status === 400, "sin firma → 400", String(w.status));
w = await webhook("customer.created", { id: "cus_x", object: "customer" });
ok(w.status === 200, "evento que no nos interesa → 200 e ignorado", String(w.status));
w = await webhook("payment_intent.succeeded", { id: "pi_ajeno", object: "payment_intent", metadata: { pedido_id: "99999" } });
ok(w.status === 200, "evento de un cobro ajeno → 200 sin tocar nada", String(w.status));

console.log("\n== Concurrencia: dos compras por la última pieza ==");
await db.query("UPDATE producto SET stock = 1 WHERE id = 4");
const [a, b] = await Promise.all([crear({ metodo: "spei" }, items(4), cliente), crear({ metodo: "spei" }, items(4), admin)]);
ok([a, b].filter((x) => x.data).length === 1 && [a, b].some((x) => x.error?.includes("Stock insuficiente")), "solo una se lleva la última pieza", `${a.error ?? "ok"} | ${b.error ?? "ok"}`);
ok((await stock(4)) === 0, "el stock no queda negativo");

console.log("\n== Panel: números ==");
r = await intenta(() => gql(`{ adminResumen(dias: 30) { ingresos pedidosPagados unidadesVendidas pedidosPendientes } adminTopProductos(dias: 30) { unidades producto { nombre } } adminVentasPorMetodo(dias: 30) { metodo pedidos } adminVentasPorDia(dias: 7) { fecha pedidos } }`, {}, admin));
const esperado = (await db.query("SELECT COALESCE(SUM(total),0)::float t, COUNT(*)::int n FROM pedido WHERE estado IN ('pagado','enviado','entregado')")).rows[0];
ok(Math.abs(r.data?.adminResumen.ingresos - Math.round(esperado.t * 100) / 100) < 0.001 && r.data.adminResumen.pedidosPagados === esperado.n, "ingresos y pedidos del resumen cuadran con la base", JSON.stringify({ r: r.data?.adminResumen, esperado }));
ok(r.data?.adminVentasPorDia.length === 7 && r.data.adminVentasPorDia.reduce((s, d) => s + d.pedidos, 0) === esperado.n, "ventas por día: 7 días y suman todos los pedidos de hoy", JSON.stringify(r.data?.adminVentasPorDia));
ok(r.data?.adminTopProductos.length > 0, "top de productos con datos");
r = await intenta(() => gql(`{ adminResumen(dias: 0) { ingresos } }`, {}, admin));
ok(r.error?.includes("1 a 365"), "periodo inválido se rechaza", r.error);
r = await intenta(() => gql(`mutation { cambiarRolUsuario(id: "2", rol: CLIENTE) { rol } }`, {}, admin));
ok(r.error?.includes("propio rol"), "el admin no se quita su propio rol", r.error);
r = await intenta(() => gql(`mutation { crearProducto(data: { nombre: "X", descripcion: "Y", precio: -1, stock: 1, imagen: "https://x.com/a.png", categoriaId: "1" }) { id } }`, {}, admin));
ok(r.error?.includes("mayor a 0"), "precio negativo se rechaza", r.error);
r = await intenta(() => gql(`mutation { crearProducto(data: { nombre: "X", descripcion: "Y", precio: 10, stock: 1, imagen: "ftp://x", categoriaId: "1" }) { id } }`, {}, admin));
ok(r.error?.includes("URL"), "imagen inválida se rechaza", r.error);
r = await intenta(() => gql(`mutation { eliminarProducto(id: "7") }`, {}, admin));
ok(r.error?.includes("aparece en pedidos"), "no se borra un producto con pedidos", r.error);

console.log(`\n${fallas === 0 ? "✅ TODO PASÓ" : `❌ ${fallas} FALLAS`} (${sim.llamadas.length} llamadas a Stripe simulado)`);
await terminar(fallas ? 1 : 0);
