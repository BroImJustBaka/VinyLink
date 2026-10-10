// Dueño: Persona B (carrito y pedidos)
//
// Todo requiere sesión: el usuario sale de `context.user` (lo llena el módulo
// auth). Para probar sin auth: AUTH_USUARIO_FALSO=1 en back/.env.
//
// Crear un pedido ahora es parte de pagar: la mutación `crearPedido` vive en
// el módulo pagos y usa el inventario de ./servicio.js.
import { pool } from "../../db.js";
import { one, many, iso, mapProducto, mapPedido } from "../../lib/sql.js";
import { requireUser, requireAdmin } from "../auth/context.js";
import { ES_ID, validarCantidad } from "./servicio.js";

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
  return producto;
}

export const resolvers = {
  Query: {
    pedidos: async (_padre, _args, context) => {
      requireAdmin(context);
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
      if (!pedido || (pedido.usuarioId !== Number(user.id) && user.rol !== "ADMIN")) return null;
      return pedido;
    },

    carrito: (_padre, _args, context) => obtenerOcrearCarrito(requireUser(context).id),
  },

  Pedido: {
    // pg regresa Date; el schema espera String (ISO 8601).
    fecha: (padre) => iso(padre.fecha),
    usuario: (padre) => one("SELECT * FROM usuario WHERE id = $1", [padre.usuarioId]),
    detalles: (padre) =>
      many("SELECT * FROM detalle_pedido WHERE pedido_id = $1 ORDER BY id", [padre.id]),
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
    fusionarCarrito: async (_padre, { items }, context) => {
      const user = requireUser(context);
      const carrito = await obtenerOcrearCarrito(user.id);

      for (const { productoId, cantidad } of items) {
        if (!Number.isInteger(cantidad) || cantidad < 1 || !ES_ID.test(String(productoId))) continue;
        const producto = await one("SELECT * FROM producto WHERE id = $1", [productoId]);
        if (!producto || producto.stock < 1) continue;
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
