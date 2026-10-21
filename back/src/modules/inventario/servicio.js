// Kárdex del inventario. moverStock() es el ÚNICO lugar donde cambia el
// stock de un producto: actualiza la columna, deja el renglón en
// `movimiento_inventario` y, cuando la transacción se confirma, avisa por
// tiempo real (stock nuevo y, si cruzó su mínimo, alerta de stock bajo).
import { alConfirmar } from "../../lib/sql.js";
import { publicarStock, publicarEventoAdmin } from "../../lib/pubsub.js";

export const TIPOS = ["inicial", "entrada", "ajuste", "venta", "cancelacion", "reembolso"];

// cantidad > 0 entra, < 0 sale. `client` es el de la transacción en curso
// (o el pool). Si el stock quedaría negativo, PostgreSQL lo rechaza con el
// CHECK de la tabla y aquí se convierte en un mensaje claro.
export async function moverStock(
  client,
  { productoId, cantidad, tipo, pedidoId = null, proveedorId = null, costoUnitario = null, usuarioId = null, motivo = null }
) {
  if (!TIPOS.includes(tipo)) throw new Error(`Tipo de movimiento inválido: ${tipo}`);
  let producto;
  try {
    const { rows } = await client.query(
      `UPDATE producto SET stock = stock + $2 WHERE id = $1
       RETURNING id, nombre, stock, stock_minimo`,
      [productoId, cantidad]
    );
    producto = rows[0];
  } catch (err) {
    if (err.code === "23514") throw new Error("El stock no puede quedar negativo");
    throw err;
  }
  if (!producto) throw new Error(`No existe el producto con id ${productoId}`);

  const { rows } = await client.query(
    `INSERT INTO movimiento_inventario
       (producto_id, tipo, cantidad, stock_resultante, pedido_id, proveedor_id, costo_unitario, usuario_id, motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [producto.id, tipo, cantidad, producto.stock, pedidoId, proveedorId, costoUnitario, usuarioId, motivo]
  );

  const antes = producto.stock - cantidad;
  alConfirmar(client, async () => {
    await publicarStock(producto.id);
    // Solo se avisa al CRUZAR el mínimo, no en cada venta debajo de él.
    if (cantidad < 0 && antes > producto.stock_minimo && producto.stock <= producto.stock_minimo) {
      await publicarEventoAdmin({
        tipo: "stock_bajo",
        mensaje:
          producto.stock === 0
            ? `Se agotó "${producto.nombre}"`
            : `Quedan ${producto.stock} piezas de "${producto.nombre}"`,
        productoId: producto.id,
      });
    }
  });
  return rows[0];
}

// Regresa al inventario las piezas de un pedido (cancelación o reembolso).
export async function devolverPiezasDePedido(client, pedidoId, tipo, usuarioId = null) {
  const { rows } = await client.query(
    "SELECT producto_id, SUM(cantidad)::int AS cantidad FROM detalle_pedido WHERE pedido_id = $1 GROUP BY producto_id ORDER BY producto_id",
    [pedidoId]
  );
  for (const r of rows) {
    await moverStock(client, {
      productoId: r.producto_id,
      cantidad: r.cantidad,
      tipo,
      pedidoId,
      usuarioId,
      motivo: tipo === "reembolso" ? `Reembolso del pedido #${pedidoId}` : `Pedido #${pedidoId} cancelado`,
    });
  }
}
