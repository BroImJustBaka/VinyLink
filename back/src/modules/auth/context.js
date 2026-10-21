// Dueño: Persona C (auth)
//
// CONTRATO (no cambiar la forma sin avisar a A y B):
//   - El frontend manda la sesión como header `Authorization: Bearer <token>`.
//   - Cada resolver recibe `context.user = { id, nombre, email, rol } | null`.
//   - requireUser(context) / requireAdmin(context) lanzan error si no aplica.
//   - requirePermiso(context, "catalogo") para lo que puede hacer el
//     personal según su rol (ver ./permisos.js).
//   - Las sesiones viven en la tabla `sesion`; se guarda el SHA-256 del token.
import { randomBytes, createHash } from "node:crypto";
import { one } from "../../lib/sql.js";
import { tienePermiso, esPersonal } from "./permisos.js";

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
  // Atajo de desarrollo: AUTH_USUARIO_FALSO=<id> en back/.env hace que todas
  // las peticiones sean de ese usuario. No usarlo en producción.
  if (process.env.AUTH_USUARIO_FALSO) {
    return one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1 AND activo", [
      process.env.AUTH_USUARIO_FALSO,
    ]);
  }

  return usuarioDeToken(getTokenFromRequest(req));
}

// Usuario dueño de un token de sesión (también lo usa el WebSocket).
// Una cuenta bloqueada (activo = false) se trata como sin sesión.
export async function usuarioDeToken(token) {
  if (!token) return null;
  return one(
    `SELECT u.id, u.nombre, u.email, u.rol
       FROM sesion s
       JOIN usuario u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_en > now() AND u.activo`,
    [hashToken(token)]
  );
}

// Cierra todas las sesiones de un usuario (al bloquearlo o cambiar su contraseña).
export async function cerrarSesionesDe(usuarioId) {
  await one("DELETE FROM sesion WHERE usuario_id = $1 RETURNING usuario_id", [usuarioId]);
}

export { hashToken };

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

// Exige un permiso del panel. Basta con tener UNO de los que se pasan:
//   requirePermiso(context, "clientes", "links")
// Un cliente recibe el mismo mensaje que antes ("Solo un administrador...");
// alguien del personal sin ese permiso, uno que nombra su rol.
export function requirePermiso(context, ...permisos) {
  const user = requireUser(context);
  if (permisos.some((p) => tienePermiso(user, p))) return user;
  if (!esPersonal(user)) throw new Error("Solo un administrador puede hacer esto");
  throw new Error(`Tu rol (${user.rol}) no tiene permiso para hacer esto`);
}
