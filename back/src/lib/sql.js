import { pool } from "../db.js";

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Filas snake_case de PostgreSQL → campos camelCase del schema.
export function mapProducto(row) {
  if (!row) return null;
  return { ...row, categoriaId: row.categoria_id };
}

export function mapPedido(row) {
  if (!row) return null;
  return { ...row, usuarioId: row.usuario_id };
}
