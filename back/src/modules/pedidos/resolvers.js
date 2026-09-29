// Dueño: Persona B (carrito y pedidos)
//
// TODO(B): dejar de recibir `usuarioId` por argumento y usar `context.user`
// (lo llena el módulo auth). Mientras C no lo termine, context.user es null:
// puedes probar con AUTH_USUARIO_FALSO=1 en back/.env (ver modules/auth/context.js).
import { pool } from "../../db.js";
import { one, many, mapProducto, mapPedido } from "../../lib/sql.js";

// Obtiene el carrito del usuario; si no tiene uno, lo crea vacío.
async function obtenerOcrearCarrito(usuarioId) {
  let carrito = await one("SELECT * FROM carrito WHERE usuario_id = $1", [usuarioId]);
  if (!carrito) {
    const usuario = await one("SELECT * FROM usuario WHERE id = $1", [usuarioId]);
    if (!usuario) throw new Error(`No existe el usuario con id ${usuarioId}`);
    await pool.query("INSERT INTO carrito (usuario_id) VALUES ($1)", [usuarioId]);
    carrito = await one("SELECT * FROM carrito WHERE usuario_id = $1", [usuarioId]);
  }
  return carrito;
}

const productoPorId = async (id) =>
  mapProducto(await one("SELECT * FROM producto WHERE id = $1", [id]));

export const resolvers = {
  Query: {
    pedidos: async () => (await many("SELECT * FROM pedido ORDER BY id DESC")).map(mapPedido),
    pedido: async (_padre, { id }) =>
      mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [id])),
    carrito: (_padre, { usuarioId }) => obtenerOcrearCarrito(usuarioId),
  },

  Pedido: {
    usuario: (padre) => one("SELECT * FROM usuario WHERE id = $1", [padre.usuarioId]),
    detalles: (padre) => many("SELECT * FROM detalle_pedido WHERE pedido_id = $1", [padre.id]),
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
    crearPedido: async (_padre, { data }) => {
      if (!data.items || data.items.length === 0) {
        throw new Error("El pedido necesita al menos un producto");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Valida stock de todos los renglones ANTES de escribir nada.
        const renglones = [];
        for (const { productoId, cantidad } of data.items) {
          const { rows } = await client.query("SELECT * FROM producto WHERE id = $1", [productoId]);
          const producto = rows[0];
          if (!producto) throw new Error(`No existe el producto con id ${productoId}`);
          if (producto.stock < cantidad) {
            throw new Error(`Stock insuficiente para "${producto.nombre}"`);
          }
          renglones.push({ producto, cantidad });
        }

        // TODO(B): con auth lista, usar context.user y exigir sesión.
        let { rows: usuarioRows } = await client.query(
          "SELECT * FROM usuario WHERE email = $1",
          [data.email]
        );
        let usuario = usuarioRows[0];
        if (!usuario) {
          const { rows } = await client.query(
            "INSERT INTO usuario (nombre, email, password, rol) VALUES ($1, $2, 'sin-password', 'CLIENTE') RETURNING *",
            [data.nombre, data.email]
          );
          usuario = rows[0];
        }

        const total = renglones.reduce((acc, r) => acc + r.cantidad * r.producto.precio, 0);

        const { rows: pedidoRows } = await client.query(
          "INSERT INTO pedido (total, usuario_id) VALUES ($1, $2) RETURNING *",
          [total, usuario.id]
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

        await client.query("COMMIT");
        return mapPedido(pedido);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    agregarAlCarrito: async (_padre, { usuarioId, productoId, cantidad }) => {
      const producto = await one("SELECT * FROM producto WHERE id = $1", [productoId]);
      if (!producto) throw new Error(`No existe el producto con id ${productoId}`);

      const carrito = await obtenerOcrearCarrito(usuarioId);
      await pool.query(
        `INSERT INTO detalle_carrito (carrito_id, producto_id, cantidad) VALUES ($1, $2, $3)
         ON CONFLICT (carrito_id, producto_id)
         DO UPDATE SET cantidad = detalle_carrito.cantidad + EXCLUDED.cantidad`,
        [carrito.id, productoId, cantidad]
      );
      return carrito;
    },

    cambiarCantidadCarrito: async (_padre, { usuarioId, productoId, cantidad }) => {
      const carrito = await obtenerOcrearCarrito(usuarioId);
      if (cantidad <= 0) {
        await pool.query(
          "DELETE FROM detalle_carrito WHERE carrito_id = $1 AND producto_id = $2",
          [carrito.id, productoId]
        );
      } else {
        await pool.query(
          `INSERT INTO detalle_carrito (carrito_id, producto_id, cantidad) VALUES ($1, $2, $3)
           ON CONFLICT (carrito_id, producto_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
          [carrito.id, productoId, cantidad]
        );
      }
      return carrito;
    },

    quitarDelCarrito: async (_padre, { usuarioId, productoId }) => {
      const carrito = await obtenerOcrearCarrito(usuarioId);
      await pool.query(
        "DELETE FROM detalle_carrito WHERE carrito_id = $1 AND producto_id = $2",
        [carrito.id, productoId]
      );
      return carrito;
    },

    vaciarCarritoDB: async (_padre, { usuarioId }) => {
      const carrito = await obtenerOcrearCarrito(usuarioId);
      await pool.query("DELETE FROM detalle_carrito WHERE carrito_id = $1", [carrito.id]);
      return carrito;
    },
  },
};
