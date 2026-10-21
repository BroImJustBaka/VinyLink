// Envío de correos de la tienda.
//
// Cada correo se guarda primero en la tabla `correo` (bandeja de salida) y
// después se entrega:
//   - con SMTP_HOST en back/.env → se manda de verdad con nodemailer
//     (sirve Gmail, Outlook, Mailtrap, Resend SMTP, etc.);
//   - sin SMTP_HOST → queda como "simulado": no sale a internet, pero se
//     puede leer completo en /admin/correos. Así se prueba sin spamear a nadie.
// Un error del servidor de correo nunca tumba la operación que lo pidió.
import nodemailer from "nodemailer";
import "dotenv/config";
import { one } from "../../lib/sql.js";

const limpiar = (v) => v?.trim() || null;
const host = limpiar(process.env.SMTP_HOST);
const puerto = Number(process.env.SMTP_PORT ?? 587);
const usuarioSmtp = limpiar(process.env.SMTP_USER);

const transporte = host
  ? nodemailer.createTransport({
      host,
      port: puerto,
      secure: puerto === 465, // 465 = SSL directo; 587 = STARTTLS
      auth: usuarioSmtp ? { user: usuarioSmtp, pass: process.env.SMTP_PASS ?? "" } : undefined,
    })
  : null;

const REMITENTE = limpiar(process.env.SMTP_FROM) ?? "VinyLink <no-responder@vinylink.mx>";

export const correoReal = Boolean(transporte);

// Entrega (o simula) un correo ya guardado en la bandeja.
async function entregar(id) {
  const correo = await one("SELECT * FROM correo WHERE id = $1", [id]);
  if (!correo) return;
  if (!transporte) {
    await one("UPDATE correo SET estado = 'simulado', enviado_en = NOW(), error = NULL WHERE id = $1 RETURNING id", [id]);
    console.log(`✉ (simulado) ${correo.para}: ${correo.asunto}`);
    return;
  }
  try {
    await transporte.sendMail({ from: REMITENTE, to: correo.para, subject: correo.asunto, html: correo.html });
    await one("UPDATE correo SET estado = 'enviado', enviado_en = NOW(), error = NULL WHERE id = $1 RETURNING id", [id]);
  } catch (err) {
    console.error(`No se pudo mandar el correo #${id} a ${correo.para}:`, err.message);
    await one("UPDATE correo SET estado = 'error', error = $2 WHERE id = $1 RETURNING id", [id, err.message.slice(0, 500)]);
  }
}

// Guarda el correo en la bandeja y lo entrega. Regresa el id del correo.
export async function enviarCorreo({ para, asunto, html, tipo, pedidoId = null, usuarioId = null }) {
  const fila = await one(
    `INSERT INTO correo (para, asunto, html, tipo, pedido_id, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [para, asunto, html, tipo, pedidoId, usuarioId]
  );
  await entregar(fila.id);
  return fila.id;
}

// Vuelve a intentar un correo (por ejemplo, uno que falló por el servidor SMTP).
export async function reenviarCorreo(id) {
  await one("UPDATE correo SET estado = 'pendiente' WHERE id = $1 RETURNING id", [id]);
  await entregar(id);
}
