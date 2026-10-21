// Configuración de la tienda guardada en la tabla `configuracion`
// (clave → valor JSON). Se lee mucho (cada pedido calcula su envío) y cambia
// poco, así que se guarda en memoria y se vuelve a leer después de editarla.
import { pool } from "../../db.js";
import { many } from "../../lib/sql.js";

// Clave en la base → campo del schema, con su valor por defecto y su validación.
export const CAMPOS = {
  nombre_tienda: { campo: "nombreTienda", defecto: "VinyLink", tipo: "texto" },
  email_contacto: { campo: "emailContacto", defecto: "contacto@vinylink.mx", tipo: "email" },
  costo_envio: { campo: "costoEnvio", defecto: 149, tipo: "dinero" },
  envio_gratis_desde: { campo: "envioGratisDesde", defecto: 999, tipo: "dinero" },
  iva_porcentaje: { campo: "ivaPorcentaje", defecto: 16, tipo: "porcentaje" },
  paqueterias: { campo: "paqueterias", defecto: ["Estafeta", "DHL", "FedEx"], tipo: "lista" },
};

let cache = null;

export async function leerConfiguracion() {
  if (cache) return cache;
  const filas = await many("SELECT clave, valor FROM configuracion");
  const guardado = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  const config = {};
  for (const [clave, { campo, defecto }] of Object.entries(CAMPOS)) {
    config[campo] = guardado[clave] ?? defecto;
  }
  cache = config;
  return config;
}

function validar(tipo, valor, campo) {
  if (tipo === "texto") {
    const t = String(valor ?? "").trim();
    if (!t || t.length > 80) throw new Error(`${campo}: escribe un texto de 1 a 80 caracteres`);
    return t;
  }
  if (tipo === "email") {
    const t = String(valor ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new Error(`${campo}: el email no es válido`);
    return t;
  }
  if (tipo === "dinero") {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error(`${campo}: debe ser un monto de 0 a 100,000`);
    return Math.round(n * 100) / 100;
  }
  if (tipo === "porcentaje") {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${campo}: debe ser un porcentaje de 0 a 100`);
    return n;
  }
  if (tipo === "lista") {
    const lista = (Array.isArray(valor) ? valor : [])
      .map((x) => String(x).trim())
      .filter(Boolean);
    if (lista.length === 0) throw new Error(`${campo}: agrega al menos una opción`);
    return [...new Set(lista)].slice(0, 20);
  }
  return valor;
}

// Guarda solo los campos que vienen en `datos` (los demás no se tocan).
// Regresa { antes, despues } para la bitácora.
export async function guardarConfiguracion(datos) {
  const antes = await leerConfiguracion();
  const cambios = [];
  for (const [clave, { campo, tipo }] of Object.entries(CAMPOS)) {
    if (datos[campo] === undefined || datos[campo] === null) continue;
    cambios.push([clave, validar(tipo, datos[campo], campo)]);
  }
  for (const [clave, valor] of cambios) {
    await pool.query(
      `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
      [clave, JSON.stringify(valor)]
    );
  }
  cache = null;
  return { antes, despues: await leerConfiguracion() };
}

// Costo de envío de un pedido (en centavos) según la configuración.
// `envioGratis` = un cupón de envío gratis.
export async function costoEnvioCentavos(baseCentavos, { envioGratis = false } = {}) {
  const { costoEnvio, envioGratisDesde } = await leerConfiguracion();
  if (envioGratis || costoEnvio <= 0) return 0;
  if (envioGratisDesde > 0 && baseCentavos >= Math.round(envioGratisDesde * 100)) return 0;
  return Math.round(costoEnvio * 100);
}
