// Dueño: Persona B (carrito y pedidos)
//
// Inventario de los pedidos. Lo usan los pagos (al crear un pedido se aparta
// el stock) y la cancelación o el reembolso (se devuelve).
import { pool } from "../../db.js";
import { transaccion } from "../../lib/sql.js";

export const ES_ID = /^\d+$/;

// Precio en centavos (entero). Stripe cobra en centavos y así las sumas no
// arrastran errores de punto flotante (0.1 + 0.2 = 0.30000000000000004).
export const aCentavos = (pesos) => Math.round(Number(pesos) * 100);

export function validarCantidad(cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error("La cantidad debe ser un entero mayor a 0");
  }
}

// Junta renglones repetidos del mismo producto (suma sus cantidades).
export function agruparItems(items) {
  const mapa = new Map();
  for (const { productoId, cantidad } of items) {
    validarCantidad(cantidad);
    const clave = String(productoId);
    mapa.set(clave, (mapa.get(clave) ?? 0) + cantidad);
  }
  return [...mapa].map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

// Crea un pedido "pendiente" con su renglón en la tabla `pago` y aparta el
// stock, todo en una transacción. `validarTotal(totalCentavos)` deja que el
// método de pago rechace montos que no acepta (por ejemplo, OXXO > $10,000).
export async function crearPedidoPendiente({ usuarioId, items, metodo, validarTotal }) {
  if (!items || items.length === 0) {
    throw new Error("El pedido necesita al menos un producto");
  }
  const agrupados = agruparItems(items);

  return transaccion(async (client) => {
    // Bloquea los productos (en orden de id, para evitar interbloqueos) y
    // valida el stock de todos los renglones ANTES de escribir nada.
    const renglones = [];
    const ordenados = [...agrupados].sort((a, b) => Number(a.productoId) - Number(b.productoId));
    for (const { productoId, cantidad } of ordenados) {
      if (!ES_ID.test(String(productoId))) {
        throw new Error(`No existe el producto con id ${productoId}`);
      }
      const { rows } = await client.query("SELECT * FROM producto WHERE id = $1 FOR UPDATE", [
        productoId,
      ]);
      const producto = rows[0];
      if (!producto) throw new Error(`No existe el producto con id ${productoId}`);
      if (producto.stock < cantidad) {
        throw new Error(`Stock insuficiente para "${producto.nombre}"`);
      }
      renglones.push({ producto, cantidad, centavos: aCentavos(producto.precio) });
    }

    const totalCentavos = renglones.reduce((acc, r) => acc + r.centavos * r.cantidad, 0);
    validarTotal?.(totalCentavos);

    const { rows: pedidoRows } = await client.query(
      `INSERT INTO pedido (total, usuario_id, estado, metodo_pago)
       VALUES ($1, $2, 'pendiente', $3) RETURNING *`,
      [totalCentavos / 100, usuarioId, metodo]
    );
    const pedido = pedidoRows[0];

    for (const { producto, cantidad, centavos } of renglones) {
      await client.query(
        `INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [pedido.id, producto.id, cantidad, centavos / 100]
      );
      await client.query("UPDATE producto SET stock = stock - $1 WHERE id = $2", [
        cantidad,
        producto.id,
      ]);
    }

    await client.query(
      "INSERT INTO pago (pedido_id, metodo, monto_centavos) VALUES ($1, $2, $3)",
      [pedido.id, metodo, totalCentavos]
    );

    return { pedido, renglones, totalCentavos };
  });
}

// Regresa al inventario las piezas de un pedido. Recibe el `client` de una
// transacción para que se haga junto con el cambio de estado del pedido.
export async function devolverStock(client, pedidoId) {
  await client.query(
    `UPDATE producto p SET stock = p.stock + d.cantidad
       FROM detalle_pedido d
      WHERE d.pedido_id = $1 AND d.producto_id = p.id`,
    [pedidoId]
  );
}

// Vuelve a apartar el stock de un pedido que se había cancelado y que al final
// sí se pagó (por ejemplo, una ficha OXXO pagada a última hora). Si ya no
// alcanza para algún producto no toca nada y regresa false.
export async function volverAApartarStock(client, pedidoId) {
  const { rows } = await client.query(
    `SELECT p.id, p.stock, d.cantidad
       FROM detalle_pedido d JOIN producto p ON p.id = d.producto_id
      WHERE d.pedido_id = $1
      ORDER BY p.id
        FOR UPDATE OF p`,
    [pedidoId]
  );
  if (rows.some((r) => r.stock < r.cantidad)) return false;
  for (const r of rows) {
    await client.query("UPDATE producto SET stock = stock - $1 WHERE id = $2", [r.cantidad, r.id]);
  }
  return true;
}

// Vacía el carrito guardado en la base de datos (el pedido ya lo "consumió").
export async function vaciarCarrito(usuarioId, client = pool) {
  await client.query(
    "DELETE FROM detalle_carrito WHERE carrito_id IN (SELECT id FROM carrito WHERE usuario_id = $1)",
    [usuarioId]
  );
}
