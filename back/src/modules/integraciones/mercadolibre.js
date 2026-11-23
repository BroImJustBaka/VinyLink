// Comparador de precios con Mercado Libre México (API pública de búsqueda).
// Variables de back/.env:
//   MELI_CLIENT_ID      App ID de https://developers.mercadolibre.com.mx (Mis aplicaciones)
//   MELI_CLIENT_SECRET  Clave secreta de la misma app
// En el panel, cada producto muestra cuánto cuesta lo mismo en Mercado Libre
// (mínimo, mediana, promedio y máximo) para decidir si el precio es competitivo.
import "dotenv/config";
import { pedirJson, limpiarEnv, CacheConVencimiento, ErrorDeServicio } from "../../lib/http.js";

const clientId = limpiarEnv(process.env.MELI_CLIENT_ID);
const secreto = limpiarEnv(process.env.MELI_CLIENT_SECRET);
const API = (limpiarEnv(process.env.MELI_API_URL) ?? "https://api.mercadolibre.com").replace(/\/+$/, "");
const SITIO = "MLM"; // Mercado Libre México

export const mercadoLibreHabilitado = Boolean(clientId && secreto);

// ------------------------------------------------------------ token
// OAuth 2 "client credentials": token de aplicación (no de un usuario), que
// dura 6 horas. Se renueva un minuto antes de vencer.
let token = null;
let tokenVence = 0;

async function obtenerToken() {
  if (token && Date.now() < tokenVence) return token;
  const r = await pedirJson("Mercado Libre", `${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: secreto }),
  });
  token = r.access_token;
  tokenVence = Date.now() + (Number(r.expires_in) - 60) * 1000;
  return token;
}

// ------------------------------------------------------------ estadística
const redondear = (n) => Math.round(n * 100) / 100;

function mediana(ordenados) {
  const m = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[m] : (ordenados[m - 1] + ordenados[m]) / 2;
}

// Resumen de precios. Se quitan los valores atípicos (accesorios de $50 que
// aparecen al buscar "guitarra", o lotes de 10 piezas) con el rango
// intercuartil (IQR = Q3 − Q1): solo cuentan los precios entre Q1 − 3·IQR y
// Q3 + 3·IQR (los "muy atípicos" de Tukey). Con 1.5·IQR se perderían modelos
// legítimos de gama alta.
export function resumirPrecios(precios) {
  const ordenados = precios.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (ordenados.length === 0) return null;
  const q1 = ordenados[Math.floor((ordenados.length - 1) * 0.25)];
  const q3 = ordenados[Math.floor((ordenados.length - 1) * 0.75)];
  const iqr = q3 - q1;
  const utiles = ordenados.length >= 4 ? ordenados.filter((p) => p >= q1 - 3 * iqr && p <= q3 + 3 * iqr) : ordenados;
  return {
    muestra: utiles.length,
    descartados: ordenados.length - utiles.length,
    minimo: utiles[0],
    maximo: utiles[utiles.length - 1],
    promedio: redondear(utiles.reduce((a, p) => a + p, 0) / utiles.length),
    mediana: redondear(mediana(utiles)),
  };
}

// ------------------------------------------------------------ búsqueda
const cache = new CacheConVencimiento({ ms: 30 * 60 * 1000, maximo: 300 });

export async function buscarPrecios(busqueda) {
  const texto = String(busqueda ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (texto.length < 3) throw new Error("Escribe al menos 3 letras para buscar en Mercado Libre");
  if (!mercadoLibreHabilitado) {
    throw new Error("Mercado Libre no está configurado: faltan MELI_CLIENT_ID y MELI_CLIENT_SECRET en back/.env");
  }
  const clave = texto.toLowerCase();
  const guardado = cache.obtener(clave);
  if (guardado) return guardado;

  const url = `${API}/sites/${SITIO}/search?${new URLSearchParams({ q: texto, limit: "50" })}`;
  let r;
  try {
    r = await pedirJson("Mercado Libre", url, {
      headers: { Authorization: `Bearer ${await obtenerToken()}`, Accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof ErrorDeServicio && err.status === 401) token = null; // token revocado: se pide otro la próxima vez
    if (err instanceof ErrorDeServicio && (err.status === 401 || err.status === 403)) {
      throw new Error("Mercado Libre rechazó las credenciales de la app (revisa MELI_CLIENT_ID y MELI_CLIENT_SECRET).");
    }
    throw new Error(err.message);
  }

  const enPesos = (r.results ?? []).filter((x) => x.currency_id === "MXN" && Number(x.price) > 0);
  const resumen = resumirPrecios(enPesos.map((x) => Number(x.price)));
  const resultado = {
    busqueda: texto,
    total: Number(r.paging?.total ?? enPesos.length),
    ...(resumen ?? { muestra: 0, descartados: 0, minimo: null, maximo: null, promedio: null, mediana: null }),
    publicaciones: enPesos.slice(0, 6).map((x) => ({
      id: x.id,
      titulo: x.title,
      precio: Number(x.price),
      url: x.permalink,
      // Mercado Libre manda las miniaturas por http; se piden por https.
      imagen: x.thumbnail ? String(x.thumbnail).replace(/^http:/, "https:") : null,
      condicion: x.condition === "new" ? "Nuevo" : x.condition === "used" ? "Usado" : null,
    })),
    consultadoEn: new Date().toISOString(),
  };
  return cache.guardar(clave, resultado);
}

export function _reiniciarMercadoLibre() {
  cache.limpiar();
  token = null;
  tokenVence = 0;
}
