// Plantillas HTML de los correos. Estilos en línea (los clientes de correo
// ignoran las hojas de estilo) y todo texto que venga de la base se escapa
// con esc(), para que un nombre como "<script>" no se convierta en HTML.
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const dinero = (n) => Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function marco(config, titulo, cuerpo) {
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4efe6;font-family:Arial,Helvetica,sans-serif;color:#242321">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <p style="font-size:22px;font-weight:bold;margin:0 0 16px;color:#59604a">${esc(config.nombreTienda)}</p>
    <div style="background:#fffdf8;border-radius:8px;padding:24px;border:1px solid #e5dccb">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(titulo)}</h1>
      ${cuerpo}
    </div>
    <p style="font-size:12px;color:#765640;margin-top:16px">
      ¿Dudas? Escríbenos a <a href="mailto:${esc(config.emailContacto)}">${esc(config.emailContacto)}</a>.
    </p>
  </div>
</body></html>`;
}

const boton = (url, texto) =>
  `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#59604a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(texto)}</a></p>`;

function tablaProductos(pedido, detalles) {
  const filas = detalles
    .map(
      (d) => `<tr>
        <td style="padding:4px 0">${d.cantidad} × ${esc(d.nombre)}</td>
        <td style="padding:4px 0;text-align:right">${dinero(d.cantidad * d.precio_unitario)}</td>
      </tr>`
    )
    .join("");
  const extra = [
    pedido.descuento > 0 ? ["Descuento", `-${dinero(pedido.descuento)}`] : null,
    ["Envío", pedido.costo_envio > 0 ? dinero(pedido.costo_envio) : "Gratis"],
  ]
    .filter(Boolean)
    .map(([a, b]) => `<tr><td style="padding:4px 0;color:#765640">${a}</td><td style="padding:4px 0;text-align:right;color:#765640">${b}</td></tr>`)
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">
    ${filas}${extra}
    <tr><td style="padding:8px 0;border-top:1px solid #e5dccb"><strong>Total</strong></td>
        <td style="padding:8px 0;border-top:1px solid #e5dccb;text-align:right"><strong>${dinero(pedido.total)}</strong></td></tr>
  </table>`;
}

function direccion(envio) {
  if (!envio) return "";
  return `<p style="font-size:14px;line-height:1.5;margin:12px 0">
    <strong>Se envía a:</strong><br>
    ${esc(envio.nombre)} · ${esc(envio.telefono)}<br>
    ${esc(envio.calle)}, ${esc(envio.colonia)}<br>
    ${esc(envio.ciudad)}, ${esc(envio.estado)}, C.P. ${esc(envio.cp)}
  </p>`;
}

// evento: creado | pagado | enviado | entregado | cancelado | reembolsado | reembolso_parcial
export function plantillaPedido(evento, { pedido, usuario, detalles, config, url, extra = {} }) {
  const n = `#${pedido.id}`;
  const hola = `<p>Hola ${esc(usuario.nombre)},</p>`;
  const productos = tablaProductos(pedido, detalles);
  const ver = boton(url, "Ver mi pedido");

  const casos = {
    creado: [
      `Tu pedido ${n} está esperando el pago`,
      `${hola}<p>Recibimos tu pedido. Apartamos tus productos mientras haces el pago; en la página del pedido están la ficha, la CLABE o el link para pagar.</p>${ver}${productos}`,
    ],
    pagado: [
      `¡Recibimos tu pago! Pedido ${n}`,
      `${hola}<p>Tu pago se confirmó. Ya estamos preparando tu pedido y te avisaremos cuando salga.</p>${productos}${direccion(pedido.envio)}${ver}`,
    ],
    enviado: [
      `Tu pedido ${n} va en camino`,
      `${hola}<p>Tu pedido salió de nuestro almacén.</p>
       ${pedido.paqueteria ? `<p><strong>Paquetería:</strong> ${esc(pedido.paqueteria)}<br><strong>Número de guía:</strong> ${esc(pedido.numero_guia ?? "—")}</p>` : ""}
       ${direccion(pedido.envio)}${ver}`,
    ],
    entregado: [
      `Tu pedido ${n} fue entregado`,
      `${hola}<p>Tu pedido aparece como entregado. ¡Gracias por comprar en ${esc(config.nombreTienda)}! Esperamos que lo disfrutes.</p>${ver}`,
    ],
    cancelado: [
      `Tu pedido ${n} se canceló`,
      `${hola}<p>Tu pedido se canceló${extra.motivo ? `: ${esc(extra.motivo)}` : "."} No se hizo ningún cargo; si quieres los productos, puedes volver a comprarlos.</p>${ver}`,
    ],
    reembolsado: [
      `Reembolsamos tu pedido ${n}`,
      `${hola}<p>Hicimos el reembolso de <strong>${dinero(extra.monto ?? pedido.total)}</strong>. Según tu banco, puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.</p>${ver}`,
    ],
    reembolso_parcial: [
      `Reembolso parcial de tu pedido ${n}`,
      `${hola}<p>Te reembolsamos <strong>${dinero(extra.monto)}</strong> de tu pedido${extra.motivo ? ` (${esc(extra.motivo)})` : ""}. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.</p>${ver}`,
    ],
  };
  const [asunto, cuerpo] = casos[evento] ?? casos.creado;
  return { asunto, html: marco(config, asunto, cuerpo) };
}

export function plantillaRestablecer({ usuario, url, config }) {
  const asunto = "Restablece tu contraseña";
  const cuerpo = `<p>Hola ${esc(usuario.nombre)},</p>
    <p>Alguien (esperamos que tú) pidió cambiar la contraseña de tu cuenta. El enlace sirve una sola vez y vence en 1 hora.</p>
    ${boton(url, "Elegir una contraseña nueva")}
    <p style="font-size:13px;color:#765640">Si no fuiste tú, ignora este correo: tu contraseña sigue igual.</p>`;
  return { asunto, html: marco(config, asunto, cuerpo) };
}
