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
export async function transaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// pg regresa las columnas TIMESTAMPTZ como Date; el schema usa String ISO 8601.
export const iso = (fecha) => (fecha instanceof Date ? fecha.toISOString() : fecha ?? null);

// Filas snake_case de PostgreSQL → campos camelCase del schema.
export function mapProducto(row) {
  if (!row) return null;
  return { ...row, categoriaId: row.categoria_id };
}

export function mapPedido(row) {
  if (!row) return null;
  return { ...row, usuarioId: row.usuario_id, metodoPago: row.metodo_pago };
}
