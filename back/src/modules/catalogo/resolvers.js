// Dueño: Persona A (catálogo)
import { pool } from "../../db.js";
import { one, many, mapProducto } from "../../lib/sql.js";
import { requireAdmin } from "../auth/context.js";

// Las columnas id son SERIAL (int). Un id que no es número entero (p. ej.
// /categoria/abc) haría fallar a PostgreSQL; lo tratamos como "no existe".
const esIdValido = (id) => /^\d+$/.test(String(id));

export const resolvers = {
  Query: {
    // Nota N+1: Categoria.productos hace una consulta por categoría.
    // Ver reporte-p6.md → sección "Problema N+1".
    categorias: () => many("SELECT * FROM categoria ORDER BY id"),
    categoria: (_padre, { id }) =>
      esIdValido(id) ? one("SELECT * FROM categoria WHERE id = $1", [id]) : null,

    productos: async (_padre, { limit, offset, categoriaId }) => {
      const catId = categoriaId != null && esIdValido(categoriaId) ? categoriaId : null;
      const rows = await many(
        `SELECT * FROM producto
         WHERE ($1::int IS NULL OR categoria_id = $1)
         ORDER BY id LIMIT $2 OFFSET $3`,
        [catId, limit, offset]
      );
      const { total } = await one(
        `SELECT COUNT(*)::int AS total FROM producto
         WHERE ($1::int IS NULL OR categoria_id = $1)`,
        [catId]
      );
      return { items: rows.map(mapProducto), total };
    },
    producto: async (_padre, { id }) =>
      esIdValido(id)
        ? mapProducto(await one("SELECT * FROM producto WHERE id = $1", [id]))
        : null,

    // Búsqueda del TopBar (?q=). ILIKE ignora mayúsculas; los comodines que
    // escriba el usuario (% y _) se escapan para buscarlos literalmente.
    buscarProductos: async (_padre, { texto, categoriaId }) => {
      const limpio = texto.trim();
      if (!limpio) return [];
      const patron = `%${limpio.replace(/[\\%_]/g, "\\$&")}%`;
      const catId = categoriaId != null && esIdValido(categoriaId) ? categoriaId : null;
      const rows = await many(
        `SELECT * FROM producto
         WHERE (nombre ILIKE $1 OR descripcion ILIKE $1)
           AND ($2::int IS NULL OR categoria_id = $2)
         ORDER BY id`,
        [patron, catId]
      );
      return rows.map(mapProducto);
    },
  },

  Categoria: {
    productos: async (padre) =>
      (
        await many("SELECT * FROM producto WHERE categoria_id = $1 ORDER BY id", [padre.id])
      ).map(mapProducto),
  },

  Producto: {
    categoria: (padre) => one("SELECT * FROM categoria WHERE id = $1", [padre.categoriaId]),
  },

  // Escrituras del catálogo: solo administradores (contrato de C).
  Mutation: {
    crearProducto: async (_padre, { data }, context) => {
      requireAdmin(context);
      const categoria = await one("SELECT * FROM categoria WHERE id = $1", [data.categoriaId]);
      if (!categoria) {
        throw new Error(`No existe la categoría con id ${data.categoriaId}`);
      }
      const fila = await one(
        `INSERT INTO producto (nombre, descripcion, precio, stock, imagen, categoria_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.nombre, data.descripcion, data.precio, data.stock, data.imagen, data.categoriaId]
      );
      return mapProducto(fila);
    },

    actualizarProducto: async (_padre, { id, data }, context) => {
      requireAdmin(context);
      const existente = esIdValido(id)
        ? await one("SELECT * FROM producto WHERE id = $1", [id])
        : null;
      if (!existente) throw new Error(`No existe el producto con id ${id}`);
      const fila = await one(
        `UPDATE producto SET nombre=$1, descripcion=$2, precio=$3,
           stock=$4, imagen=$5, categoria_id=$6 WHERE id=$7 RETURNING *`,
        [data.nombre, data.descripcion, data.precio, data.stock, data.imagen, data.categoriaId, id]
      );
      return mapProducto(fila);
    },

    eliminarProducto: async (_padre, { id }, context) => {
      requireAdmin(context);
      if (!esIdValido(id)) return false;
      const { rowCount } = await pool.query("DELETE FROM producto WHERE id = $1", [id]);
      return rowCount > 0;
    },
  },
};
