// Dueño: Persona C (auth)
//
// CONTRATO (no cambiar la forma sin avisar a A y B):
//   - El frontend manda la sesión como header `Authorization: Bearer <token>`.
//   - Cada resolver recibe `context.user = { id, nombre, email, rol } | null`.
//   - requireUser(context) / requireAdmin(context) lanzan error si no aplica.
import { one } from "../../lib/sql.js";

export async function getUserFromRequest(req) {
  // Atajo de desarrollo para que B pruebe pedidos antes de que auth exista:
  // AUTH_USUARIO_FALSO=1 en back/.env → todas las peticiones son del usuario 1.
  if (process.env.AUTH_USUARIO_FALSO) {
    return one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1", [
      process.env.AUTH_USUARIO_FALSO,
    ]);
  }

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  // TODO(C): buscar el token en la tabla de sesiones y regresar su usuario.
  return null;
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
