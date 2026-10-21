import { pool } from "../db.js";

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Corre `fn(client)` dentro de una transacción: si todo sale bien hace
// COMMIT y si algo lanza un error hace ROLLBACK (no queda nada a medias).
//
// `client.alConfirmar(efecto)` registra algo que debe pasar SOLO si la
// transacción se confirma (avisos en tiempo real, correos): así nunca se
// anuncia un cambio que al final se deshizo con ROLLBACK.
export async function transaccion(fn) {
  const client = await pool.connect();
  const efectos = [];
  client.alConfirmar = (efecto) => efectos.push(efecto);
  let resultado;
  try {
    await client.query("BEGIN");
    resultado = await fn(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    delete client.alConfirmar;
    client.release();
  }
  for (const efecto of efectos) {
    try {
      await efecto();
    } catch (err) {
      console.error("Falló un efecto después del COMMIT:", err.message);
    }
  }
  return resultado;
}

// Fuera de una transacción (con el pool) el efecto se corre de inmediato.
export function alConfirmar(client, efecto) {
  if (client?.alConfirmar) client.alConfirmar(efecto);
  else Promise.resolve().then(efecto).catch((err) => console.error("Falló un efecto:", err.message));
}

// pg regresa las columnas TIMESTAMPTZ como Date; el schema usa String ISO 8601.
export const iso = (fecha) => (fecha instanceof Date ? fecha.toISOString() : fecha ?? null);

// Filas snake_case de PostgreSQL → campos camelCase del schema.
export function mapProducto(row) {
  if (!row) return null;
  return { ...row, categoriaId: row.categoria_id, stockMinimo: row.stock_minimo };
}

export function mapPedido(row) {
  if (!row) return null;
  return {
    ...row,
    usuarioId: row.usuario_id,
    metodoPago: row.metodo_pago,
    costoEnvio: row.costo_envio ?? 0,
    numeroGuia: row.numero_guia,
    montoReembolsado: row.monto_reembolsado ?? 0,
  };
}

// Redondea a centavos (2 decimales).
export const redondear = (n) => Math.round(Number(n) * 100) / 100;
