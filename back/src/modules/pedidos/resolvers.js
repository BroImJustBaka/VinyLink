// Dueño: Persona B (carrito y pedidos)
//
// Todo requiere sesión: el usuario sale de `context.user` (lo llena el módulo
// auth). Para probar sin auth: AUTH_USUARIO_FALSO=1 en back/.env.
//
// Crear un pedido ahora es parte de pagar: la mutación `crearPedido` vive en
// el módulo pagos y usa el inventario de ./servicio.js.
import { pool } from "../../db.js";
import { one, many, iso, mapProducto, mapPedido, redondear } from "../../lib/sql.js";
import { requireUser, requirePermiso } from "../auth/context.js";
import { tienePermiso } from "../auth/permisos.js";
import { leerConfiguracion } from "../configuracion/servicio.js";
import {
  ES_ID,
  validarCantidad,
  leerRenglones,
  calcularTotales,
  guardarEnLibreta,
} from "./servicio.js";

// IVA incluido en un precio: total × p / (100 + p). Con 16 %: $116 → $16.
const ivaIncluido = (total, porcentaje) => redondear((total * porcentaje) / (100 + porcentaje));

// Obtiene el carrito del usuario; si no tiene uno, lo crea vacío.
async function obtenerOcrearCarrito(usuarioId) {
  await pool.query(
    "INSERT INTO carrito (usuario_id) VALUES ($1) ON CONFLICT (usuario_id) DO NOTHING",
    [usuarioId]
  );
  return one("SELECT * FROM carrito WHERE usuario_id = $1", [usuarioId]);
}

const productoPorId = async (id) =>
  mapProducto(await one("SELECT * FROM producto WHERE id = $1", [id]));

async function productoOError(productoId) {
  if (!ES_ID.test(String(productoId))) throw new Error(`No existe el producto con id ${productoId}`);
  const producto = await one("SELECT * FROM producto WHERE id = $1", [productoId]);
  if (!producto) throw new Error(`No existe el producto con id ${productoId}`);
  if (!producto.activo) throw new Error(`"${producto.nombre}" ya no está a la venta`);
  return producto;
}

export const resolvers = {
  Query: {
    pedidos: async (_padre, _args, context) => {
      requirePermiso(context, "pedidos.ver");
      return (await many("SELECT * FROM pedido ORDER BY id DESC")).map(mapPedido);
    },

    misPedidos: async (_padre, _args, context) => {
      const user = requireUser(context);
      return (
        await many("SELECT * FROM pedido WHERE usuario_id = $1 ORDER BY fecha DESC, id DESC", [
          user.id,
        ])
      ).map(mapPedido);
    },

    pedido: async (_padre, { id }, context) => {
      const user = requireUser(context);
      if (!ES_ID.test(String(id))) return null;
      const pedido = mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [id]));
      // Un pedido ajeno se ve igual que uno inexistente (no revela que existe).
      if (!pedido || (pedido.usuarioId !== Number(user.id) && !tienePermiso(user, "pedidos.ver"))) return null;
      return pedido;
    },

    carrito: (_padre, _args, context) => obtenerOcrearCarrito(requireUser(context).id),

    // No necesita sesión: un invitado también ve cuánto costaría el envío.
    // Si el cupón no aplica, se cotiza sin él y se explica por qué.
    cotizarPedido: async (_padre, { data }, context) => {
      const usuarioId = context.user?.id ?? null;
      const renglones = await leerRenglones(pool, data.items);
      let totales;
      let errorCupon = null;
      try {
        totales = await calcularTotales(pool, { usuarioId, renglones, cupon: data.cupon });
      } catch (err) {
        if (!data.cupon) throw err;
        errorCupon = err.message;
        totales = await calcularTotales(pool, { usuarioId, renglones, cupon: null });
      }
      const config = await leerConfiguracion();
      const total = totales.totalCentavos / 100;
      const base = (totales.subtotalCentavos - totales.descuentoCentavos) / 100;
      return {
        subtotal: totales.subtotalCentavos / 100,
        descuento: totales.descuentoCentavos / 100,
        costoEnvio: totales.envioCentavos / 100,
        total,
        iva: ivaIncluido(total, config.ivaPorcentaje),
        cupon: totales.cupon?.codigo ?? null,
        cuponDescripcion: totales.cupon?.descripcion ?? null,
        errorCupon,
        faltaParaEnvioGratis:
          totales.envioCentavos > 0 && config.envioGratisDesde > 0
            ? redondear(config.envioGratisDesde - base)
            : null,
      };
    },

    misDirecciones: (_padre, _args, context) =>
      many("SELECT * FROM direccion WHERE usuario_id = $1 ORDER BY creada_en DESC, id DESC", [
        requireUser(context).id,
      ]),
  },

  Pedido: {
    // pg regresa Date; el schema espera String (ISO 8601).
    fecha: (padre) => iso(padre.fecha),
    subtotal: (padre) => padre.subtotal ?? padre.total,
    descuento: (padre) => padre.descuento ?? 0,
    iva: async (padre) => ivaIncluido(padre.total, (await leerConfiguracion()).ivaPorcentaje),
    cupon: async (padre) =>
      padre.cupon_id ? (await one("SELECT codigo FROM cupon WHERE id = $1", [padre.cupon_id]))?.codigo ?? null : null,
    enviadoEn: (padre) => iso(padre.enviado_en),
    entregadoEn: (padre) => iso(padre.entregado_en),
    usuario: (padre) => one("SELECT * FROM usuario WHERE id = $1", [padre.usuarioId]),
    detalles: (padre) =>
      many("SELECT * FROM detalle_pedido WHERE pedido_id = $1 ORDER BY id", [padre.id]),
    // Cambios de estado + notas internas, en orden. Las notas solo las ve el personal.
    historial: async (padre, _args, context) => {
      const conNotas = tienePermiso(context.user, "pedidos.ver");
      const filas = await many(
        `SELECT 'estado' AS tipo, h.creado_en AS fecha, h.estado_anterior, h.estado_nuevo,
                h.comentario AS texto, u.nombre AS autor, h.id
           FROM historial_pedido h LEFT JOIN usuario u ON u.id = h.usuario_id
          WHERE h.pedido_id = $1
         UNION ALL
         SELECT 'nota', n.creado_en, NULL, NULL, n.texto, u.nombre, n.id
           FROM nota_pedido n LEFT JOIN usuario u ON u.id = n.usuario_id
          WHERE n.pedido_id = $1 AND $2::boolean
          ORDER BY fecha, id`,
        [padre.id, conNotas]
      );
      return filas.map((f) => ({
        tipo: f.tipo,
        fecha: iso(f.fecha),
        estadoAnterior: f.estado_anterior,
        estadoNuevo: f.estado_nuevo,
        texto: f.texto,
        // Al cliente no se le dice qué empleado hizo el cambio.
        autor: conNotas ? f.autor : null,
      }));
    },
  },

  DetallePedido: {
    producto: (padre) => productoPorId(padre.producto_id),
    precioUnitario: (padre) => padre.precio_unitario,
    // Redondeado a centavos: 3 × 899.99 daría 2699.9700000000003.
    subtotal: (padre) => Math.round(padre.cantidad * padre.precio_unitario * 100) / 100,
  },

  Carrito: {
    usuario: (padre) => one("SELECT * FROM usuario WHERE id = $1", [padre.usuario_id]),
    items: (padre) =>
      many("SELECT * FROM detalle_carrito WHERE carrito_id = $1 ORDER BY id", [padre.id]),
    total: async (padre) => {
      const { total } = await one(
        `SELECT COALESCE(SUM(dc.cantidad * p.precio), 0)::float AS total
         FROM detalle_carrito dc JOIN producto p ON p.id = dc.producto_id
         WHERE dc.carrito_id = $1`,
        [padre.id]
      );
      return total;
    },
  },

  DetalleCarrito: {
    producto: (padre) => productoPorId(padre.producto_id),
    subtotal: async (padre) => padre.cantidad * (await productoPorId(padre.producto_id)).precio,
  },

  Mutation: {
    agregarAlCarrito: async (_padre, { productoId, cantidad }, context) => {
      const user = requireUser(context);
      validarCantidad(cantidad);
      const producto = await productoOError(productoId);

      const carrito = await obtenerOcrearCarrito(user.id);
      const actual = await one(
        "SELECT cantidad FROM detalle_carrito WHERE carrito_id = $1 AND producto_id = $2",
        [carrito.id, producto.id]
      );
      if ((actual?.cantidad ?? 0) + cantidad > producto.stock) {
        throw new Error(`Stock insuficiente para "${producto.nombre}"`);
      }
      await pool.query(
        `INSERT INTO detalle_carrito (carrito_id, producto_id, cantidad) VALUES ($1, $2, $3)
         ON CONFLICT (carrito_id, producto_id)
         DO UPDATE SET cantidad = detalle_carrito.cantidad + EXCLUDED.cantidad`,
        [carrito.id, producto.id, cantidad]
      );
      return carrito;
    },

    cambiarCantidadCarrito: async (_padre, { productoId, cantidad }, context) => {
      const user = requireUser(context);
      const carrito = await obtenerOcrearCarrito(user.id);
      if (cantidad <= 0) {
        await pool.query(
          "DELETE FROM detalle_carrito WHERE carrito_id = $1 AND producto_id = $2",
          [carrito.id, productoId]
        );
      } else {
        const producto = await productoOError(productoId);
        if (cantidad > producto.stock) {
          throw new Error(`Stock insuficiente para "${producto.nombre}"`);
        }
        await pool.query(
          `INSERT INTO detalle_carrito (carrito_id, producto_id, cantidad) VALUES ($1, $2, $3)
           ON CONFLICT (carrito_id, producto_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
          [carrito.id, producto.id, cantidad]
        );
      }
      return carrito;
    },

    quitarDelCarrito: async (_padre, { productoId }, context) => {
      const user = requireUser(context);
      const carrito = await obtenerOcrearCarrito(user.id);
      await pool.query(
        "DELETE FROM detalle_carrito WHERE carrito_id = $1 AND producto_id = $2",
        [carrito.id, productoId]
      );
      return carrito;
    },

    vaciarCarritoDB: async (_padre, _args, context) => {
      const user = requireUser(context);
      const carrito = await obtenerOcrearCarrito(user.id);
      await pool.query("DELETE FROM detalle_carrito WHERE carrito_id = $1", [carrito.id]);
      return carrito;
    },

    // Carrito de invitado → carrito del usuario. No falla por productos que
    // ya no existen o sin stock: los omite / recorta, para no bloquear el login.
    guardarDireccion: async (_padre, { data }, context) => {
      const user = requireUser(context);
      const { total } = await one("SELECT COUNT(*)::int AS total FROM direccion WHERE usuario_id = $1", [user.id]);
      if (total >= 10) throw new Error("Tu libreta ya tiene 10 direcciones; borra alguna para agregar otra");
      const id = await guardarEnLibreta(user.id, data);
      return one("SELECT * FROM direccion WHERE id = $1", [id]);
    },

    eliminarDireccion: async (_padre, { id }, context) => {
      const user = requireUser(context);
      if (!ES_ID.test(String(id))) return false;
      const { rowCount } = await pool.query("DELETE FROM direccion WHERE id = $1 AND usuario_id = $2", [id, user.id]);
      return rowCount > 0;
    },

    fusionarCarrito: async (_padre, { items }, context) => {
      const user = requireUser(context);
      const carrito = await obtenerOcrearCarrito(user.id);

      for (const { productoId, cantidad } of items) {
        if (!Number.isInteger(cantidad) || cantidad < 1 || !ES_ID.test(String(productoId))) continue;
        const producto = await one("SELECT * FROM producto WHERE id = $1", [productoId]);
        if (!producto || !producto.activo || producto.stock < 1) continue;
        await pool.query(
          `INSERT INTO detalle_carrito (carrito_id, producto_id, cantidad)
           VALUES ($1, $2, LEAST($3::int, $4::int))
           ON CONFLICT (carrito_id, producto_id)
           DO UPDATE SET cantidad = LEAST(detalle_carrito.cantidad + $3::int, $4::int)`,
          [carrito.id, producto.id, cantidad, producto.stock]
        );
      }
      return carrito;
    },
  },
};
