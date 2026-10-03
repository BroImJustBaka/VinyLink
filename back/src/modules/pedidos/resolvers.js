// Dueño: Persona B (carrito y pedidos)
//
// Todo requiere sesión: el usuario sale de `context.user` (lo llena el módulo
// auth). Para probar sin auth: AUTH_USUARIO_FALSO=1 en back/.env.
import { pool } from "../../db.js";
import { one, many, mapProducto, mapPedido } from "../../lib/sql.js";
import { requireUser, requireAdmin } from "../auth/context.js";

const ES_ID = /^\d+$/;

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

function validarCantidad(cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error("La cantidad debe ser un entero mayor a 0");
  }
}

async function productoOError(productoId) {
  if (!ES_ID.test(String(productoId))) throw new Error(`No existe el producto con id ${productoId}`);
  const producto = await one("SELECT * FROM producto WHERE id = $1", [productoId]);
  if (!producto) throw new Error(`No existe el producto con id ${productoId}`);
  return producto;
}

// Junta renglones repetidos del mismo producto (suma sus cantidades).
function agruparItems(items) {
  const mapa = new Map();
  for (const { productoId, cantidad } of items) {
    validarCantidad(cantidad);
    const clave = String(productoId);
    mapa.set(clave, (mapa.get(clave) ?? 0) + cantidad);
  }
  return [...mapa].map(([productoId, cantidad]) => ({ productoId, cantidad }));
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
    fecha: (padre) => (padre.fecha instanceof Date ? padre.fecha.toISOString() : padre.fecha),
    usuario: (padre) => one("SELECT * FROM usuario WHERE id = $1", [padre.usuarioId]),
    detalles: (padre) =>
      many("SELECT * FROM detalle_pedido WHERE pedido_id = $1 ORDER BY id", [padre.id]),
  },

  DetallePedido: {
    producto: (padre) => productoPorId(padre.producto_id),
    precioUnitario: (padre) => padre.precio_unitario,
    subtotal: (padre) => padre.cantidad * padre.precio_unitario,
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
    crearPedido: async (_padre, { data }, context) => {
      const user = requireUser(context);
      if (!data.items || data.items.length === 0) {
        throw new Error("El pedido necesita al menos un producto");
      }
      const items = agruparItems(data.items);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Bloquea los productos (en orden de id, para evitar interbloqueos) y
        // valida el stock de todos los renglones ANTES de escribir nada.
        const renglones = [];
        const ordenados = [...items].sort((a, b) => Number(a.productoId) - Number(b.productoId));
        for (const { productoId, cantidad } of ordenados) {
          if (!ES_ID.test(String(productoId))) {
            throw new Error(`No existe el producto con id ${productoId}`);
          }
          const { rows } = await client.query(
            "SELECT * FROM producto WHERE id = $1 FOR UPDATE",
            [productoId]
          );
          const producto = rows[0];
          if (!producto) throw new Error(`No existe el producto con id ${productoId}`);
          if (producto.stock < cantidad) {
            throw new Error(`Stock insuficiente para "${producto.nombre}"`);
          }
          renglones.push({ producto, cantidad });
        }

        const total = renglones.reduce((acc, r) => acc + r.cantidad * r.producto.precio, 0);

        const { rows: pedidoRows } = await client.query(
          "INSERT INTO pedido (total, usuario_id) VALUES ($1, $2) RETURNING *",
          [total, user.id]
        );
        const pedido = pedidoRows[0];

        for (const { producto, cantidad } of renglones) {
          await client.query(
            `INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, precio_unitario)
             VALUES ($1, $2, $3, $4)`,
            [pedido.id, producto.id, cantidad, producto.precio]
          );
          await client.query("UPDATE producto SET stock = stock - $1 WHERE id = $2", [
            cantidad,
            producto.id,
          ]);
        }

        // El pedido ya "consumió" el carrito guardado en DB.
        await client.query(
          "DELETE FROM detalle_carrito WHERE carrito_id IN (SELECT id FROM carrito WHERE usuario_id = $1)",
          [user.id]
        );

        await client.query("COMMIT");
        return mapPedido(pedido);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

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
