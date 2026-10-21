// Dueño: Persona A (catálogo)
import { pool } from "../../db.js";
import { one, many, iso, mapProducto, transaccion } from "../../lib/sql.js";
import { registrar } from "../../lib/bitacora.js";
import { publicarStock } from "../../lib/pubsub.js";
import { requirePermiso } from "../auth/context.js";
import { tienePermiso } from "../auth/permisos.js";
import { moverStock } from "../inventario/servicio.js";
import { guardarImagen } from "./imagenes.js";

// Las columnas id son SERIAL (int). Un id que no es número entero (p. ej.
// /categoria/abc) haría fallar a PostgreSQL; lo tratamos como "no existe".
const esIdValido = (id) => /^\d+$/.test(String(id));

// El personal que administra el catálogo también ve los productos inactivos.
const veInactivos = (context) =>
  tienePermiso(context.user, "catalogo") || tienePermiso(context.user, "inventario");

const URL_IMAGEN = /^https?:\/\/\S+$/;

// Revisa los datos de un producto antes de guardarlo (lo usa el panel admin)
// para responder con un mensaje claro en vez del error crudo de PostgreSQL.
async function validarProducto(data, { nuevo }) {
  const limpio = {
    ...data,
    nombre: data.nombre.trim(),
    descripcion: data.descripcion.trim(),
    imagen: data.imagen.trim(),
    sku: data.sku?.trim().toUpperCase() || null,
    stockMinimo: data.stockMinimo ?? 5,
    activo: data.activo ?? true,
  };
  if (!limpio.nombre) throw new Error("Escribe el nombre del producto");
  if (!limpio.descripcion) throw new Error("Escribe la descripción del producto");
  if (!Number.isFinite(limpio.precio) || limpio.precio <= 0) {
    throw new Error("El precio debe ser mayor a 0");
  }
  // Se guarda con 2 decimales como máximo (centavos).
  limpio.precio = Math.round(limpio.precio * 100) / 100;
  if (nuevo || limpio.stock != null) {
    if (!Number.isInteger(limpio.stock) || limpio.stock < 0) {
      throw new Error("El stock debe ser un número entero de 0 o más");
    }
  }
  if (!Number.isInteger(limpio.stockMinimo) || limpio.stockMinimo < 0) {
    throw new Error("El stock mínimo debe ser un número entero de 0 o más");
  }
  if (limpio.sku && !/^[A-Z0-9._-]{2,40}$/.test(limpio.sku)) {
    throw new Error("El SKU solo puede tener letras, números, puntos y guiones (2 a 40)");
  }
  if (!URL_IMAGEN.test(limpio.imagen)) {
    throw new Error("La imagen debe ser una URL que empiece con http:// o https://");
  }
  const categoria = esIdValido(limpio.categoriaId)
    ? await one("SELECT id FROM categoria WHERE id = $1", [limpio.categoriaId])
    : null;
  if (!categoria) throw new Error(`No existe la categoría con id ${limpio.categoriaId}`);
  return limpio;
}

function validarCategoria(data) {
  const limpio = {
    nombre: data.nombre.trim(),
    descripcion: data.descripcion.trim(),
    imagen: data.imagen.trim(),
  };
  if (limpio.nombre.length < 2 || limpio.nombre.length > 60) throw new Error("El nombre debe tener de 2 a 60 caracteres");
  if (!limpio.descripcion) throw new Error("Escribe la descripción de la categoría");
  if (!URL_IMAGEN.test(limpio.imagen)) {
    throw new Error("La imagen debe ser una URL que empiece con http:// o https://");
  }
  return limpio;
}

// El índice único del SKU responde 23505 si ya lo tiene otro producto.
function errorSku(err, sku) {
  if (err.code === "23505") return new Error(`Ya hay otro producto con el SKU "${sku}"`);
  return err;
}

const productoPorId = async (id) => mapProducto(await one("SELECT * FROM producto WHERE id = $1", [id]));

export const resolvers = {
  Query: {
    // Nota N+1: Categoria.productos hace una consulta por categoría.
    // Ver reporte-p6.md → sección "Problema N+1".
    categorias: () => many("SELECT * FROM categoria ORDER BY id"),
    categoria: (_padre, { id }) =>
      esIdValido(id) ? one("SELECT * FROM categoria WHERE id = $1", [id]) : null,

    productos: async (_padre, { limit, offset, categoriaId, incluirInactivos, buscar }, context) => {
      const catId = categoriaId != null && esIdValido(categoriaId) ? categoriaId : null;
      const todos = Boolean(incluirInactivos) && veInactivos(context);
      const texto = veInactivos(context) ? (buscar ?? "").trim() : "";
      const patron = texto ? `%${texto.replace(/[\\%_]/g, "\\$&")}%` : null;
      const filtro = `FROM producto
         WHERE ($1::int IS NULL OR categoria_id = $1)
           AND ($2::boolean OR activo)
           AND ($3::text IS NULL OR nombre ILIKE $3 OR sku ILIKE $3)`;
      const rows = await many(`SELECT * ${filtro} ORDER BY id LIMIT $4 OFFSET $5`, [
        catId,
        todos,
        patron,
        limit,
        offset,
      ]);
      const { total } = await one(`SELECT COUNT(*)::int AS total ${filtro}`, [catId, todos, patron]);
      return { items: rows.map(mapProducto), total };
    },
    producto: async (_padre, { id }, context) => {
      const producto = esIdValido(id) ? await productoPorId(id) : null;
      if (producto && !producto.activo && !veInactivos(context)) return null;
      return producto;
    },

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
           AND activo
         ORDER BY id`,
        [patron, catId]
      );
      return rows.map(mapProducto);
    },
  },

  Categoria: {
    productos: async (padre) =>
      (
        await many("SELECT * FROM producto WHERE categoria_id = $1 AND activo ORDER BY id", [padre.id])
      ).map(mapProducto),
    totalProductos: async (padre) =>
      (await one("SELECT COUNT(*)::int AS n FROM producto WHERE categoria_id = $1", [padre.id])).n,
  },

  Producto: {
    categoria: (padre) => one("SELECT * FROM categoria WHERE id = $1", [padre.categoriaId]),
    creadoEn: (padre) => iso(padre.creado_en),
  },

  // Escrituras del catálogo: permiso "catalogo". Cada una queda en la bitácora.
  Mutation: {
    crearProducto: async (_padre, { data: datos }, context) => {
      const user = requirePermiso(context, "catalogo");
      const data = await validarProducto(datos, { nuevo: true });
      const fila = await transaccion(async (client) => {
        let creado;
        try {
          // Se inserta con stock 0 y el stock inicial entra por el kárdex.
          ({ rows: [creado] } = await client.query(
            `INSERT INTO producto (nombre, descripcion, precio, stock, imagen, categoria_id, sku, stock_minimo, activo)
             VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8) RETURNING *`,
            [data.nombre, data.descripcion, data.precio, data.imagen, data.categoriaId, data.sku, data.stockMinimo, data.activo]
          ));
        } catch (err) {
          throw errorSku(err, data.sku);
        }
        if (data.stock > 0) {
          await moverStock(client, {
            productoId: creado.id,
            cantidad: data.stock,
            tipo: "inicial",
            usuarioId: user.id,
            motivo: "Alta del producto",
          });
        } else {
          await client.query(
            `INSERT INTO movimiento_inventario (producto_id, tipo, cantidad, stock_resultante, usuario_id, motivo)
             VALUES ($1, 'inicial', 0, 0, $2, 'Alta del producto')`,
            [creado.id, user.id]
          );
        }
        await registrar(user, "producto.crear", "producto", creado.id, { nombre: data.nombre, precio: data.precio, stock: data.stock }, client);
        return creado;
      });
      return productoPorId(fila.id);
    },

    actualizarProducto: async (_padre, { id, data: datos }, context) => {
      const user = requirePermiso(context, "catalogo");
      const data = await validarProducto(datos, { nuevo: false });
      const existente = esIdValido(id) ? await productoPorId(id) : null;
      if (!existente) throw new Error(`No existe el producto con id ${id}`);

      await transaccion(async (client) => {
        try {
          await client.query(
            `UPDATE producto SET nombre=$1, descripcion=$2, precio=$3, imagen=$4, categoria_id=$5,
               sku=$6, stock_minimo=$7, activo=$8 WHERE id=$9`,
            [data.nombre, data.descripcion, data.precio, data.imagen, data.categoriaId, data.sku, data.stockMinimo, data.activo, id]
          );
        } catch (err) {
          throw errorSku(err, data.sku);
        }
        // Si el formulario trae un stock distinto, la diferencia es un ajuste.
        const { rows } = await client.query("SELECT stock FROM producto WHERE id = $1 FOR UPDATE", [id]);
        if (data.stock != null && data.stock !== rows[0].stock) {
          await moverStock(client, {
            productoId: Number(id),
            cantidad: data.stock - rows[0].stock,
            tipo: "ajuste",
            usuarioId: user.id,
            motivo: "Editado desde el formulario del producto",
          });
        }
        // Bitácora: solo lo que cambió, como { campo: [antes, después] }.
        const antes = { nombre: existente.nombre, precio: existente.precio, sku: existente.sku, activo: existente.activo, categoriaId: String(existente.categoriaId), stockMinimo: existente.stockMinimo };
        const despues = { nombre: data.nombre, precio: data.precio, sku: data.sku, activo: data.activo, categoriaId: String(data.categoriaId), stockMinimo: data.stockMinimo };
        const cambios = Object.fromEntries(
          Object.keys(antes).filter((k) => antes[k] !== despues[k]).map((k) => [k, [antes[k], despues[k]]])
        );
        await registrar(user, "producto.actualizar", "producto", id, cambios, client);
        // Precio o "activo" también le interesan a quien está viendo el producto.
        client.alConfirmar(() => publicarStock(id));
      });
      return productoPorId(id);
    },

    cambiarActivoProducto: async (_padre, { id, activo }, context) => {
      const user = requirePermiso(context, "catalogo");
      const fila = esIdValido(id)
        ? await one("UPDATE producto SET activo = $2 WHERE id = $1 RETURNING *", [id, activo])
        : null;
      if (!fila) throw new Error(`No existe el producto con id ${id}`);
      await registrar(user, activo ? "producto.activar" : "producto.desactivar", "producto", id, { nombre: fila.nombre });
      await publicarStock(id);
      return mapProducto(fila);
    },

    eliminarProducto: async (_padre, { id }, context) => {
      const user = requirePermiso(context, "catalogo");
      if (!esIdValido(id)) return false;
      try {
        const { rows } = await pool.query("DELETE FROM producto WHERE id = $1 RETURNING nombre", [id]);
        if (rows[0]) await registrar(user, "producto.eliminar", "producto", id, { nombre: rows[0].nombre });
        return rows.length > 0;
      } catch (err) {
        // El producto aparece en pedidos (detalle_pedido lo protege con
        // ON DELETE RESTRICT → código 23001; 23503 es la violación de llave foránea general).
        if (err.code === "23001" || err.code === "23503") {
          throw new Error(
            "No se puede eliminar: el producto ya aparece en pedidos. Desactívalo para dejar de venderlo."
          );
        }
        throw err;
      }
    },

    crearCategoria: async (_padre, { data }, context) => {
      const user = requirePermiso(context, "catalogo");
      const c = validarCategoria(data);
      const fila = await one(
        "INSERT INTO categoria (nombre, descripcion, imagen) VALUES ($1, $2, $3) RETURNING *",
        [c.nombre, c.descripcion, c.imagen]
      );
      await registrar(user, "categoria.crear", "categoria", fila.id, { nombre: c.nombre });
      return fila;
    },

    actualizarCategoria: async (_padre, { id, data }, context) => {
      const user = requirePermiso(context, "catalogo");
      const c = validarCategoria(data);
      const fila = esIdValido(id)
        ? await one("UPDATE categoria SET nombre = $1, descripcion = $2, imagen = $3 WHERE id = $4 RETURNING *", [
            c.nombre,
            c.descripcion,
            c.imagen,
            id,
          ])
        : null;
      if (!fila) throw new Error(`No existe la categoría con id ${id}`);
      await registrar(user, "categoria.actualizar", "categoria", id, { nombre: c.nombre });
      return fila;
    },

    eliminarCategoria: async (_padre, { id }, context) => {
      const user = requirePermiso(context, "catalogo");
      if (!esIdValido(id)) return false;
      try {
        const { rows } = await pool.query("DELETE FROM categoria WHERE id = $1 RETURNING nombre", [id]);
        if (rows[0]) await registrar(user, "categoria.eliminar", "categoria", id, { nombre: rows[0].nombre });
        return rows.length > 0;
      } catch (err) {
        // producto.categoria_id es ON DELETE RESTRICT.
        if (err.code === "23001" || err.code === "23503") {
          throw new Error("No se puede eliminar: la categoría tiene productos. Muévelos a otra categoría primero.");
        }
        throw err;
      }
    },

    subirImagen: async (_padre, { nombre, tipo, base64 }, context) => {
      const user = requirePermiso(context, "catalogo");
      const imagen = await guardarImagen({ nombre, tipo, base64, usuarioId: user.id });
      await registrar(user, "imagen.subir", "imagen", imagen.id, { nombre, bytes: imagen.bytes });
      return imagen;
    },
  },
};
