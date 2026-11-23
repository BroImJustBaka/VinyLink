// Códigos postales de México con la API de COPOMEX (datos de SEPOMEX).
// Variable de back/.env:
//   COPOMEX_TOKEN  token de https://api.copomex.com (con "pruebas" responde datos ficticios)
// En el checkout, al escribir el C.P. se llenan el estado, el municipio y
// la lista de colonias.
import "dotenv/config";
import { pedirJson, limpiarEnv, CacheConVencimiento, ErrorDeServicio } from "../../lib/http.js";

const token = limpiarEnv(process.env.COPOMEX_TOKEN);
const API = (limpiarEnv(process.env.COPOMEX_API_URL) ?? "https://api.copomex.com/query").replace(/\/+$/, "");

export const copomexHabilitado = Boolean(token);

// Los códigos postales casi nunca cambian: se guardan un día.
const cache = new CacheConVencimiento({ ms: 24 * 60 * 60 * 1000, maximo: 2000 });

const unicos = (lista) => [...new Set(lista.filter(Boolean).map((t) => String(t).trim()))].sort((a, b) => a.localeCompare(b, "es"));

// COPOMEX responde de dos formas según el parámetro `type`:
//   simplified → { error, response: { cp, asentamiento: [...], municipio, estado, ciudad } }
//   normal     → [ { error, response: { cp, asentamiento: "...", municipio, estado, ciudad } }, ... ]
function normalizar(cp, cuerpo) {
  const respuestas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo])
    .filter((r) => r && !r.error && r.response)
    .map((r) => r.response);
  if (respuestas.length === 0) return null;
  const primera = respuestas[0];
  const colonias = unicos(respuestas.flatMap((r) => (Array.isArray(r.asentamiento) ? r.asentamiento : [r.asentamiento])));
  return {
    cp,
    estado: primera.estado ?? "",
    municipio: primera.municipio ?? "",
    ciudad: primera.ciudad || primera.municipio || null,
    colonias,
  };
}

export async function consultarCodigoPostal(cp) {
  cp = String(cp ?? "").trim();
  if (!/^\d{5}$/.test(cp)) throw new Error("El código postal debe tener 5 dígitos");
  if (!copomexHabilitado) return null;

  const guardado = cache.obtener(cp);
  if (guardado !== undefined) return guardado;

  const url = `${API}/info_cp/${cp}?type=simplified&token=${encodeURIComponent(token)}`;
  try {
    return cache.guardar(cp, normalizar(cp, await pedirJson("COPOMEX", url)));
  } catch (err) {
    // 400 con "code_error" = el código postal no existe: se guarda como "no encontrado".
    if (err instanceof ErrorDeServicio && err.status === 400) return cache.guardar(cp, null);
    console.warn("⚠ COPOMEX:", err.message);
    throw new Error("No pudimos consultar el código postal. Escribe la dirección a mano.");
  }
}

export function _limpiarCacheCopomex() {
  cache.limpiar();
}
