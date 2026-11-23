// Pruebas de las APIs de terceros:  npm run probar-apis
//
// Igual que probar-pagos: PostgreSQL temporal + el backend REAL, pero las
// APIs externas (PayPal, Mercado Libre, Banxico y COPOMEX) son el servidor
// de pruebas/apis-simuladas.mjs. Stripe se deja SIN configurar a propósito,
// para comprobar que PayPal funciona aunque Stripe no esté.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { iniciarApisSimuladas, apis, aprobarOrden, contar } from "./apis-simuladas.mjs";

const PUERTO = 4597;
const PUERTO_PG = 5546;

const carpeta = path.join(os.tmpdir(), `vinylink-apis-${Date.now()}`);
const postgres = new EmbeddedPostgres({
  databaseDir: carpeta,
  user: "postgres",
  password: "pruebas",
  port: PUERTO_PG,
  persistent: false,
  onLog: () => {},
  postgresFlags: ["-c", "io_method=sync"],
});
console.log("Levantando PostgreSQL temporal y APIs simuladas...");
await postgres.initialise();
await postgres.start();
await postgres.createDatabase("pruebas");
const simuladas = await iniciarApisSimuladas();

Object.assign(process.env, {
  DATABASE_URL: `postgresql://postgres:pruebas@localhost:${PUERTO_PG}/pruebas`,
  PORT: String(PUERTO),
  STRIPE_SECRET_KEY: "",
  STRIPE_PUBLISHABLE_KEY: "",
  WEB_URL: "http://localhost:4321",
  SMTP_HOST: "",
  AGENTE_URL: "http://localhost:8000",
  ...simuladas.env,
});

await import("../src/index.js");
const { revisarVencimientos } = await import("../src/modules/pagos/vencimientos.js");
const { _limpiarCacheBanxico } = await import("../src/modules/integraciones/banxico.js");
const { resumirPrecios } = await import("../src/modules/integraciones/mercadolibre.js");
const db = new pg.Client(process.env.DATABASE_URL);
await db.connect();

async function terminar(codigo) {
  const { pool } = await import("../src/db.js");
  await pool.end();
  await db.end();
  simuladas.servidor.close();
  await postgres.stop().catch(() => {});
  await fs.rm(carpeta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
  process.exit(codigo);
}

let fallas = 0;
const ok = (cond, nombre, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${nombre}${!cond && extra ? "  → " + extra : ""}`);
  if (!cond) fallas++;
};
async function gql(query, variables = {}, token) {
  const r = await fetch(`http://localhost:${PUERTO}/`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
const intenta = async (fn) => { try { return { data: await fn() }; } catch (e) { return { error: e.message }; } };
const login = async (e, p) => (await gql(`mutation($e:String!,$p:String!){ login(email:$e,password:$p){ token } }`, { e, p })).login.token;

const ENVIO = { nombre: "Cliente Prueba", telefono: "3312345678", calle: "Av. Juárez 100", colonia: "Centro", ciudad: "Guadalajara", estado: "Jalisco", cp: "44100" };
const CREAR = `mutation($data: PedidoInput!, $pago: DatosPagoInput!) { crearPedido(data: $data, pago: $pago) { urlAprobacion requiereAccion pedido { id estado total } } }`;
const PEDIDO = `query($id: ID!) { pedido(id: $id) { id estado total metodoPago pago { metodo estado error paypal { url ordenId correoPagador } paypalCaptureId } } }`;
const SYNC = `mutation($id: ID!) { sincronizarPago(pedidoId: $id) { id estado pago { estado error } } }`;
const stock = async (pid) => (await db.query("SELECT stock FROM producto WHERE id = $1", [pid])).rows[0].stock;
const carrito = async (uid) => Number((await db.query("SELECT COUNT(*) FROM detalle_carrito dc JOIN carrito c ON c.id = dc.carrito_id WHERE c.usuario_id = $1", [uid])).rows[0].count);
const items = (productoId, cantidad = 1) => ({ items: [{ productoId: String(productoId), cantidad }], envio: ENVIO });
const ordenDe = async (pid) => (await db.query("SELECT paypal_order_id FROM pago WHERE pedido_id = $1", [pid])).rows[0].paypal_order_id;

await db.query("UPDATE producto SET stock = 50 WHERE id IN (1, 2, 3, 4, 7)");
const cliente = await login("invitado@tienda.com", "invitado123");
const admin = await login("admin@tienda.com", "admin123");
await gql(`mutation { actualizarConfiguracion(data: { costoEnvio: 0 }) { costoEnvio } }`, {}, admin);
const idCliente = (await db.query("SELECT id FROM usuario WHERE email = 'invitado@tienda.com'")).rows[0].id;

// ================================================================= PayPal
console.log("\n== PayPal: configuración ==");
let r = await intenta(() => gql(`{ configPagos { habilitado paypalHabilitado } }`));
ok(r.data?.configPagos.paypalHabilitado === true && r.data.configPagos.habilitado === false, "PayPal habilitado aunque Stripe no esté configurado", JSON.stringify(r));
r = await intenta(() => gql(CREAR, { data: items(1), pago: { metodo: "credito", confirmationTokenId: "x" } }, cliente));
ok(r.error?.includes("STRIPE_SECRET_KEY"), "sin Stripe, los métodos de Stripe dan un error claro", r.error);

console.log("\n== PayPal: pago aprobado y capturado ==");
await gql(`mutation { agregarAlCarrito(productoId: "1", cantidad: 1) { id } }`, {}, cliente);
const stock1 = await stock(1);
r = await intenta(() => gql(CREAR, { data: items(1), pago: { metodo: "paypal" } }, cliente));
const p1 = r.data?.crearPedido.pedido.id;
ok(r.data?.crearPedido.urlAprobacion?.startsWith("https://www.sandbox.paypal.com/checkoutnow?token=ORD"), "crearPedido regresa el link de aprobación de PayPal", JSON.stringify(r));
ok(r.data?.crearPedido.pedido.estado === "pendiente" && (await stock(1)) === stock1 - 1, "pedido pendiente con el stock apartado");
ok((await carrito(idCliente)) === 1, "el carrito NO se vacía hasta que PayPal cobra");
const orden1 = apis.ordenes.get(await ordenDe(p1));
ok(orden1?.purchase_units[0].amount.currency_code === "MXN" && orden1.purchase_units[0].amount.value === Number(r.data.crearPedido.pedido.total).toFixed(2), "la orden de PayPal es por el total exacto en MXN", JSON.stringify(orden1?.purchase_units[0].amount));
ok(orden1?.experience.return_url === `http://localhost:4321/pedido/${p1}?paypal=aprobado` && orden1.experience.shipping_preference === "NO_SHIPPING", "return_url al pedido y sin pedir envío en PayPal");
r = await intenta(() => gql(SYNC, { id: p1 }, cliente));
ok(r.data?.sincronizarPago.estado === "pendiente" && contar("paypal", "/capture") === 0, "antes de aprobar: sigue pendiente y no se intenta capturar", JSON.stringify(r));

aprobarOrden(orden1.id);
const [s1, s2] = await Promise.all([intenta(() => gql(SYNC, { id: p1 }, cliente)), intenta(() => gql(SYNC, { id: p1 }, cliente))]);
ok([s1, s2].every((x) => x.data?.sincronizarPago.estado === "pagado"), "al regresar de PayPal: dos revisiones simultáneas → pagado", JSON.stringify([s1, s2]));
ok(contar("paypal", "/capture") <= 2 && orden1.purchase_units[0].payments.captures.length === 1, "la orden se captura una sola vez (PayPal-Request-Id)");
let ped = (await gql(PEDIDO, { id: p1 }, admin)).pedido;
ok(ped.pago.paypal.correoPagador === "comprador@personal.example.com" && ped.pago.paypalCaptureId?.startsWith("CAP"), "se guardan la cuenta que pagó y la captura", JSON.stringify(ped.pago));
ok((await carrito(idCliente)) === 0, "con el pago confirmado se vacía el carrito");
ped = (await gql(PEDIDO, { id: p1 }, cliente)).pedido;
ok(ped.pago.paypalCaptureId === null, "el cliente no ve el id de la captura");
ok((await db.query("SELECT COUNT(*) FROM correo WHERE asunto LIKE '%Recibimos tu pago%'")).rows[0].count === "1", "se manda el correo de pago recibido");

console.log("\n== PayPal: reembolsos ==");
r = await intenta(() => gql(`mutation($id: ID!) { reembolsarPedido(id: $id, monto: 100, motivo: "Pieza rayada") { estado montoReembolsado } }`, { id: p1 }, admin));
ok(r.data?.reembolsarPedido.estado === "pagado" && r.data.reembolsarPedido.montoReembolsado === 100, "reembolso parcial de $100 por PayPal", JSON.stringify(r));
const stockAntes = await stock(1);
r = await intenta(() => gql(`mutation($id: ID!) { reembolsarPedido(id: $id) { estado } }`, { id: p1 }, admin));
ok(r.data?.reembolsarPedido.estado === "reembolsado" && orden1.purchase_units[0].payments.captures[0].status === "REFUNDED", "reembolso del resto: pedido reembolsado y captura REFUNDED en PayPal", JSON.stringify(r));
ok((await stock(1)) === stockAntes + 1, "el stock regresa al reembolsar todo");
ok((await db.query("SELECT COUNT(*) FROM reembolso WHERE pedido_id = $1 AND paypal_reembolso_id LIKE 'REF%'", [p1])).rows[0].count === "2", "los dos reembolsos quedan con su id de PayPal");

console.log("\n== PayPal: rechazos, caídas y vencimientos ==");
const stock2 = await stock(2);
r = await intenta(() => gql(CREAR, { data: items(2), pago: { metodo: "paypal" } }, cliente));
const p2 = r.data?.crearPedido.pedido.id;
apis.rechazarCaptura.add(await ordenDe(p2));
aprobarOrden(await ordenDe(p2));
r = await intenta(() => gql(SYNC, { id: p2 }, cliente));
ok(r.data?.sincronizarPago.estado === "cancelado" && r.data.sincronizarPago.pago.error?.includes("rechazó el método de pago"), "captura rechazada → pedido cancelado con mensaje claro", JSON.stringify(r));
ok((await stock(2)) === stock2, "el stock del pago rechazado regresa");

apis.fallarCrearOrden = true;
const stock3 = await stock(3);
r = await intenta(() => gql(CREAR, { data: items(3), pago: { metodo: "paypal" } }, cliente));
ok(r.error?.includes("PayPal respondió con un error (500)"), "PayPal caído → error legible", r.error);
ok((await stock(3)) === stock3 && (await db.query("SELECT estado FROM pedido ORDER BY id DESC LIMIT 1")).rows[0].estado === "cancelado", "el pedido que no llegó a PayPal se cancela y devuelve stock");
apis.fallarCrearOrden = false;

r = await intenta(() => gql(CREAR, { data: items(4), pago: { metodo: "paypal" } }, cliente));
const p4 = r.data?.crearPedido.pedido.id;
await db.query("UPDATE pago SET creado_en = NOW() - INTERVAL '4 hours' WHERE pedido_id = $1", [p4]);
await revisarVencimientos();
ped = (await gql(PEDIDO, { id: p4 }, cliente)).pedido;
ok(ped.estado === "cancelado", "una orden de PayPal sin aprobar en 3 horas se cancela sola", ped.estado);

r = await intenta(() => gql(CREAR, { data: items(7), pago: { metodo: "paypal" } }, cliente));
const p7 = r.data?.crearPedido.pedido.id;
aprobarOrden(await ordenDe(p7));
await db.query("UPDATE pago SET actualizado_en = NOW() - INTERVAL '20 minutes' WHERE pedido_id = $1", [p7]);
await revisarVencimientos();
ped = (await gql(PEDIDO, { id: p7 }, cliente)).pedido;
ok(ped.estado === "pagado", "si el cliente aprobó y cerró la ventana, la revisión periódica captura el pago", ped.estado);

// ================================================================= Banxico
console.log("\n== Banxico: tipo de cambio ==");
r = await intenta(() => gql(`{ tipoCambio { valor fecha fuente } }`));
ok(r.data?.tipoCambio.valor === 18.3462 && r.data.tipoCambio.fecha === "2026-11-21", "tipo de cambio FIX y fecha en ISO", JSON.stringify(r));
await gql(`{ tipoCambio { valor } }`);
ok(contar("banxico") === 1, "la segunda consulta sale de la caché (1 sola llamada a Banxico)", String(contar("banxico")));
_limpiarCacheBanxico();
apis.banxicoCaido = true;
r = await intenta(() => gql(`{ tipoCambio { valor } }`));
ok(r.data?.tipoCambio === null, "sin dato previo y con Banxico caído → null (la tienda solo oculta el precio en USD)", JSON.stringify(r));
apis.banxicoCaido = false;
await gql(`{ tipoCambio { valor } }`);
apis.banxicoCaido = true;
// Se vacía solo la caché (no el último dato bueno), como si pasaran 6 horas.
_limpiarCacheBanxico({ conservarUltimo: true });
r = await intenta(() => gql(`{ tipoCambio { valor } }`));
ok(r.data?.tipoCambio.valor === 18.3462, "con Banxico caído se usa el último dato bueno", JSON.stringify(r));
apis.banxicoCaido = false;

// ================================================================= COPOMEX
console.log("\n== COPOMEX: códigos postales ==");
r = await intenta(() => gql(`{ codigoPostal(cp: "44100") { estado } }`));
ok(r.error?.includes("iniciar sesión"), "consultar un C.P. requiere sesión", r.error);
r = await intenta(() => gql(`{ codigoPostal(cp: "44100") { cp estado municipio ciudad colonias } }`, {}, cliente));
ok(r.data?.codigoPostal.estado === "Jalisco" && r.data.codigoPostal.municipio === "Guadalajara", "44100 → Jalisco, Guadalajara", JSON.stringify(r));
ok(JSON.stringify(r.data?.codigoPostal.colonias) === JSON.stringify(["Americana", "Guadalajara Centro"]), "colonias sin repetir y en orden alfabético", JSON.stringify(r.data?.codigoPostal.colonias));
r = await intenta(() => gql(`{ codigoPostal(cp: "99999") { estado } }`, {}, cliente));
ok(r.data?.codigoPostal === null, "un C.P. que no existe → null", JSON.stringify(r));
r = await intenta(() => gql(`{ codigoPostal(cp: "441") { estado } }`, {}, cliente));
ok(r.error?.includes("5 dígitos"), "un C.P. mal escrito se rechaza sin llamar a COPOMEX", r.error);
await gql(`{ codigoPostal(cp: "44100") { estado } }`, {}, cliente);
ok(contar("copomex") === 2, "las consultas repetidas salen de la caché", String(contar("copomex")));

// ================================================================= Mercado Libre
console.log("\n== Mercado Libre: comparador de precios ==");
const MELI = `query($id: ID!, $b: String) { adminPreciosMercadoLibre(productoId: $id, busqueda: $b) { busqueda total muestra descartados minimo maximo promedio mediana precioTienda diferenciaPorcentaje publicaciones { titulo precio url imagen condicion } } }`;
r = await intenta(() => gql(MELI, { id: "4" }, cliente));
ok(r.error?.includes("Solo un administrador"), "un cliente no puede usar el comparador", r.error);
r = await intenta(() => gql(MELI, { id: "4" }, admin));
const m = r.data?.adminPreciosMercadoLibre;
ok(m?.busqueda === "Guitarra acústica" && m.muestra === 6 && m.descartados === 2, "busca por el nombre del producto y descarta accesorio y lote", JSON.stringify(m && { b: m.busqueda, muestra: m.muestra, d: m.descartados }));
ok(m?.minimo === 2650 && m.maximo === 4890 && m.mediana === 3225, "mínimo, máximo y mediana sin atípicos", JSON.stringify(m));
ok(m?.precioTienda === 2499 && m.diferenciaPorcentaje === -22.5, "la tienda está 22.5 % abajo de la mediana", String(m?.diferenciaPorcentaje));
ok(m?.publicaciones.length === 6 && m.publicaciones.every((x) => x.imagen.startsWith("https://")) && m.publicaciones[2].condicion === "Usado", "6 publicaciones con miniatura https y condición", JSON.stringify(m?.publicaciones[2]));
r = await intenta(() => gql(MELI, { id: "4", b: "pandero azul" }, admin));
ok(r.data?.adminPreciosMercadoLibre.muestra === 0 && r.data.adminPreciosMercadoLibre.mediana === null, "búsqueda sin resultados → resumen vacío, sin error", JSON.stringify(r));
r = await intenta(() => gql(MELI, { id: "4", b: "ab" }, admin));
ok(r.error?.includes("al menos 3 letras"), "búsqueda demasiado corta se rechaza", r.error);
ok(contar("meli", "/oauth/token") === 1, "el token de la app se reutiliza", String(contar("meli", "/oauth/token")));
ok(resumirPrecios([100, 100, 100, 100, 100000])?.maximo === 100, "resumirPrecios quita un precio absurdo");

// ================================================================= Panel
console.log("\n== Panel: estado de las integraciones ==");
r = await intenta(() => gql(`{ adminIntegraciones { clave configurada } }`, {}, admin));
const estado = Object.fromEntries((r.data?.adminIntegraciones ?? []).map((i) => [i.clave, i.configurada]));
ok(estado.paypal && estado.mercadolibre && estado.banxico && estado.copomex && estado.ia && estado.stripe === false, "el panel muestra qué APIs están configuradas", JSON.stringify(estado));
r = await intenta(() => gql(`{ adminIntegraciones { clave } }`, {}, cliente));
ok(Boolean(r.error), "un cliente no ve las integraciones");

console.log(`\n${fallas === 0 ? "✅ TODO PASÓ" : `❌ ${fallas} FALLAS`} (${apis.llamadas.length} llamadas a APIs simuladas)`);
await terminar(fallas ? 1 : 0);
