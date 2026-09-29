// Dueño: Persona A (catálogo)
import { pool } from "../../db.js";
import { one, many, mapProducto } from "../../lib/sql.js";

export const resolvers = {
  Query: {
    // Nota N+1: Categoria.productos hace una consulta por categoría.
    // Ver reporte-p6.md → sección "Problema N+1".
    categorias: () => many("SELECT * FROM categoria ORDER BY id"),
    categoria: (_padre, { id }) => one("SELECT * FROM categoria WHERE id = $1", [id]),

    productos: async (_padre, { limit, offset, categoriaId }) => {
      const catId = categoriaId ?? null;
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
      mapProducto(await one("SELECT * FROM producto WHERE id = $1", [id])),
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

  // TODO(C): cuando exista requireAdmin() en modules/auth/context.js,
  // protege estas tres mutations con él.
  Mutation: {
    crearProducto: async (_padre, { data }) => {
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

    actualizarProducto: async (_padre, { id, data }) => {
      const existente = await one("SELECT * FROM producto WHERE id = $1", [id]);
      if (!existente) throw new Error(`No existe el producto con id ${id}`);
      const fila = await one(
        `UPDATE producto SET nombre=$1, descripcion=$2, precio=$3,
           stock=$4, imagen=$5, categoria_id=$6 WHERE id=$7 RETURNING *`,
        [data.nombre, data.descripcion, data.precio, data.stock, data.imagen, data.categoriaId, id]
      );
      return mapProducto(fila);
    },

    eliminarProducto: async (_padre, { id }) => {
      const { rowCount } = await pool.query("DELETE FROM producto WHERE id = $1", [id]);
      return rowCount > 0;
    },
  },
};
