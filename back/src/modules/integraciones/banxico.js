// Tipo de cambio peso-dólar oficial (FIX) del Banco de México, con la API
// del Sistema de Información Económica (SIE). Variable de back/.env:
//   BANXICO_TOKEN  token gratuito de https://www.banxico.org.mx/SieAPIRest/service/v1/token
// Sin token, la tienda simplemente no muestra precios en dólares.
//
// La serie SF43718 es el tipo de cambio FIX que publica Banxico cada día
// hábil; "oportuno" regresa solo el dato más reciente.
import "dotenv/config";
import { pedirJson, limpiarEnv, CacheConVencimiento } from "../../lib/http.js";

const token = limpiarEnv(process.env.BANXICO_TOKEN);
const API = (limpiarEnv(process.env.BANXICO_API_URL) ?? "https://www.banxico.org.mx/SieAPIRest/service/v1").replace(/\/+$/, "");
const SERIE = "SF43718";

export const banxicoHabilitado = Boolean(token);

// El FIX cambia una vez al día: se guarda 6 horas.
const cache = new CacheConVencimiento({ ms: 6 * 60 * 60 * 1000, maximo: 1 });
let ultimoBueno = null; // si Banxico falla, se sigue usando el último dato que sí llegó

// "21/11/2026" → "2026-11-21"
function fechaIso(ddmmaaaa) {
  const [d, m, a] = String(ddmmaaaa).split("/");
  return a && m && d ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : ddmmaaaa;
}

export async function obtenerTipoCambio() {
  if (!banxicoHabilitado) return null;
  const guardado = cache.obtener(SERIE);
  if (guardado) return guardado;

  try {
    const r = await pedirJson("Banxico", `${API}/series/${SERIE}/datos/oportuno`, {
      headers: { "Bmx-Token": token, Accept: "application/json" },
    });
    const dato = r?.bmx?.series?.[0]?.datos?.[0];
    const valor = Number(dato?.dato);
    // Banxico escribe "N/E" cuando no hay dato publicado.
    if (!Number.isFinite(valor) || valor <= 0) throw new Error("Banxico no regresó un tipo de cambio válido");
    ultimoBueno = { valor, fecha: fechaIso(dato.fecha), fuente: "Banco de México (FIX)" };
    return cache.guardar(SERIE, ultimoBueno);
  } catch (err) {
    console.warn("⚠ Banxico:", err.message);
    return ultimoBueno;
  }
}

// Solo para las pruebas automáticas.
export function _limpiarCacheBanxico({ conservarUltimo = false } = {}) {
  cache.limpiar();
  if (!conservarUltimo) ultimoBueno = null;
}
