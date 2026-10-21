// Avisos por correo de los pedidos. notificarPedido() junta los datos, arma
// la plantilla y la manda. Nunca lanza errores: un correo que no sale no
// debe deshacer un pago ni un cambio de estado.
import { one, many } from "../../lib/sql.js";
import { leerConfiguracion } from "../configuracion/servicio.js";
import { WEB_URL } from "../pagos/stripe.js";
import { enviarCorreo } from "./correo.js";
import { plantillaPedido, plantillaRestablecer } from "./plantillas.js";

export async function notificarPedido(pedidoId, evento, extra = {}) {
  try {
    const pedido = await one("SELECT * FROM pedido WHERE id = $1", [pedidoId]);
    if (!pedido) return;
    const usuario = await one("SELECT id, nombre, email FROM usuario WHERE id = $1", [pedido.usuario_id]);
    const detalles = await many(
      `SELECT d.cantidad, d.precio_unitario, p.nombre
         FROM detalle_pedido d JOIN producto p ON p.id = d.producto_id
        WHERE d.pedido_id = $1 ORDER BY d.id`,
      [pedidoId]
    );
    const config = await leerConfiguracion();
    const { asunto, html } = plantillaPedido(evento, {
      pedido,
      usuario,
      detalles,
      config,
      url: `${WEB_URL}/pedido/${pedidoId}`,
      extra,
    });
    await enviarCorreo({ para: usuario.email, asunto, html, tipo: `pedido.${evento}`, pedidoId, usuarioId: usuario.id });
  } catch (err) {
    console.error(`No se pudo avisar por correo del pedido #${pedidoId} (${evento}):`, err.message);
  }
}

export async function notificarRestablecer(usuario, token) {
  const config = await leerConfiguracion();
  const url = `${WEB_URL}/restablecer?token=${encodeURIComponent(token)}`;
  const { asunto, html } = plantillaRestablecer({ usuario, url, config });
  return enviarCorreo({ para: usuario.email, asunto, html, tipo: "cuenta.restablecer", usuarioId: usuario.id });
}
