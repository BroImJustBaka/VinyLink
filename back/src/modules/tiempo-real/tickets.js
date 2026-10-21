// Tickets para abrir el WebSocket de las subscriptions.
//
// Problema: la sesión vive en una cookie httpOnly (el JavaScript del
// navegador NO la puede leer, a propósito) y el navegador se conecta al
// WebSocket del backend directamente, sin pasar por el proxy de Astro.
//
// Solución: el navegador pide un ticket con la mutación ticketTiempoReal
// (esa sí pasa por /api/graphql, que agrega la cookie). El ticket:
//   - es aleatorio (32 bytes) y solo sirve UNA vez,
//   - vence en 60 segundos,
//   - se canjea al conectar el WebSocket (connectionParams.ticket).
// Así la sesión nunca queda expuesta al JavaScript de la página.
import { randomBytes } from "node:crypto";
import { one } from "../../lib/sql.js";

const VIGENCIA_MS = 60 * 1000;
const tickets = new Map(); // ticket → { usuarioId, expira }

export function crearTicket(usuarioId) {
  const ticket = randomBytes(32).toString("hex");
  tickets.set(ticket, { usuarioId, expira: Date.now() + VIGENCIA_MS });
  return ticket;
}

// Canjea el ticket (lo borra) y regresa el usuario, o null si no es válido.
export async function canjearTicket(ticket) {
  if (typeof ticket !== "string") return null;
  const datos = tickets.get(ticket);
  tickets.delete(ticket);
  if (!datos || datos.expira < Date.now()) return null;
  // Se lee de la base: si lo bloquearon en ese minuto, ya no entra.
  return one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1 AND activo", [datos.usuarioId]);
}

// Limpieza de tickets que nadie usó.
setInterval(() => {
  const ahora = Date.now();
  for (const [t, d] of tickets) if (d.expira < ahora) tickets.delete(t);
}, VIGENCIA_MS).unref();
