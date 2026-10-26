// Búsqueda normalizada, compartida por la tienda y el panel.
//
// Reglas (iguales en todas las búsquedas):
//   1. Sin acentos ni mayúsculas: "audifonos" = "Audífonos" = "AUDÍFONOS".
//      En la base lo hace la función SQL normalizar() (db.sql); aquí,
//      normalizar() de JS hace lo mismo con lo que escribe el usuario.
//   2. Palabras a medias: "audif" encuentra "Audífonos" (LIKE '%audif%').
//   3. Varias palabras en cualquier orden: "bluetooth audif" encuentra
//      "Audífonos Bluetooth"; cada palabra debe aparecer en alguna columna.
//   4. Errores de dedo (solo productos): si no hay coincidencias exactas y
//      PostgreSQL tiene pg_trgm, se buscan palabras PARECIDAS
//      ("audifnos" → "audífonos") y se ordenan de la más a la menos parecida.
import { one } from "./sql.js";

const MAX_PALABRAS = 8;
// word_similarity va de 0 (nada en común) a 1 (la palabra aparece igual).
// Con 0.45 "audifnos" (0.78 contra "audifonos") entra y palabras sin
// relación quedan fuera.
export const SIMILITUD_MINIMA = 0.45;

// Igual que normalizar() de SQL: NFD separa la letra de su acento
// ("í" → "i" + "´") y luego se quitan las marcas de acento.
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// "  Audífonos   BLUET " → ["audifonos", "bluet"] (sin repetidas, máximo 8).
export function palabrasDe(texto) {
  return [...new Set(normalizar(texto).split(" ").filter(Boolean))].slice(0, MAX_PALABRAS);
}

// Patrones para LIKE. Los comodines que escriba el usuario (% y _) se
// escapan para buscarlos literalmente ("100%" no significa "100 y lo que sea").
export const patronesDe = (palabras) => palabras.map((p) => `%${p.replace(/[\\%_]/g, "\\$&")}%`);

// Parámetro listo para la consulta: el arreglo de patrones, o null si no
// se escribió nada (y entonces la condición no filtra).
export function parametroBusqueda(texto) {
  const palabras = palabrasDe(texto);
  return palabras.length ? patronesDe(palabras) : null;
}

// Una columna normalizada; COALESCE porque una columna vacía (NULL) haría
// que toda la comparación diera NULL en vez de "no coincide".
const col = (c) => `normalizar(COALESCE(${c}::text, ''))`;

// Condición SQL: CADA palabra aparece en AL MENOS una de las columnas.
// `n` es el número del parámetro ($n) que recibe parametroBusqueda(texto).
//   "no existe una palabra que no esté en ninguna columna"
export function condicionBusqueda(columnas, n) {
  const enAlguna = columnas.map((c) => `${col(c)} LIKE patron`).join(" OR ");
  return `($${n}::text[] IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest($${n}::text[]) AS patron WHERE NOT (${enAlguna})))`;
}

// Para ordenar: cuántas palabras aparecen en la columna principal (el
// nombre), así "audífonos" pone primero los productos que lo dicen en el nombre.
export function puntajeBusqueda(columna, n) {
  return `(SELECT COUNT(*) FROM unnest(COALESCE($${n}::text[], '{}')) AS patron WHERE ${col(columna)} LIKE patron)`;
}

// --- Tolerancia a errores (pg_trgm) ---------------------------------

let trigramas = null;
// ¿Está instalada pg_trgm? Se pregunta una vez y se recuerda.
export async function hayTrigramas() {
  if (trigramas === null) {
    trigramas = Boolean(await one("SELECT 1 AS si FROM pg_extension WHERE extname = 'pg_trgm'"));
  }
  return trigramas;
}

// Palabras sueltas (no patrones) para word_similarity.
export function parametroParecido(texto) {
  const palabras = palabrasDe(texto);
  return palabras.length ? palabras : null;
}

// Qué tan parecida es una palabra a la mejor de las columnas.
const parecido = (columnas) => `GREATEST(${columnas.map((c) => `word_similarity(palabra, ${col(c)})`).join(", ")})`;

// Condición: cada palabra se PARECE lo suficiente a alguna columna.
export function condicionParecida(columnas, n) {
  return `NOT EXISTS (
    SELECT 1 FROM unnest($${n}::text[]) AS palabra
     WHERE ${parecido(columnas)} < ${SIMILITUD_MINIMA})`;
}

// Puntaje para ordenar de la más a la menos parecida.
export function puntajeParecido(columnas, n) {
  return `(SELECT SUM(${parecido(columnas)}) FROM unnest($${n}::text[]) AS palabra)`;
}
