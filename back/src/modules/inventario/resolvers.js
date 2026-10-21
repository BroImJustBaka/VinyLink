import { one, many, iso, mapProducto, transaccion, redondear } from "../../lib/sql.js";
import { registrar } from "../../lib/bitacora.js";
import { requirePermiso } from "../auth/context.js";
import { ES_ID } from "../pedidos/servicio.js";
import { moverStock, TIPOS } from "./servicio.js";

const mapMovimiento = (f) =>
  f && {
    ...f,
    pedidoId: f.pedido_id,
    stockResultante: f.stock_resultante,
    costoUnitario: f.costo_unitario,
    creadoEn: iso(f.creado_en),
  };

// Proveedor con cuántas entradas y piezas ha surtido.
const CONSULTA_PROVEEDOR = `
  SELECT pr.*,
         COUNT(m.id)::int AS entradas,
         COALESCE(SUM(m.cantidad), 0)::int AS piezas,
         MAX(m.creado_en) AS ultima_entrada
    FROM proveedor pr
    LEFT JOIN movimiento_inventario m ON m.proveedor_id = pr.id AND m.tipo = 'entrada'`;

const mapProveedor = (f) =>
  f && { ...f, ultimaEntrada: iso(f.ultima_entrada), creadoEn: iso(f.creado_en) };

const proveedorPorId = async (id) =>
  mapProveedor(await one(`${CONSULTA_PROVEEDOR} WHERE pr.id = $1 GROUP BY pr.id`, [id]));

function validarProveedor(data) {
  const t = (v) => (v == null ? null : String(v).trim() || null);
  const p = {
    nombre: t(data.nombre) ?? "",
    contacto: t(data.contacto),
    email: t(data.email)?.toLowerCase() ?? null,
    telefono: t(data.telefono),
    notas: t(data.notas),
    activo: data.activo ?? true,
  };
  if (p.nombre.length < 2 || p.nombre.length > 100) throw new Error("El nombre del proveedor debe tener de 2 a 100 caracteres");
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new Error("El email del proveedor no es válido");
  return p;
}

async function guardarProveedor(sql, params) {
  try {
    return await one(sql, params);
  } catch (err) {
    if (err.code === "23505") throw new Error(`Ya existe un proveedor llamado "${params[0]}"`);
    throw err;
  }
}

async function productoOError(client, productoId) {
  if (!ES_ID.test(String(productoId))) throw new Error(`No existe el producto con id ${productoId}`);
  // FOR UPDATE: dos ajustes al mismo tiempo no se pisan.
  const { rows } = await client.query("SELECT * FROM producto WHERE id = $1 FOR UPDATE", [productoId]);
  if (!rows[0]) throw new Error(`No existe el producto con id ${productoId}`);
  return rows[0];
}

export const resolvers = {
  Query: {
    adminMovimientos: async (_padre, { productoId, tipo, limite, offset }, context) => {
      requirePermiso(context, "inventario");
      const prod = productoId && ES_ID.test(String(productoId)) ? productoId : null;
      const tip = TIPOS.includes(tipo) ? tipo : null;
      const filtro = `FROM movimiento_inventario
        WHERE ($1::int IS NULL OR producto_id = $1) AND ($2::text IS NULL OR tipo = $2)`;
      const items = await many(
        `SELECT * ${filtro} ORDER BY creado_en DESC, id DESC LIMIT $3 OFFSET $4`,
        [prod, tip, Math.min(Math.max(Number(limite) || 30, 1), 200), Math.max(Number(offset) || 0, 0)]
      );
      const { total } = await one(`SELECT COUNT(*)::int AS total ${filtro}`, [prod, tip]);
      return { items: items.map(mapMovimiento), total };
    },

    adminResumenInventario: async (_padre, _args, context) => {
      requirePermiso(context, "inventario", "catalogo");
      const r = await one(
        `SELECT COUNT(*)::int AS productos,
                COALESCE(SUM(stock), 0)::int AS piezas,
                COALESCE(SUM(stock * precio), 0)::float AS valor,
                COUNT(*) FILTER (WHERE stock = 0)::int AS agotados,
                COUNT(*) FILTER (WHERE stock <= stock_minimo)::int AS bajo
           FROM producto WHERE activo`
      );
      return { productos: r.productos, piezas: r.piezas, valorVenta: redondear(r.valor), agotados: r.agotados, bajoMinimo: r.bajo };
    },

    proveedores: async (_padre, { incluirInactivos }, context) => {
      requirePermiso(context, "inventario");
      return (
        await many(
          `${CONSULTA_PROVEEDOR} WHERE ($1::boolean OR pr.activo) GROUP BY pr.id ORDER BY pr.activo DESC, lower(pr.nombre)`,
          [Boolean(incluirInactivos)]
        )
      ).map(mapProveedor);
    },

    proveedor: async (_padre, { id }, context) => {
      requirePermiso(context, "inventario");
      return ES_ID.test(String(id)) ? proveedorPorId(id) : null;
    },
  },

  Producto: {
    movimientos: async (padre, { limite }, context) => {
      requirePermiso(context, "inventario", "catalogo");
      return (
        await many(
          "SELECT * FROM movimiento_inventario WHERE producto_id = $1 ORDER BY creado_en DESC, id DESC LIMIT $2",
          [padre.id, Math.min(Math.max(Number(limite) || 20, 1), 200)]
        )
      ).map(mapMovimiento);
    },
  },

  MovimientoInventario: {
    producto: async (padre) => mapProducto(await one("SELECT * FROM producto WHERE id = $1", [padre.producto_id])),
    proveedor: async (padre) => (padre.proveedor_id ? proveedorPorId(padre.proveedor_id) : null),
    usuario: (padre) =>
      padre.usuario_id ? one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1", [padre.usuario_id]) : null,
  },

  Mutation: {
    registrarEntrada: async (_padre, { productoId, cantidad, proveedorId, costoUnitario, motivo }, context) => {
      const user = requirePermiso(context, "inventario");
      if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error("La cantidad que entra debe ser un entero mayor a 0");
      if (costoUnitario != null && (!Number.isFinite(costoUnitario) || costoUnitario < 0)) {
        throw new Error("El costo unitario no puede ser negativo");
      }
      let proveedor = null;
      if (proveedorId) {
        proveedor = ES_ID.test(String(proveedorId)) ? await one("SELECT * FROM proveedor WHERE id = $1", [proveedorId]) : null;
        if (!proveedor) throw new Error("Elige un proveedor válido");
      }
      const mov = await transaccion(async (client) => {
        const producto = await productoOError(client, productoId);
        const m = await moverStock(client, {
          productoId: producto.id,
          cantidad,
          tipo: "entrada",
          proveedorId: proveedor?.id ?? null,
          costoUnitario: costoUnitario == null ? null : redondear(costoUnitario),
          usuarioId: user.id,
          motivo: motivo?.trim() || (proveedor ? `Compra a ${proveedor.nombre}` : "Entrada de mercancía"),
        });
        await registrar(user, "inventario.entrada", "producto", producto.id, { nombre: producto.nombre, cantidad, proveedor: proveedor?.nombre ?? null }, client);
        return m;
      });
      return mapMovimiento(mov);
    },

    ajustarStock: async (_padre, { productoId, stockNuevo, motivo }, context) => {
      const user = requirePermiso(context, "inventario");
      if (!Number.isInteger(stockNuevo) || stockNuevo < 0) throw new Error("El stock nuevo debe ser un entero de 0 o más");
      const razon = motivo?.trim();
      if (!razon || razon.length < 3) throw new Error("Escribe el motivo del ajuste (por ejemplo: conteo físico, pieza dañada)");
      const mov = await transaccion(async (client) => {
        const producto = await productoOError(client, productoId);
        const diferencia = stockNuevo - producto.stock;
        if (diferencia === 0) throw new Error(`"${producto.nombre}" ya tiene ${stockNuevo} piezas; no hay nada que ajustar`);
        const m = await moverStock(client, {
          productoId: producto.id,
          cantidad: diferencia,
          tipo: "ajuste",
          usuarioId: user.id,
          motivo: razon,
        });
        await registrar(user, "inventario.ajuste", "producto", producto.id, { nombre: producto.nombre, stock: [producto.stock, stockNuevo], motivo: razon }, client);
        return m;
      });
      return mapMovimiento(mov);
    },

    crearProveedor: async (_padre, { data }, context) => {
      const user = requirePermiso(context, "inventario");
      const p = validarProveedor(data);
      const fila = await guardarProveedor(
        `INSERT INTO proveedor (nombre, contacto, email, telefono, notas, activo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [p.nombre, p.contacto, p.email, p.telefono, p.notas, p.activo]
      );
      await registrar(user, "proveedor.crear", "proveedor", fila.id, { nombre: p.nombre });
      return proveedorPorId(fila.id);
    },

    actualizarProveedor: async (_padre, { id, data }, context) => {
      const user = requirePermiso(context, "inventario");
      const p = validarProveedor(data);
      const fila = ES_ID.test(String(id))
        ? await guardarProveedor(
            `UPDATE proveedor SET nombre = $1, contacto = $2, email = $3, telefono = $4, notas = $5, activo = $6
              WHERE id = $7 RETURNING id`,
            [p.nombre, p.contacto, p.email, p.telefono, p.notas, p.activo, id]
          )
        : null;
      if (!fila) throw new Error(`No existe el proveedor #${id}`);
      await registrar(user, "proveedor.actualizar", "proveedor", id, { nombre: p.nombre, activo: p.activo });
      return proveedorPorId(id);
    },
  },
};
