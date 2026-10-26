// Pruebas automáticas del back office:  npm run probar-backoffice
//
// Igual que probar-pagos.mjs: PostgreSQL temporal + backend real + Stripe
// simulado. Recorre roles y permisos, configuración, categorías, productos
// (activo, SKU, imágenes), kárdex y proveedores, cupones, envío y dirección,
// historial y notas, guías, reembolsos parciales, clientes bloqueados,
// restablecer contraseña, correos, bitácora, CSV y las subscriptions por
// WebSocket. Al final apaga todo y borra la base.
import { mock } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import WebSocket from "ws";
import { createClient } from "graphql-ws";
import EmbeddedPostgres from "embedded-postgres";
import { StripeSimulado, sim, WHSEC } from "./stripe-simulado.mjs";

const PUERTO = 4598;
const PUERTO_PG = 5545;

// ---------------------------------------------------------------- arranque
const carpeta = path.join(os.tmpdir(), `vinylink-backoffice-${Date.now()}`);
const postgres = new EmbeddedPostgres({
  databaseDir: carpeta,
  user: "postgres",
  password: "pruebas",
  port: PUERTO_PG,
  persistent: false,
  onLog: () => {},
  // PostgreSQL 18 en Windows deja vivo un proceso "io_worker" al apagarse,
  // que bloquea la carpeta temporal; con io_method=sync no se crean.
  postgresFlags: ["-c", "io_method=sync"],
});
console.log("Levantando PostgreSQL temporal...");
await postgres.initialise();
await postgres.start();
await postgres.createDatabase("pruebas");

Object.assign(process.env, {
  DATABASE_URL: `postgresql://postgres:pruebas@localhost:${PUERTO_PG}/pruebas`,
  PORT: String(PUERTO),
  STRIPE_SECRET_KEY: "sk_test_simulado",
  STRIPE_PUBLISHABLE_KEY: "pk_test_simulado",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  WEB_URL: "http://localhost:4321",
  SMTP_HOST: "",
});
mock.module("stripe", { exports: { default: StripeSimulado } });

await import("../src/index.js");
const db = new pg.Client(process.env.DATABASE_URL);
await db.connect();

const abiertos = [];
async function terminar(codigo) {
  for (const c of abiertos) await c.dispose().catch(() => {});
  const { pool } = await import("../src/db.js");
  await pool.end();
  await db.end();
  await postgres.stop().catch(() => {}); // si falla al borrar la carpeta, se borra abajo
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
const registrar = async (nombre, email) =>
  (await gql(`mutation($n:String!,$e:String!){ registrar(nombre:$n,email:$e,password:"secreta123"){ id token } }`, { n: nombre, e: email })).registrar;
const stock = async (pid) => (await db.query("SELECT stock FROM producto WHERE id = $1", [pid])).rows[0].stock;
const items = (productoId, cantidad = 1) => [{ productoId: String(productoId), cantidad }];
const DIR = { nombre: "Ana López", telefono: "33 1234 5678", calle: "Av. Juárez 123", colonia: "Centro", ciudad: "Guadalajara", estado: "Jalisco", cp: "44100", referencias: "Portón negro" };
const CREAR = `mutation($data: PedidoInput!, $pago: DatosPagoInput!) { crearPedido(data: $data, pago: $pago) { pedido { id estado total subtotal descuento costoEnvio cupon envio { cp telefono } } } }`;
const crear = (data, tok, pago = { metodo: "spei" }) => intenta(() => gql(CREAR, { data, pago }, tok));

// Suscripción por WebSocket (graphql-ws). Junta lo que llega en `recibidos`.
function suscribir(query, variables = {}, ticket = null) {
  const estado = { recibidos: [], error: null };
  const client = createClient({
    url: `ws://localhost:${PUERTO}/graphql`,
    webSocketImpl: WebSocket,
    connectionParams: ticket ? { ticket } : {},
    retryAttempts: 0,
    lazy: false,
    onNonLazyError: () => {},
  });
  abiertos.push(client);
  client.subscribe(
    { query, variables },
    {
      next: (r) => (r.errors ? (estado.error = r.errors[0].message) : estado.recibidos.push(r.data)),
      error: (e) => (estado.error = Array.isArray(e) ? e[0].message : e?.reason || `cerrado (${e?.code ?? e})`),
      complete: () => {},
    }
  );
  estado.cerrar = () => client.dispose();
  return estado;
}
const ticket = async (tok) => (await gql(`mutation { ticketTiempoReal }`, {}, tok)).ticketTiempoReal;

// ---------------------------------------------------------------- usuarios
// Stock de prueba: se cambia directo en la base, así que el kárdex arranca de nuevo con él.
await db.query("UPDATE producto SET stock = 50");
await db.query("DELETE FROM movimiento_inventario");
await db.query("INSERT INTO movimiento_inventario (producto_id, tipo, cantidad, stock_resultante, motivo) SELECT id, 'inicial', stock, stock, 'Pruebas' FROM producto");
const admin = await login("admin@tienda.com", "admin123");
const cliente = await login("invitado@tienda.com", "invitado123");
const almacenU = await registrar("Ana Almacén", "almacen@tienda.com");
const soporteU = await registrar("Sergio Soporte", "soporte@tienda.com");
const finanzasU = await registrar("Fer Finanzas", "finanzas@tienda.com");
const otroU = await registrar("=HYPERLINK(\"x\")", "otro@test.com");
const otro = otroU.token;

console.log("\n== Roles y permisos ==");
for (const [u, rol] of [[almacenU, "ALMACEN"], [soporteU, "SOPORTE"], [finanzasU, "FINANZAS"]]) {
  await gql(`mutation($id: ID!, $rol: Rol!) { cambiarRolUsuario(id: $id, rol: $rol) { rol } }`, { id: u.id, rol }, admin);
}
const almacen = almacenU.token, soporte = soporteU.token, finanzas = finanzasU.token;
let r = await intenta(() => gql(`{ me { rol permisos } }`, {}, almacen));
ok(r.data?.me.rol === "ALMACEN" && r.data.me.permisos.includes("inventario") && !r.data.me.permisos.includes("reportes"), "me.permisos según el rol", JSON.stringify(r));
r = await intenta(() => gql(`{ me { permisos } }`, {}, cliente));
ok(r.data?.me.permisos.length === 0, "un cliente no tiene permisos");
r = await intenta(() => gql(`{ adminResumen { ingresos } }`, {}, almacen));
ok(r.error?.includes("Tu rol (ALMACEN) no tiene permiso"), "almacén no ve el resumen de ventas", r.error);
r = await intenta(() => gql(`{ adminResumen { ingresos } }`, {}, cliente));
ok(r.error?.includes("Solo un administrador"), "cliente no ve el resumen", r.error);
r = await intenta(() => gql(`mutation($id: ID!) { cambiarRolUsuario(id: $id, rol: ADMIN) { rol } }`, { id: otroU.id }, soporte));
ok(r.error?.includes("no tiene permiso"), "soporte no cambia roles", r.error);
r = await intenta(() => gql(`{ permisosPorRol { rol permisos } }`, {}, finanzas));
ok(r.data?.permisosPorRol.find((x) => x.rol === "ADMIN").permisos.length >= 15, "catálogo de permisos por rol", r.error);

console.log("\n== Configuración ==");
r = await intenta(() => gql(`mutation { actualizarConfiguracion(data: { costoEnvio: 1 }) { costoEnvio } }`, {}, almacen));
ok(r.error?.includes("no tiene permiso"), "solo ADMIN cambia la configuración", r.error);
r = await intenta(() => gql(`mutation { actualizarConfiguracion(data: { ivaPorcentaje: 200 }) { ivaPorcentaje } }`, {}, admin));
ok(r.error?.includes("0 a 100"), "IVA inválido se rechaza", r.error);
r = await intenta(() => gql(`mutation { actualizarConfiguracion(data: { costoEnvio: 99, envioGratisDesde: 1000, paqueterias: ["DHL", " Estafeta ", "DHL"] }) { costoEnvio envioGratisDesde paqueterias } }`, {}, admin));
ok(r.data?.actualizarConfiguracion.costoEnvio === 99 && r.data.actualizarConfiguracion.paqueterias.join() === "DHL,Estafeta", "configuración guardada (y paqueterías sin repetir)", JSON.stringify(r));
r = await intenta(() => gql(`{ configuracionTienda { costoEnvio ivaPorcentaje } }`));
ok(r.data?.configuracionTienda.costoEnvio === 99, "la configuración se lee sin sesión");

console.log("\n== Categorías ==");
r = await intenta(() => gql(`mutation { crearCategoria(data: { nombre: "Accesorios", descripcion: "Cables y más", imagen: "https://x.com/a.png" }) { id nombre totalProductos } }`, {}, almacen));
const catId = r.data?.crearCategoria.id;
ok(catId && r.data.crearCategoria.totalProductos === 0, "almacén crea una categoría", r.error);
r = await intenta(() => gql(`mutation($id: ID!) { actualizarCategoria(id: $id, data: { nombre: "Accesorios y cables", descripcion: "Todo", imagen: "https://x.com/b.png" }) { nombre } }`, { id: catId }, almacen));
ok(r.data?.actualizarCategoria.nombre === "Accesorios y cables", "editar categoría", r.error);
r = await intenta(() => gql(`mutation { eliminarCategoria(id: "1") }`, {}, almacen));
ok(r.error?.includes("tiene productos"), "no se borra una categoría con productos", r.error);
r = await intenta(() => gql(`mutation { crearCategoria(data: { nombre: "X", descripcion: "Y", imagen: "https://x.com/a.png" }) { id } }`, {}, almacen));
ok(r.error?.includes("2 a 60"), "nombre de categoría muy corto", r.error);
r = await intenta(() => gql(`mutation { crearCategoria(data: { nombre: "Nada", descripcion: "Y", imagen: "https://x.com/a.png" }) { id } }`, {}, finanzas));
ok(r.error?.includes("no tiene permiso"), "finanzas no edita el catálogo", r.error);

console.log("\n== Productos: SKU, activo y kárdex inicial ==");
const NUEVO = `mutation($d: ProductoInput!) { crearProducto(data: $d) { id sku stock stockMinimo activo } }`;
const base = { nombre: "Cable plug", descripcion: "3 m", precio: 199, imagen: "https://x.com/c.png", categoriaId: catId };
r = await intenta(() => gql(NUEVO, { d: { ...base, stock: 10, sku: "acc-001", stockMinimo: 3 } }, almacen));
const pCable = r.data?.crearProducto.id;
ok(r.data?.crearProducto.sku === "ACC-001" && r.data.crearProducto.stock === 10, "producto con SKU (en mayúsculas) y stock inicial", r.error);
let mov = (await db.query("SELECT tipo, cantidad, stock_resultante, usuario_id FROM movimiento_inventario WHERE producto_id = $1", [pCable])).rows;
ok(mov.length === 1 && mov[0].tipo === "inicial" && mov[0].cantidad === 10 && String(mov[0].usuario_id) === almacenU.id, "kárdex: movimiento inicial con su autor", JSON.stringify(mov));
r = await intenta(() => gql(NUEVO, { d: { ...base, stock: 1, sku: "ACC-001" } }, almacen));
ok(r.error?.includes("SKU"), "SKU repetido se rechaza", r.error);
await gql(`mutation($id: ID!) { cambiarActivoProducto(id: $id, activo: false) { activo } }`, { id: pCable }, almacen);
r = await intenta(() => gql(`query($id: ID!) { producto(id: $id) { id } categoria(id: "${catId}") { productos { id } } buscarProductos(texto: "Cable") { id } }`, { id: pCable }, cliente));
ok(r.data?.producto === null && r.data.categoria.productos.length === 0 && r.data.buscarProductos.length === 0, "producto inactivo oculto en la tienda", JSON.stringify(r));
r = await intenta(() => gql(`query($id: ID!) { producto(id: $id) { activo } productos(incluirInactivos: true, limit: 100) { total } }`, { id: pCable }, almacen));
ok(r.data?.producto.activo === false && r.data.productos.total === 9, "el personal sí lo ve", JSON.stringify(r));
r = await intenta(() => gql(`mutation($p: ID!) { agregarAlCarrito(productoId: $p) { id } }`, { p: pCable }, cliente));
ok(r.error?.includes("ya no está a la venta"), "no se agrega al carrito", r.error);
r = await crear({ items: items(pCable) }, cliente);
ok(r.error?.includes("ya no está a la venta"), "no se puede comprar", r.error);
await gql(`mutation($id: ID!) { cambiarActivoProducto(id: $id, activo: true) { activo } }`, { id: pCable }, almacen);
r = await intenta(() => gql(`mutation($id: ID!, $d: ProductoInput!) { actualizarProducto(id: $id, data: $d) { stock precio } }`, { id: pCable, d: { ...base, precio: 249, stock: 12, sku: "ACC-001" } }, almacen));
ok(r.data?.actualizarProducto.stock === 12 && r.data.actualizarProducto.precio === 249, "editar precio y stock", r.error);
mov = (await db.query("SELECT tipo, cantidad FROM movimiento_inventario WHERE producto_id = $1 ORDER BY id DESC LIMIT 1", [pCable])).rows[0];
ok(mov.tipo === "ajuste" && mov.cantidad === 2, "cambiar el stock desde el formulario deja un ajuste", JSON.stringify(mov));

console.log("\n== Imágenes ==");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
r = await intenta(() => gql(`mutation($b: String!) { subirImagen(nombre: "punto.png", tipo: "image/png", base64: $b) { id url bytes } }`, { b: PNG }, almacen));
const img = r.data?.subirImagen;
ok(img?.url === `http://localhost:4321/imagenes/${img?.id}` && img.bytes > 60, "imagen subida", r.error);
let res = await fetch(`http://localhost:${PUERTO}/imagenes/${img?.id}`);
ok(res.status === 200 && res.headers.get("content-type") === "image/png" && (await res.arrayBuffer()).byteLength === img?.bytes, "GET /imagenes/:id la sirve con su tipo");
r = await intenta(() => gql(`mutation($b: String!) { subirImagen(nombre: "x.jpg", tipo: "image/jpeg", base64: $b) { id } }`, { b: PNG }, almacen));
ok(r.error?.includes("no es una imagen válida"), "se revisa la firma del archivo (PNG que dice ser JPG)", r.error);
r = await intenta(() => gql(`mutation { subirImagen(nombre: "x.svg", tipo: "image/svg+xml", base64: "PHN2Zz4=") { id } }`, {}, almacen));
ok(r.error?.includes("JPG, PNG"), "SVG no se acepta", r.error);
r = await intenta(() => gql(`mutation($b: String!) { subirImagen(nombre: "x.png", tipo: "image/png", base64: $b) { id } }`, { b: PNG }, cliente));
ok(r.error?.includes("Solo un administrador"), "un cliente no sube imágenes", r.error);
res = await fetch(`http://localhost:${PUERTO}/imagenes/9999`);
ok(res.status === 404, "imagen inexistente → 404");

console.log("\n== Inventario: proveedores, entradas y ajustes ==");
r = await intenta(() => gql(`mutation { crearProveedor(data: { nombre: "Distribuidora Sonora", email: "ventas@sonora.mx" }) { id } }`, {}, almacen));
const provId = r.data?.crearProveedor.id;
ok(provId, "proveedor creado", r.error);
r = await intenta(() => gql(`mutation { crearProveedor(data: { nombre: "distribuidora sonora" }) { id } }`, {}, almacen));
ok(r.error?.includes("Ya existe"), "proveedor repetido (sin importar mayúsculas)", r.error);
let s0 = await stock(pCable);
r = await intenta(() => gql(`mutation($p: ID!, $pr: ID) { registrarEntrada(productoId: $p, cantidad: 5, proveedorId: $pr, costoUnitario: 80) { tipo cantidad stockResultante proveedor { nombre } usuario { nombre } motivo } }`, { p: pCable, pr: provId }, almacen));
ok(r.data?.registrarEntrada.stockResultante === s0 + 5 && r.data.registrarEntrada.proveedor.nombre === "Distribuidora Sonora" && r.data.registrarEntrada.motivo.includes("Compra a"), "entrada de mercancía", r.error);
r = await intenta(() => gql(`query($id: ID!) { proveedor(id: $id) { entradas piezas } }`, { id: provId }, almacen));
ok(r.data?.proveedor.entradas === 1 && r.data.proveedor.piezas === 5, "el proveedor cuenta sus entradas", JSON.stringify(r));
r = await intenta(() => gql(`mutation($p: ID!) { ajustarStock(productoId: $p, stockNuevo: 4, motivo: "") { id } }`, { p: pCable }, almacen));
ok(r.error?.includes("motivo"), "ajuste sin motivo se rechaza", r.error);
r = await intenta(() => gql(`mutation($p: ID!) { ajustarStock(productoId: $p, stockNuevo: 4, motivo: "Conteo físico") { cantidad stockResultante } }`, { p: pCable }, almacen));
ok(r.data?.ajustarStock.stockResultante === 4 && r.data.ajustarStock.cantidad === 4 - (s0 + 5), "ajuste a un stock exacto", r.error);
r = await intenta(() => gql(`mutation($p: ID!) { ajustarStock(productoId: $p, stockNuevo: 4, motivo: "Otra vez") { id } }`, { p: pCable }, almacen));
ok(r.error?.includes("no hay nada que ajustar"), "ajuste sin cambio", r.error);
r = await intenta(() => gql(`mutation($p: ID!) { registrarEntrada(productoId: $p, cantidad: 0) { id } }`, { p: pCable }, almacen));
ok(r.error?.includes("mayor a 0"), "entrada de 0 piezas", r.error);
r = await crear({ items: items(pCable, 2) }, cliente);
const pVenta = r.data?.crearPedido.pedido.id;
await gql(`mutation($id: ID!) { cancelarPedido(id: $id) { estado } }`, { id: pVenta }, cliente);
mov = (await db.query("SELECT tipo, cantidad, pedido_id FROM movimiento_inventario WHERE producto_id = $1 ORDER BY id DESC LIMIT 2", [pCable])).rows;
ok(mov[1].tipo === "venta" && mov[1].cantidad === -2 && mov[0].tipo === "cancelacion" && mov[0].cantidad === 2 && String(mov[0].pedido_id) === pVenta, "kárdex: venta y cancelación ligadas al pedido", JSON.stringify(mov));
r = await intenta(() => gql(`query($p: ID!) { adminMovimientos(productoId: $p, limite: 50) { total items { tipo } } adminResumenInventario { productos piezas agotados } }`, { p: pCable }, almacen));
ok(r.data?.adminMovimientos.total === 6 && r.data.adminResumenInventario.productos === 9, "consulta del kárdex y resumen", JSON.stringify(r.data?.adminMovimientos.total));
const kardexOk = (await db.query(`SELECT COUNT(*)::int AS malos FROM producto p WHERE p.stock <> (SELECT stock_resultante FROM movimiento_inventario m WHERE m.producto_id = p.id ORDER BY m.id DESC LIMIT 1)`)).rows[0].malos;
ok(kardexOk === 0, "el último movimiento de cada producto coincide con su stock", String(kardexOk));

console.log("\n== Envío y cotización ==");
r = await intenta(() => gql(`query($d: PedidoInput!) { cotizarPedido(data: $d) { subtotal costoEnvio total iva faltaParaEnvioGratis } }`, { d: { items: items(7) } }));
ok(r.data?.cotizarPedido.subtotal === 599 && r.data.cotizarPedido.costoEnvio === 99 && r.data.cotizarPedido.total === 698 && r.data.cotizarPedido.faltaParaEnvioGratis === 401, "cotización con envío (sin sesión)", JSON.stringify(r));
ok(Math.abs(r.data?.cotizarPedido.iva - 96.28) < 0.01, "IVA incluido desglosado (16 %)", String(r.data?.cotizarPedido.iva));
r = await intenta(() => gql(`query($d: PedidoInput!) { cotizarPedido(data: $d) { costoEnvio total } }`, { d: { items: items(2) } }));
ok(r.data?.cotizarPedido.costoEnvio === 0 && r.data.cotizarPedido.total === 1499, "envío gratis desde $1,000", JSON.stringify(r));
r = await crear({ items: items(7), envio: { ...DIR, cp: "441" } }, cliente);
ok(r.error?.includes("código postal"), "dirección inválida se rechaza", r.error);
r = await crear({ items: items(7), envio: DIR, guardarDireccion: true }, cliente);
const pEnvio = r.data?.crearPedido.pedido;
ok(pEnvio?.total === 698 && pEnvio.costoEnvio === 99 && pEnvio.envio.cp === "44100" && pEnvio.envio.telefono === "3312345678", "pedido con envío y dirección limpia", r.error ?? JSON.stringify(pEnvio));
ok(sim.llamadas.filter((l) => l[0] === "paymentIntents.create").at(-1)[1].amount === 69800, "Stripe cobra el total con envío");
await crear({ items: items(7), envio: DIR, guardarDireccion: true }, cliente);
r = await intenta(() => gql(`{ misDirecciones { id cp } }`, {}, cliente));
ok(r.data?.misDirecciones.length === 1, "la dirección se guarda una sola vez en la libreta", JSON.stringify(r));
r = await intenta(() => gql(`mutation($id: ID!) { eliminarDireccion(id: $id) }`, { id: r.data.misDirecciones[0].id }, otro));
ok(r.data?.eliminarDireccion === false, "no se borra la dirección de otro");

console.log("\n== Cupones ==");
const CUPON = `mutation($d: CuponInput!) { crearCupon(data: $d) { id codigo usos } }`;
r = await intenta(() => gql(CUPON, { d: { codigo: "promo 50", tipo: "monto", valor: 50 } }, finanzas));
ok(r.error?.includes("sin espacios"), "código con espacios se rechaza", r.error);
r = await intenta(() => gql(CUPON, { d: { codigo: "MAL", tipo: "porcentaje", valor: 150 } }, finanzas));
ok(r.error?.includes("1 a 100"), "porcentaje > 100 se rechaza", r.error);
r = await intenta(() => gql(CUPON, { d: { codigo: "promo50", tipo: "monto", valor: 50, minimoCompra: 500, usosMaximos: 1 } }, finanzas));
const cuponId = r.data?.crearCupon.id;
ok(r.data?.crearCupon.codigo === "PROMO50", "finanzas crea un cupón (código en mayúsculas)", r.error);
r = await intenta(() => gql(CUPON, { d: { codigo: "PROMO50", tipo: "monto", valor: 10 } }, finanzas));
ok(r.error?.includes("Ya existe"), "código repetido", r.error);
r = await intenta(() => gql(`query($d: PedidoInput!) { cotizarPedido(data: $d) { subtotal descuento costoEnvio total cupon } }`, { d: { items: items(7), cupon: " promo50 " } }));
ok(r.data?.cotizarPedido.descuento === 50 && r.data.cotizarPedido.total === 648 && r.data.cotizarPedido.cupon === "PROMO50", "cotización con cupón de monto", JSON.stringify(r));
r = await intenta(() => gql(`query($d: PedidoInput!) { cotizarPedido(data: $d) { total errorCupon } }`, { d: { items: items(pCable), cupon: "PROMO50" } }));
ok(r.data?.cotizarPedido.errorCupon?.includes("desde $500.00"), "compra mínima del cupón", JSON.stringify(r));
r = await intenta(() => gql(`query($d: PedidoInput!) { cotizarPedido(data: $d) { total errorCupon } }`, { d: { items: items(7), cupon: "NOEXISTE" } }));
ok(r.data?.cotizarPedido.errorCupon?.includes("no existe") && r.data.cotizarPedido.total === 698, "cupón inválido: se explica y se cotiza sin él", JSON.stringify(r));
// Dos compras al mismo tiempo con un cupón de un solo uso: solo una lo obtiene.
const [c1, c2] = await Promise.all([crear({ items: items(7), cupon: "PROMO50" }, cliente), crear({ items: items(7), cupon: "PROMO50" }, otro)]);
ok([c1, c2].filter((x) => x.data).length === 1 && [c1, c2].some((x) => x.error?.includes("se agotó")), "cupón de un uso: solo una de dos compras simultáneas", `${c1.error ?? "ok"} | ${c2.error ?? "ok"}`);
const pCupon = (c1.data ?? c2.data).crearPedido.pedido;
ok(pCupon.total === 648 && pCupon.descuento === 50 && pCupon.cupon === "PROMO50", "el pedido guarda subtotal, descuento y cupón", JSON.stringify(pCupon));
await gql(`mutation($id: ID!) { cancelarPedido(id: $id) { estado } }`, { id: pCupon.id }, admin);
r = await crear({ items: items(7), cupon: "PROMO50" }, otro);
ok(r.data?.crearPedido.pedido.descuento === 50, "al cancelar el pedido el cupón se libera", r.error);
r = await crear({ items: items(7), cupon: "ENVIOGRATIS" }, cliente);
ok(r.data?.crearPedido.pedido.costoEnvio === 0 && r.data.crearPedido.pedido.total === 599, "cupón de envío gratis", r.error);
r = await crear({ items: items(7), cupon: "BIENVENIDA10" }, cliente, { metodo: "link" });
ok(r.data?.crearPedido.pedido.descuento === 59.9 && r.data.crearPedido.pedido.total === 638.1, "cupón de porcentaje (10 %) en un link de pago", r.error ?? JSON.stringify(r.data));
const llamadaLink = sim.llamadas.filter((l) => l[0] === "checkout.sessions.create").at(-1)[1];
ok(llamadaLink.line_items.length === 1 && llamadaLink.line_items[0].price_data.unit_amount === 63810, "con descuento el link cobra un solo renglón por el total", JSON.stringify(llamadaLink.line_items));
await gql(`mutation($id: ID!, $d: CuponInput!) { actualizarCupon(id: $id, data: $d) { activo } }`, { id: cuponId, d: { codigo: "PROMO50", tipo: "monto", valor: 50, activo: false } }, finanzas);
r = await crear({ items: items(7), cupon: "PROMO50" }, cliente);
ok(r.error?.includes("ya no está activo"), "cupón desactivado", r.error);
r = await intenta(() => gql(`{ adminCupones { codigo usos descuentoTotal } }`, {}, finanzas));
const promo = r.data?.adminCupones.find((c) => c.codigo === "PROMO50");
ok(promo?.usos === 1 && promo.descuentoTotal === 50, "usos y descuento total del cupón", JSON.stringify(promo));
r = await intenta(() => gql(`{ adminCupones { codigo } }`, {}, almacen));
ok(r.error?.includes("no tiene permiso"), "almacén no ve cupones", r.error);

console.log("\n== Historial, notas y envío con guía ==");
r = await crear({ items: items(7), envio: DIR }, cliente, { metodo: "credito", confirmationTokenId: "ctok_visa" });
const pTarjeta = r.data?.crearPedido.pedido.id;
ok(r.data?.crearPedido.pedido.estado === "pagado", "pedido pagado con tarjeta", r.error);
r = await intenta(() => gql(`mutation($id: ID!) { agregarNotaPedido(pedidoId: $id, texto: "Cliente pidió envolver para regalo") { id } }`, { id: pTarjeta }, soporte));
ok(r.data, "soporte agrega una nota interna", r.error);
r = await intenta(() => gql(`mutation($id: ID!) { agregarNotaPedido(pedidoId: $id, texto: "x") { id } }`, { id: pTarjeta }, almacen));
ok(r.error?.includes("no tiene permiso"), "almacén no escribe notas", r.error);
const HIST = `query($id: ID!) { pedido(id: $id) { historial { tipo estadoNuevo texto autor } } }`;
r = await intenta(() => gql(HIST, { id: pTarjeta }, cliente));
ok(r.data?.pedido.historial.map((h) => h.estadoNuevo).join() === "pendiente,pagado" && r.data.pedido.historial.every((h) => h.tipo === "estado" && h.autor === null), "el cliente ve sus cambios de estado (sin notas ni autores)", JSON.stringify(r.data?.pedido.historial));
r = await intenta(() => gql(HIST, { id: pTarjeta }, admin));
ok(r.data?.pedido.historial.some((h) => h.tipo === "nota" && h.autor === "Sergio Soporte"), "el personal ve las notas con su autor", JSON.stringify(r.data?.pedido.historial));
const ENVIAR = `mutation($id: ID!, $p: String, $g: String) { actualizarEstadoPedido(id: $id, estado: "enviado", paqueteria: $p, numeroGuia: $g) { estado paqueteria numeroGuia enviadoEn } }`;
r = await intenta(() => gql(ENVIAR, { id: pTarjeta, p: "DHL", g: "!!" }, almacen));
ok(r.error?.includes("guía"), "número de guía inválido", r.error);
r = await intenta(() => gql(ENVIAR, { id: pTarjeta, p: "DHL", g: "1234 5678 90" }, almacen));
ok(r.data?.actualizarEstadoPedido.numeroGuia === "1234567890" && r.data.actualizarEstadoPedido.enviadoEn, "almacén lo marca enviado con guía", r.error);
await esperar(300);
let correo = (await db.query("SELECT asunto, html, estado FROM correo WHERE pedido_id = $1 AND tipo = 'pedido.enviado'", [pTarjeta])).rows[0];
ok(correo?.html.includes("1234567890") && correo.estado === "simulado", "el cliente recibe la guía por correo", JSON.stringify(correo?.asunto));
r = await intenta(() => gql(`mutation($id: ID!) { actualizarEstadoPedido(id: $id, estado: "entregado") { estado entregadoEn } }`, { id: pTarjeta }, almacen));
ok(r.data?.actualizarEstadoPedido.entregadoEn, "entregado", r.error);
r = await intenta(() => gql(`mutation($id: ID!) { actualizarGuiaPedido(id: $id, paqueteria: "Estafeta", numeroGuia: "EST-999") { paqueteria numeroGuia } }`, { id: pTarjeta }, almacen));
ok(r.data?.actualizarGuiaPedido.numeroGuia === "EST-999", "corregir la guía", r.error);

console.log("\n== Reembolsos parciales ==");
const REEMB = `mutation($id: ID!, $m: Float, $mo: String) { reembolsarPedido(id: $id, monto: $m, motivo: $mo) { estado montoReembolsado reembolsos { monto parcial motivo autor } } }`;
r = await intenta(() => gql(REEMB, { id: pTarjeta, m: 100, mo: "Funda dañada" }, almacen));
ok(r.error?.includes("no tiene permiso"), "almacén no reembolsa", r.error);
r = await intenta(() => gql(REEMB, { id: pTarjeta, m: 100, mo: "Funda dañada" }, finanzas));
ok(r.data?.reembolsarPedido.estado === "entregado" && r.data.reembolsarPedido.montoReembolsado === 100 && r.data.reembolsarPedido.reembolsos[0].parcial && r.data.reembolsarPedido.reembolsos[0].autor === "Fer Finanzas", "reembolso parcial: el pedido conserva su estado", r.error ?? JSON.stringify(r.data));
ok(sim.llamadas.filter((l) => l[0] === "refunds.create").at(-1)[1].amount === 10000, "Stripe recibe el monto parcial en centavos");
r = await intenta(() => gql(REEMB, { id: pTarjeta, m: 9999 }, finanzas));
ok(r.error?.includes("Solo quedan $598.00"), "no se reembolsa más de lo que falta", r.error);
s0 = await stock(7);
r = await intenta(() => gql(REEMB, { id: pTarjeta }, finanzas));
ok(r.data?.reembolsarPedido.estado === "reembolsado" && r.data.reembolsarPedido.montoReembolsado === 698 && r.data.reembolsarPedido.reembolsos.length === 2, "el resto: reembolso total", r.error ?? JSON.stringify(r.data));
ok(sim.llamadas.filter((l) => l[0] === "refunds.create").at(-1)[1].amount === 59800 && (await stock(7)) === s0 + 1, "Stripe recibe lo que faltaba y el stock regresa", String(await stock(7) - s0));
await esperar(300);
correo = (await db.query("SELECT html FROM correo WHERE pedido_id = $1 AND tipo = 'pedido.reembolsado'", [pTarjeta])).rows[0];
ok(correo?.html.includes("$598.00"), "el correo dice el monto que faltaba", correo?.html.slice(0, 80));
r = await intenta(() => gql(`{ adminResumen(dias: 1) { reembolsos descuentos pedidosPorEnviar } }`, {}, finanzas));
ok(r.data?.adminResumen.reembolsos >= 698, "el resumen suma los reembolsos", JSON.stringify(r));

console.log("\n== Clientes: ficha, búsqueda y bloqueo ==");
r = await intenta(() => gql(`{ adminClientes(buscar: "invitado") { total items { usuario { email activo } pedidos } } }`, {}, soporte));
ok(r.data?.adminClientes.total === 1 && r.data.adminClientes.items[0].usuario.activo, "buscar clientes", JSON.stringify(r));
r = await intenta(() => gql(`{ adminClientes(rol: FINANZAS) { total } }`, {}, soporte));
ok(r.data?.adminClientes.total === 1, "filtrar por rol", JSON.stringify(r));
r = await intenta(() => gql(`{ adminCliente(id: "1") { pedidosPagados direcciones { cp } pedidos { id } } }`, {}, soporte));
ok(r.data?.adminCliente.pedidos.length > 5 && r.data.adminCliente.direcciones.length === 1, "ficha del cliente", JSON.stringify(r.data?.adminCliente.direcciones));
r = await intenta(() => gql(`mutation($id: ID!) { bloquearUsuario(id: $id, bloqueado: true) { activo } }`, { id: otroU.id }, soporte));
ok(r.data?.bloquearUsuario.activo === false, "soporte bloquea a un cliente", r.error);
r = await intenta(() => gql(`{ me { id } }`, {}, otro));
ok(r.data?.me === null, "sus sesiones se cerraron", JSON.stringify(r));
r = await intenta(() => login("otro@test.com", "secreta123"));
ok(r.error?.includes("bloqueada"), "no puede iniciar sesión", r.error);
r = await intenta(() => login("otro@test.com", "malapassword"));
ok(r.error?.includes("incorrectos"), "con contraseña equivocada no se revela el bloqueo", r.error);
r = await intenta(() => gql(`mutation { bloquearUsuario(id: "2", bloqueado: true) { activo } }`, {}, soporte));
ok(r.error?.includes("no tiene permiso"), "soporte no bloquea a un ADMIN", r.error);
r = await intenta(() => gql(`mutation($id: ID!) { bloquearUsuario(id: $id, bloqueado: true) { activo } }`, { id: soporteU.id }, soporte));
ok(r.error?.includes("propia cuenta"), "nadie se bloquea a sí mismo", r.error);
await gql(`mutation($id: ID!) { bloquearUsuario(id: $id, bloqueado: false) { activo } }`, { id: otroU.id }, soporte);
ok(Boolean(await login("otro@test.com", "secreta123")), "desbloqueado vuelve a entrar");

console.log("\n== Contraseñas ==");
const correosAntes = Number((await db.query("SELECT COUNT(*) FROM correo")).rows[0].count);
r = await intenta(() => gql(`mutation { solicitarRestablecimiento(email: "nadie@test.com") }`));
ok(r.data?.solicitarRestablecimiento === true && Number((await db.query("SELECT COUNT(*) FROM correo")).rows[0].count) === correosAntes, "email inexistente: responde igual y no manda nada");
const sesionVieja = await login("otro@test.com", "secreta123");
await gql(`mutation { solicitarRestablecimiento(email: "OTRO@test.com") }`);
await esperar(200);
correo = (await db.query("SELECT html FROM correo WHERE tipo = 'cuenta.restablecer' ORDER BY id DESC LIMIT 1")).rows[0];
const token = correo?.html.match(/restablecer\?token=([a-f0-9]{64})/)?.[1];
ok(Boolean(token), "llega el correo con el link", correo?.html.slice(0, 60));
r = await intenta(() => gql(`mutation($t: String!) { restablecerPassword(token: $t, password: "123") }`, { t: token }));
ok(r.error?.includes("6 caracteres"), "contraseña nueva muy corta", r.error);
r = await intenta(() => gql(`mutation($t: String!) { restablecerPassword(token: $t, password: "nueva123") }`, { t: token }));
ok(r.data?.restablecerPassword === true, "contraseña restablecida", r.error);
ok(Boolean(await login("otro@test.com", "nueva123")), "entra con la nueva");
r = await intenta(() => gql(`{ me { id } }`, {}, sesionVieja));
ok(r.data?.me === null, "las sesiones anteriores se cerraron");
r = await intenta(() => gql(`mutation($t: String!) { restablecerPassword(token: $t, password: "otra1234") }`, { t: token }));
ok(r.error?.includes("no es válido"), "el link no sirve dos veces", r.error);
const otro2 = await login("otro@test.com", "nueva123");
r = await intenta(() => gql(`mutation { cambiarMiPassword(actual: "mala", nueva: "otra1234") }`, {}, otro2));
ok(r.error?.includes("actual no es correcta"), "cambiar contraseña pide la actual", r.error);
r = await intenta(() => gql(`mutation { cambiarMiPassword(actual: "nueva123", nueva: "otra1234") }`, {}, otro2));
ok(r.data?.cambiarMiPassword && (await gql(`{ me { id } }`, {}, otro2)).me, "cambia la contraseña y conserva su sesión", r.error);
r = await intenta(() => gql(`mutation { actualizarMiPerfil(nombre: "Otro Cliente", telefono: "123") { nombre } }`, {}, otro2));
ok(r.error?.includes("10 dígitos"), "teléfono inválido en el perfil", r.error);
r = await intenta(() => gql(`mutation { actualizarMiPerfil(nombre: "Otro Cliente", telefono: "(33) 9876-5432") { nombre telefono } }`, {}, otro2));
ok(r.data?.actualizarMiPerfil.telefono === "3398765432", "perfil actualizado", r.error);
r = await intenta(() => gql(`mutation($id: ID!) { enviarRestablecimientoCliente(id: $id) }`, { id: otroU.id }, soporte));
ok(r.data?.enviarRestablecimientoCliente === true, "soporte le manda el link a un cliente", r.error);

console.log("\n== Correos, bitácora y CSV ==");
r = await intenta(() => gql(`{ adminCorreos(buscar: "otro@test.com") { total envioReal items { id estado tipo } } }`, {}, soporte));
ok(r.data?.adminCorreos.total >= 2 && r.data.adminCorreos.envioReal === false && r.data.adminCorreos.items.every((c) => c.estado === "simulado"), "bandeja de correos (simulados)", JSON.stringify(r.data?.adminCorreos.total));
r = await intenta(() => gql(`mutation($id: ID!) { reenviarCorreo(id: $id) { estado } }`, { id: r.data.adminCorreos.items[0].id }, soporte));
ok(r.data?.reenviarCorreo.estado === "simulado", "reenviar un correo", r.error);
r = await intenta(() => gql(`{ adminCorreos { total } }`, {}, finanzas));
ok(r.error?.includes("no tiene permiso"), "finanzas no ve correos", r.error);
r = await intenta(() => gql(`{ adminBitacora(entidad: "producto", limite: 100) { total items { accion usuarioNombre descripcion detalle } } }`, {}, admin));
const regs = r.data?.adminBitacora.items ?? [];
ok(regs.some((x) => x.accion === "producto.crear" && x.usuarioNombre === "Ana Almacén") && regs.some((x) => x.accion === "inventario.ajuste" && x.descripcion.startsWith("ajustó el stock de producto")), "bitácora: quién hizo qué", JSON.stringify(regs.slice(0, 3)));
const edicion = regs.find((x) => x.accion === "producto.actualizar");
ok(JSON.parse(edicion?.detalle ?? "{}").precio?.join() === "199,249", "la bitácora guarda el antes y el después", edicion?.detalle);
r = await intenta(() => gql(`{ adminBitacora(buscar: "PROMO50") { total } }`, {}, admin));
ok(r.data?.adminBitacora.total >= 2, "buscar en la bitácora", JSON.stringify(r));
r = await intenta(() => gql(`{ adminBitacora { total } }`, {}, soporte));
ok(r.error?.includes("no tiene permiso"), "solo ADMIN ve la bitácora", r.error);
r = await intenta(() => gql(`{ adminExportar(tipo: "pedidos") }`, {}, finanzas));
const csvPedidos = r.data?.adminExportar ?? "";
const lineasCsv = csvPedidos.split("\r\n").filter(Boolean);
const totalPedidos = Number((await db.query("SELECT COUNT(*) FROM pedido")).rows[0].count);
ok(csvPedidos.charCodeAt(0) === 0xfeff && lineasCsv[0].slice(1).startsWith("Pedido,Fecha,Estado") && lineasCsv.length === totalPedidos + 1, "CSV de pedidos con BOM para Excel (un renglón por pedido)", JSON.stringify([lineasCsv.length, totalPedidos]));
await registrar("=HYPERLINK(\"http://malo\")", "formula@test.com");
r = await intenta(() => gql(`{ adminExportar(tipo: "clientes") }`, {}, finanzas));
ok(r.data?.adminExportar.includes(`"'=HYPERLINK(""http://malo"")"`), "inyección CSV neutralizada (=… → '=…)", r.error ?? r.data?.adminExportar.split("\r\n").find((l) => l.includes("HYPERLINK")));
r = await intenta(() => gql(`{ adminExportar(tipo: "pedidos") }`, {}, almacen));
ok(r.error?.includes("no tiene permiso"), "almacén no exporta pedidos", r.error);
r = await intenta(() => gql(`{ adminExportar(tipo: "movimientos", desde: "2020-01-01") }`, {}, almacen));
ok(r.data?.adminExportar.includes("Cable plug"), "almacén exporta el kárdex", r.error);
r = await intenta(() => gql(`{ adminExportar(tipo: "pedidos", desde: "ayer") }`, {}, admin));
ok(r.error?.includes("AAAA-MM-DD"), "fecha inválida en el reporte", r.error);

console.log("\n== Subscriptions (WebSocket) ==");
// Pedido del cliente que el cliente sigue en vivo.
const pVivo = (await crear({ items: items(8) }, cliente, { metodo: "credito", confirmationTokenId: "ctok_visa" })).data.crearPedido.pedido.id;
const SUB_PEDIDO = `subscription($id: ID) { pedidoActualizado(id: $id) { id estado numeroGuia } }`;
const subCliente = suscribir(SUB_PEDIDO, { id: pVivo }, await ticket(cliente));
const subAjeno = suscribir(SUB_PEDIDO, { id: pVivo }, await ticket(otro2));
const subTodos = suscribir(SUB_PEDIDO, {}, await ticket(cliente));
const tReusado = await ticket(cliente);
const subPrimero = suscribir(`subscription { stockActualizado(productoId: "1") { id stock } }`, {}, tReusado);
await esperar(400);
const subReusado = suscribir(`subscription { stockActualizado(productoId: "1") { id stock } }`, {}, tReusado);
const subAdmin = suscribir(`subscription { eventosAdmin { tipo mensaje pedidoId productoId } }`, {}, await ticket(admin));
const subAlmacen = suscribir(`subscription { eventosAdmin { tipo mensaje productoId } }`, {}, await ticket(almacen));
const subSoporte = suscribir(`subscription { eventosAdmin { tipo } }`, {}, await ticket(soporte));
const subClienteAdmin = suscribir(`subscription { eventosAdmin { tipo } }`, {}, await ticket(cliente));
const subAnonimo = suscribir(`subscription($p: ID) { stockActualizado(productoId: $p) { id stock } }`, { p: pCable });
await esperar(600);
await gql(ENVIAR, { id: pVivo, p: "FedEx", g: "FX-1234" }, almacen);
await crear({ items: items(1) }, otro2);
await gql(`mutation($p: ID!) { registrarEntrada(productoId: $p, cantidad: 3) { id } }`, { p: pCable }, almacen);
const sAntes = await stock(pCable);
await gql(`mutation($p: ID!) { ajustarStock(productoId: $p, stockNuevo: 2, motivo: "Merma") { id } }`, { p: pCable }, almacen);
await esperar(800);
ok(subCliente.recibidos.some((d) => d.pedidoActualizado.estado === "enviado" && d.pedidoActualizado.numeroGuia === "FX-1234"), "el cliente recibe en vivo que su pedido se envió", JSON.stringify(subCliente));
ok(subAjeno.error?.includes("No existe el pedido"), "nadie más puede seguir ese pedido", subAjeno.error);
ok(subTodos.error?.includes("Indica el número"), "un cliente no puede seguir todos los pedidos", subTodos.error);
ok(subReusado.error && subReusado.recibidos.length === 0, "un ticket no sirve dos veces", subReusado.error);
ok(subClienteAdmin.error?.includes("Solo un administrador"), "un cliente no recibe avisos del panel", subClienteAdmin.error);
ok(subAdmin.recibidos.some((d) => d.eventosAdmin.tipo === "pedido_nuevo"), "el admin recibe el pedido nuevo", JSON.stringify(subAdmin.recibidos.map((d) => d.eventosAdmin.tipo)));
ok(subAdmin.recibidos.some((d) => d.eventosAdmin.tipo === "accion" && d.eventosAdmin.mensaje.startsWith("Ana Almacén:")), "el admin ve lo que hace el resto del personal", JSON.stringify(subAdmin.recibidos.map((d) => d.eventosAdmin.mensaje)));
ok(subAlmacen.recibidos.some((d) => d.eventosAdmin.tipo === "stock_bajo" && d.eventosAdmin.productoId === pCable) && sAntes > 3, "almacén recibe la alerta de stock bajo al cruzar el mínimo", JSON.stringify(subAlmacen.recibidos.map((d) => d.eventosAdmin.mensaje)));
ok(!subAlmacen.recibidos.some((d) => d.eventosAdmin.tipo === "accion") && !subSoporte.recibidos.some((d) => d.eventosAdmin.tipo === "stock_bajo"), "cada rol recibe solo los avisos que le tocan");
ok(subAnonimo.recibidos.length >= 2 && subAnonimo.recibidos.at(-1).stockActualizado.stock === 2, "stock en vivo sin sesión (público)", JSON.stringify(subAnonimo.recibidos));
ok(subPrimero.error === null, "el primer uso del ticket sí conectó", subPrimero.error);
r = await intenta(() => gql(`mutation { ticketTiempoReal }`));
ok(r.error?.includes("iniciar sesión"), "pedir ticket sin sesión", r.error);

console.log("\n== Reportes ==");
r = await intenta(() => gql(`{ adminVentasPorCategoria(dias: 30) { categoria { nombre } unidades ingresos } }`, {}, finanzas));
const discos = r.data?.adminVentasPorCategoria.find((v) => v.categoria.nombre === "Discos");
ok(discos?.unidades >= 1 && discos.ingresos >= 549, "ventas por categoría", r.error ?? JSON.stringify(r.data));

console.log("\n== Búsqueda normalizada ==");
const { normalizar } = await import("../src/lib/busqueda.js");
const BUSCAR = `query($t: String!, $c: ID) { buscar(texto: $t, categoriaId: $c) { total aproximada productos { id nombre } } }`;
const buscar = async (t, c = null, tok = cliente) => (await gql(BUSCAR, { t, c }, tok)).buscar;
const ids = (b) => b.productos.map((x) => x.id).sort().join(",");
const raro = "  ÁÉÍÓÚ Ñandú   Çà Über ";
r = await db.query("SELECT normalizar($1) AS n", [raro]);
ok(r.rows[0].n === "aeiou nandu ca uber" && normalizar(raro) === r.rows[0].n, "normalizar() de SQL y de JS dan lo mismo", JSON.stringify([r.rows[0].n, normalizar(raro)]));
let b = await buscar("audifonos");
ok(b.total === 3 && ids(b) === "1,2,3" && !b.aproximada, "\"audifonos\" sin acento encuentra los 3 (también por la categoría)", JSON.stringify(b));
ok(b.productos[2].id === "3", "primero los que lo dicen en el nombre", b.productos.map((x) => x.nombre).join(" | "));
ok(ids(await buscar("Audífonos")) === "1,2,3" && ids(await buscar("AUDÍFONOS")) === "1,2,3", "con acento y en mayúsculas: lo mismo");
ok(ids(await buscar("audif")) === "1,2,3", "palabra a medias");
ok(ids(await buscar("  BLUETOOTH   audíf ")) === "1", "varias palabras en cualquier orden (espacios de más)");
ok(ids(await buscar("acustica")) === "4" && ids(await buscar("GUITARRA acúst")) === "4", "acentos en el producto: \"acustica\" encuentra \"acústica\"");
b = await buscar("audifnos");
ok(b.aproximada && b.productos.length >= 3 && ["1", "2", "3"].every((x) => b.productos.some((p) => p.id === x)) && !b.productos.some((p) => p.id === "5"), "error de dedo \"audifnos\" → aproximada con los audífonos", JSON.stringify(b));
b = await buscar("thriler");
ok(b.aproximada && b.productos[0]?.id === "8", "\"thriler\" → Vinilo \"Thriller\" primero", JSON.stringify(b));
b = await buscar("xyzxyz");
ok(b.total === 0 && !b.aproximada, "algo que no existe: 0 resultados", JSON.stringify(b));
r = await intenta(() => buscar("100%_"));
ok(r.data?.total === 0, "comodines % y _ se buscan literalmente (no truenan)", r.error ?? JSON.stringify(r.data));
ok((await buscar("   ")).total === 0, "búsqueda vacía");
ok(ids(await buscar("vinilo", "3")) === "7,8" && (await buscar("vinilo", "1")).total === 0, "dentro de una categoría");
await gql(`mutation($id: ID!) { cambiarActivoProducto(id: $id, activo: false) { activo } }`, { id: pCable }, almacen);
b = await buscar("cable plug");
r = await intenta(() => gql(`query { productos(buscar: "CÁBLE plug", incluirInactivos: true, limit: 50) { total aproximada items { id } } }`, {}, almacen));
ok(b.total === 0 && r.data?.productos.items[0]?.id === pCable && !r.data.productos.aproximada, "inactivo: la tienda no lo encuentra, el panel sí", JSON.stringify([b, r]));
await gql(`mutation($id: ID!) { cambiarActivoProducto(id: $id, activo: true) { activo } }`, { id: pCable }, almacen);
r = await intenta(() => gql(`query { productos(buscar: "acc 001", incluirInactivos: true) { items { id } } }`, {}, almacen));
ok(r.data?.productos.items.map((x) => x.id).join() === pCable, "panel: por SKU en partes (\"acc 001\" → ACC-001)", JSON.stringify(r));
r = await intenta(() => gql(`query { buscarProductos(texto: "audífonos") { id } }`));
ok(r.data?.buscarProductos.length === 3, "buscarProductos (la versión anterior) también normaliza", r.error);
for (const t of ["almacen", "ALMACÉN", "ana alm"]) {
  r = await intenta(() => gql(`query($t: String) { adminClientes(buscar: $t) { items { usuario { nombre } } } }`, { t }, soporte));
  ok(r.data?.adminClientes.items.some((c) => c.usuario.nombre === "Ana Almacén"), `clientes: "${t}" encuentra a "Ana Almacén"`, r.error ?? JSON.stringify(r.data));
}
r = await intenta(() => gql(`{ adminBitacora(buscar: "almacen") { total } }`, {}, admin));
ok(r.data?.adminBitacora.total > 0, "bitácora sin acento", r.error);
r = await intenta(() => gql(`{ adminCorreos(buscar: "contrasena") { total items { asunto } } }`, {}, soporte));
ok(r.data?.adminCorreos.items.some((c) => c.asunto.includes("contraseña")), "correos: \"contrasena\" encuentra \"contraseña\"", r.error ?? JSON.stringify(r.data));
r = await intenta(() => gql(`query($t: String) { adminPedidos(buscar: $t) { items { id } } }`, { t: `#${pVivo}` }, admin));
ok(r.data?.adminPedidos.items.some((x) => x.id === pVivo), "pedidos: por número con #", r.error);
r = await intenta(() => gql(`{ adminPedidos(buscar: "INVITADO fx-12") { items { id numeroGuia } } }`, {}, admin));
ok(r.data?.adminPedidos.items.length === 1 && r.data.adminPedidos.items[0].id === pVivo, "pedidos: cliente + guía a medias", JSON.stringify(r));

console.log(`\n${fallas === 0 ? "✅ TODO PASÓ" : `❌ ${fallas} FALLAS`}`);
await terminar(fallas ? 1 : 0);
