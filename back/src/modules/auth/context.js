// // Dueño: Persona C (auth)
// //
// // CONTRATO (no cambiar la forma sin avisar a A y B):
// //   - El frontend manda la sesión como header `Authorization: Bearer <token>`.
// //   - Cada resolver recibe `context.user = { id, nombre, email, rol } | null`.
// //   - requireUser(context) / requireAdmin(context) lanzan error si no aplica.
// import { one } from "../../lib/sql.js";

// export async function getUserFromRequest(req) {
//   // Atajo de desarrollo para que B pruebe pedidos antes de que auth exista:
//   // AUTH_USUARIO_FALSO=1 en back/.env → todas las peticiones son del usuario 1.
//   if (process.env.AUTH_USUARIO_FALSO) {
//     return one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1", [
//       process.env.AUTH_USUARIO_FALSO,
//     ]);
//   }

//   const header = req.headers.authorization ?? "";
//   const token = header.startsWith("Bearer ") ? header.slice(7) : null;
//   if (!token) return null;

//   // TODO(C): buscar el token en la tabla de sesiones y regresar su usuario.
//   return null;
// }

// export function requireUser(context) {
//   if (!context.user) throw new Error("Necesitas iniciar sesión");
//   return context.user;
// }

// export function requireAdmin(context) {
//   const user = requireUser(context);
//   if (user.rol !== "ADMIN") throw new Error("Solo un administrador puede hacer esto");
//   return user;
// }
import { randomBytes, createHash } from "node:crypto";
import { one } from "../../lib/sql.js";

const DURACION_DIAS = 7;

const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");

// Se llama desde login/registrar. Devuelve el token en claro (solo se ve esta vez).
export async function crearSesion(usuarioId) {
  const token = randomBytes(32).toString("hex");
  await one(
    `INSERT INTO sesion (token_hash, usuario_id, expira_en)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)
     RETURNING token_hash`,
    [hashToken(token), usuarioId, String(DURACION_DIAS)]
  );
  return token;
}

// Para una mutación logout.
export async function cerrarSesion(token) {
  await one("DELETE FROM sesion WHERE token_hash = $1 RETURNING token_hash", [
    hashToken(token),
  ]);
}

export async function getUserFromRequest(req) {
  if (process.env.AUTH_USUARIO_FALSO) {
    return one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1", [
      process.env.AUTH_USUARIO_FALSO,
    ]);
  }

   const token = getTokenFromRequest(req);
  if (!token) return null;

  return one(
    `SELECT u.id, u.nombre, u.email, u.rol
       FROM sesion s
       JOIN usuario u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_en > now()`,
    [hashToken(token)]
  );
}
export function getTokenFromRequest(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}
export function requireUser(context) {
  if (!context.user) throw new Error("Necesitas iniciar sesión");
  return context.user;
}

export function requireAdmin(context) {
  const user = requireUser(context);
  if (user.rol !== "ADMIN") throw new Error("Solo un administrador puede hacer esto");
  return user;
}