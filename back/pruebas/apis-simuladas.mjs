// Servidor HTTP que imita las APIs de terceros para las pruebas y la demo:
//   /paypal/...   PayPal REST (OAuth, Orders v2, capturas y reembolsos)
//   /meli/...     Mercado Libre (OAuth client_credentials y búsqueda)
//   /banxico/...  Banxico SIE (serie SF43718)
//   /copomex/...  COPOMEX (info_cp)
// Responde con la misma forma que las APIs reales y revisa credenciales,
// así el backend se prueba de verdad por HTTP sin cuentas ni internet.
import http from "node:http";
import { randomUUID } from "node:crypto";

export const CREDENCIALES = {
  paypal: { id: "paypal-id-prueba", secreto: "paypal-secreto-prueba" },
  meli: { id: "meli-id-prueba", secreto: "meli-secreto-prueba" },
  banxico: "banxico-token-prueba",
  copomex: "copomex-token-prueba",
};

// Estado que las pruebas pueden leer y modificar.
export const apis = {
  llamadas: [], // { servicio, metodo, ruta }
  ordenes: new Map(), // id → orden de PayPal
  respuestasIdempotentes: new Map(), // PayPal-Request-Id → respuesta
  rechazarCaptura: new Set(), // órdenes cuya captura PayPal rechaza
  fallarCrearOrden: false, // PayPal responde 500 al crear
  banxicoCaido: false,
  tipoCambio: "18.3462",
  puerto: 0,
  // Demo (servidor-demo.mjs): el enlace de aprobación abre una página local
  // que imita el checkout de PayPal, y Mercado Libre responde a cualquier búsqueda.
  demo: false,
};

export const contar = (servicio, ruta = "") =>
  apis.llamadas.filter((l) => l.servicio === servicio && l.ruta.includes(ruta)).length;

// ------------------------------------------------------------ PayPal
export function aprobarOrden(id, correo = "comprador@personal.example.com") {
  const o = apis.ordenes.get(id);
  o.status = "APPROVED";
  o.payer = { email_address: correo, payer_id: "PAYER123" };
}

function vistaOrden(o) {
  const copia = structuredClone(o);
  if (o.status !== "COMPLETED") {
    copia.links = [
      { rel: "self", href: `http://localhost:${apis.puerto}/paypal/v2/checkout/orders/${o.id}`, method: "GET" },
      {
        rel: "payer-action",
        href: apis.demo
          ? `http://localhost:${apis.puerto}/paypal/demo/checkoutnow?token=${o.id}`
          : `https://www.sandbox.paypal.com/checkoutnow?token=${o.id}`,
        method: "GET",
      },
    ];
  }
  return copia;
}

// Página de la demo que hace las veces del checkout de PayPal.
function checkoutDemo(req, res, ruta, url) {
  const o = apis.ordenes.get(url.searchParams.get("token") ?? "");
  const html = (status, cuerpo) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>PayPal (simulado)</title>` +
        `<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">${cuerpo}</body></html>`
    );
  };
  if (!o) return html(404, "<p>La orden no existe.</p>");
  if (ruta === "/demo/checkoutnow") {
    const monto = o.purchase_units[0].amount;
    return html(
      200,
      `<h1 style="color:#003087">PayPal <small style="font-size:14px;color:#666">(simulado para la demo)</small></h1>
      <p>Pagar <strong>$${monto.value} ${monto.currency_code}</strong> a VinyLink.</p>
      <form method="post" action="/paypal/demo/aprobar?token=${o.id}">
        <button style="background:#ffc439;border:0;border-radius:20px;padding:12px 24px;font-weight:700;width:100%">Pagar ahora</button>
      </form>
      <p><a href="${o.experience?.cancel_url ?? "/"}">Cancelar y volver a la tienda</a></p>`
    );
  }
  if (ruta === "/demo/aprobar" && req.method === "POST") {
    aprobarOrden(o.id);
    res.writeHead(303, { Location: o.experience?.return_url ?? "/" });
    return res.end();
  }
  html(404, "<p>Ruta no válida.</p>");
}

function paypal(req, res, ruta, cuerpo, responder, url) {
  if (apis.demo && ruta.startsWith("/demo/")) return checkoutDemo(req, res, ruta, url);
  if (ruta === "/v1/oauth2/token") {
    const esperado = Buffer.from(`${CREDENCIALES.paypal.id}:${CREDENCIALES.paypal.secreto}`).toString("base64");
    if (req.headers.authorization !== `Basic ${esperado}`) return responder(401, { error: "invalid_client" });
    return responder(200, { access_token: "A21-paypal-token", token_type: "Bearer", expires_in: 32400 });
  }
  if (req.headers.authorization !== "Bearer A21-paypal-token") return responder(401, { name: "AUTHENTICATION_FAILURE" });

  // Idempotencia: la misma PayPal-Request-Id regresa la misma respuesta.
  const idem = req.headers["paypal-request-id"];
  if (idem && apis.respuestasIdempotentes.has(idem)) {
    const [st, r] = apis.respuestasIdempotentes.get(idem);
    return responder(st, r);
  }
  const responderYGuardar = (st, r) => {
    if (idem) apis.respuestasIdempotentes.set(idem, [st, r]);
    responder(st, r);
  };

  if (req.method === "POST" && ruta === "/v2/checkout/orders") {
    if (apis.fallarCrearOrden) return responder(500, { name: "INTERNAL_SERVER_ERROR" });
    const id = `ORD${randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase()}`;
    const orden = { id, status: "PAYER_ACTION_REQUIRED", intent: cuerpo.intent, purchase_units: cuerpo.purchase_units, experience: cuerpo.payment_source?.paypal?.experience_context };
    apis.ordenes.set(id, orden);
    return responderYGuardar(200, vistaOrden(orden));
  }
  let m = ruta.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const o = apis.ordenes.get(m[1]);
    return o ? responder(200, vistaOrden(o)) : responder(404, { name: "RESOURCE_NOT_FOUND" });
  }
  m = ruta.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
  if (req.method === "POST" && m) {
    const o = apis.ordenes.get(m[1]);
    if (!o) return responder(404, { name: "RESOURCE_NOT_FOUND" });
    if (o.status === "COMPLETED") return responder(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] });
    if (o.status !== "APPROVED") return responder(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] });
    if (apis.rechazarCaptura.has(o.id)) return responderYGuardar(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] });
    o.status = "COMPLETED";
    o.purchase_units[0].payments = {
      captures: [{ id: `CAP${o.id.slice(3)}`, status: "COMPLETED", amount: o.purchase_units[0].amount, reembolsado: 0 }],
    };
    return responderYGuardar(201, vistaOrden(o));
  }
  m = ruta.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
  if (req.method === "POST" && m) {
    const o = [...apis.ordenes.values()].find((x) => x.purchase_units[0].payments?.captures[0].id === m[1]);
    if (!o) return responder(404, { name: "RESOURCE_NOT_FOUND" });
    const cap = o.purchase_units[0].payments.captures[0];
    const total = Math.round(Number(cap.amount.value) * 100);
    const monto = Math.round(Number(cuerpo.amount?.value ?? cap.amount.value) * 100);
    if (cuerpo.amount?.currency_code !== "MXN") return responder(422, { details: [{ issue: "CURRENCY_MISMATCH" }] });
    if (cap.reembolsado + monto > total) return responder(422, { details: [{ issue: "REFUND_AMOUNT_EXCEEDED" }] });
    cap.reembolsado += monto;
    cap.status = cap.reembolsado === total ? "REFUNDED" : "PARTIALLY_REFUNDED";
    return responderYGuardar(201, { id: `REF${randomUUID().slice(0, 8).toUpperCase()}`, status: "COMPLETED" });
  }
  responder(404, { name: "RESOURCE_NOT_FOUND" });
}

// ------------------------------------------------------------ Mercado Libre
const PUBLICACIONES = [
  ["Guitarra Acústica Yamaha F310 Natural", 2899],
  ["Guitarra Acústica Fender CD-60S", 3499],
  ["Guitarra Acústica Cort AD810", 2650],
  ["Guitarra Acústica Washburn Apprentice", 3150],
  ["Guitarra Acústica Ibanez V50NJP Paquete", 3300],
  ["Cuerdas para guitarra acústica (accesorio)", 89], // atípico: accesorio barato
  ["Lote 10 guitarras acústicas mayoreo", 25990], // atípico: lote
  ["Guitarra Acústica Takamine GD20", 4890],
];

function meli(req, res, ruta, cuerpo, responder, url) {
  if (ruta === "/oauth/token") {
    const p = new URLSearchParams(cuerpo);
    if (p.get("grant_type") !== "client_credentials" || p.get("client_id") !== CREDENCIALES.meli.id || p.get("client_secret") !== CREDENCIALES.meli.secreto) {
      return responder(401, { message: "invalid client_id or client_secret", error: "invalid_client", status: 401 });
    }
    return responder(200, { access_token: "APP_USR-meli-token", token_type: "Bearer", expires_in: 21600, scope: "" });
  }
  if (ruta === "/sites/MLM/search") {
    if (req.headers.authorization !== "Bearer APP_USR-meli-token") return responder(403, { message: "forbidden", status: 403 });
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const res2 = q.includes("guitarra") || (apis.demo && q)
      ? PUBLICACIONES.map(([title, price], i) => ({
          id: `MLM${1000 + i}`,
          title,
          price,
          currency_id: "MXN",
          permalink: `https://articulo.mercadolibre.com.mx/MLM-${1000 + i}`,
          thumbnail: `http://http2.mlstatic.com/D_${i}-I.jpg`,
          condition: i === 2 ? "used" : "new",
        }))
      : [];
    return responder(200, { site_id: "MLM", query: q, paging: { total: res2.length * 37, offset: 0, limit: 50 }, results: res2 });
  }
  responder(404, { message: "not_found" });
}

// ------------------------------------------------------------ Banxico
function banxico(req, res, ruta, cuerpo, responder) {
  if (ruta !== "/series/SF43718/datos/oportuno") return responder(404, { error: "Serie no encontrada" });
  if (req.headers["bmx-token"] !== CREDENCIALES.banxico) return responder(401, { error: { mensaje: "Token inválido" } });
  if (apis.banxicoCaido) return responder(503, { error: "Servicio no disponible" });
  return responder(200, {
    bmx: { series: [{ idSerie: "SF43718", titulo: "Tipo de cambio FIX", datos: [{ fecha: "21/11/2026", dato: apis.tipoCambio }] }] },
  });
}

// ------------------------------------------------------------ COPOMEX
function copomex(req, res, ruta, cuerpo, responder, url) {
  const m = ruta.match(/^\/info_cp\/(\d{5})$/);
  if (!m) return responder(404, { error: true, error_message: "Ruta no válida" });
  if (url.searchParams.get("token") !== CREDENCIALES.copomex) return responder(401, { error: true, code_error: 2, error_message: "Token inválido" });
  if (m[1] !== "44100") return responder(400, { error: true, code_error: 1, error_message: "No se encontraron resultados" });
  return responder(200, {
    error: false,
    code_error: 0,
    error_message: null,
    response: {
      cp: "44100",
      asentamiento: ["Guadalajara Centro", "Americana", "Guadalajara Centro"],
      tipo_asentamiento: ["Colonia", "Colonia"],
      municipio: "Guadalajara",
      estado: "Jalisco",
      ciudad: "Guadalajara",
      pais: "México",
    },
  });
}

// ------------------------------------------------------------ servidor
const SERVICIOS = { paypal, meli, banxico, copomex };

export async function iniciarApisSimuladas() {
  const servidor = http.createServer(async (req, res) => {
    let cuerpo = "";
    for await (const parte of req) cuerpo += parte;
    const url = new URL(req.url, "http://localhost");
    const [, servicio, ...resto] = url.pathname.split("/");
    const ruta = `/${resto.join("/")}`;
    apis.llamadas.push({ servicio, metodo: req.method, ruta });
    const responder = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    const manejar = SERVICIOS[servicio];
    if (!manejar) return responder(404, { error: "servicio desconocido" });
    let datos = cuerpo;
    if (req.headers["content-type"]?.includes("application/json") && cuerpo) datos = JSON.parse(cuerpo);
    manejar(req, res, ruta, datos, responder, url);
  });
  await new Promise((r) => servidor.listen(0, r));
  apis.puerto = servidor.address().port;
  const base = `http://localhost:${apis.puerto}`;
  return {
    servidor,
    env: {
      PAYPAL_CLIENT_ID: CREDENCIALES.paypal.id,
      PAYPAL_CLIENT_SECRET: CREDENCIALES.paypal.secreto,
      PAYPAL_API_URL: `${base}/paypal`,
      MELI_CLIENT_ID: CREDENCIALES.meli.id,
      MELI_CLIENT_SECRET: CREDENCIALES.meli.secreto,
      MELI_API_URL: `${base}/meli`,
      BANXICO_TOKEN: CREDENCIALES.banxico,
      BANXICO_API_URL: `${base}/banxico`,
      COPOMEX_TOKEN: CREDENCIALES.copomex,
      COPOMEX_API_URL: `${base}/copomex`,
    },
  };
}
