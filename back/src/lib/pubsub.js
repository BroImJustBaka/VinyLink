// Canal de eventos para las subscriptions de GraphQL (tiempo real).
//
// Cuando algo cambia (un pedido, el stock, una acción del personal), el
// código llama a publicar*() y el servidor WebSocket se lo manda a quien esté
// suscrito. PubSub guarda los suscriptores en memoria: sirve con UN proceso
// del backend. Para varios procesos habría que cambiarlo por uno compartido
// (Redis o LISTEN/NOTIFY de PostgreSQL) sin tocar los resolvers.
import { PubSub } from "graphql-subscriptions";
import { one, mapPedido, mapProducto } from "./sql.js";

export const pubsub = new PubSub();

export const EVENTOS = {
  PEDIDO: "PEDIDO_ACTUALIZADO",
  STOCK: "STOCK_ACTUALIZADO",
  ADMIN: "EVENTO_ADMIN",
};

// Nunca deben tumbar la operación que los dispara: si falla, solo se registra.
const seguro = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    console.error("No se pudo publicar un evento en tiempo real:", err.message);
  }
};

// Se lee la fila fresca para mandar el estado ya confirmado.
export const publicarPedido = seguro(async (pedidoId) => {
  const pedido = mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [pedidoId]));
  if (pedido) await pubsub.publish(EVENTOS.PEDIDO, { pedidoActualizado: pedido });
});

export const publicarStock = seguro(async (productoId) => {
  const producto = mapProducto(await one("SELECT * FROM producto WHERE id = $1", [productoId]));
  if (producto) await pubsub.publish(EVENTOS.STOCK, { stockActualizado: producto });
});

// Aviso para el panel. tipo: pedido_nuevo, pago_recibido, pedido_cancelado,
// stock_bajo, accion (lo que hace otra persona del personal)...
export const publicarEventoAdmin = seguro(async ({ tipo, mensaje, pedidoId = null, productoId = null, usuarioId = null }) => {
  await pubsub.publish(EVENTOS.ADMIN, {
    eventosAdmin: {
      tipo,
      mensaje,
      pedidoId: pedidoId == null ? null : String(pedidoId),
      productoId: productoId == null ? null : String(productoId),
      usuarioId: usuarioId == null ? null : String(usuarioId),
      fecha: new Date().toISOString(),
    },
  });
});
