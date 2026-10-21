// Dueño: Persona C (auth)
//
// Contraseñas con bcrypt; login y registrar crean una sesión y regresan el
// token (el frontend lo guarda en la cookie httpOnly `sid`).
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { one, transaccion } from "../../lib/sql.js";
import {
  crearSesion,
  cerrarSesion,
  cerrarSesionesDe,
  requireUser,
  hashToken,
} from "./context.js";
import { permisosDe, esPersonal, ROLES, PERMISOS } from "./permisos.js";
import { leerConfiguracion } from "../configuracion/servicio.js";
import { notificarRestablecer } from "../notificaciones/servicio.js";

const SALT_ROUNDS = 10;
const MINUTOS_RESTABLECER = 60;

const publico = ({ id, nombre, email, rol }) => ({ id, nombre, email, rol });

function validarPassword(password) {
  if (password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");
  if (password.length > 72) throw new Error("La contraseña puede tener máximo 72 caracteres"); // límite de bcrypt
}

export const resolvers = {
  Query: {
    me: (_padre, _args, context) => context.user ?? null,
    permisosPorRol: (_padre, _args, context) => {
      if (!esPersonal(requireUser(context))) throw new Error("Solo un administrador puede hacer esto");
      return ROLES.map((rol) => ({ rol, permisos: permisosDe(rol) }));
    },
    permisos: (_padre, _args, context) => {
      if (!esPersonal(requireUser(context))) throw new Error("Solo un administrador puede hacer esto");
      return Object.entries(PERMISOS).map(([clave, descripcion]) => ({ clave, descripcion }));
    },
  },

  // context.user solo trae { id, nombre, email, rol }; lo demás se lee si se pide.
  Usuario: {
    permisos: (padre) => permisosDe(padre.rol),
    activo: async (padre) =>
      padre.activo ?? (await one("SELECT activo FROM usuario WHERE id = $1", [padre.id]))?.activo ?? true,
    telefono: async (padre) =>
      padre.telefono !== undefined
        ? padre.telefono
        : (await one("SELECT telefono FROM usuario WHERE id = $1", [padre.id]))?.telefono ?? null,
  },

  Mutation: {
    login: async (_padre, { email, password }) => {
      const usuario = await one("SELECT * FROM usuario WHERE lower(email) = $1", [
        email.trim().toLowerCase(),
      ]);
      if (!usuario) throw new Error("Email o contraseña incorrectos");

      let ok;
      if (usuario.password.startsWith("$2")) {
        ok = await bcrypt.compare(password, usuario.password);
      } else {
        // Cuenta creada antes de bcrypt (texto plano): si coincide, se rehashea
        // en este momento. 'sin-password' marcaba cuentas sin contraseña real.
        ok = usuario.password !== "sin-password" && usuario.password === password;
        if (ok) {
          await one("UPDATE usuario SET password = $1 WHERE id = $2 RETURNING id", [
            await bcrypt.hash(password, SALT_ROUNDS),
            usuario.id,
          ]);
        }
      }
      if (!ok) throw new Error("Email o contraseña incorrectos");
      // Se revisa DESPUÉS de la contraseña: así no se revela si una cuenta
      // existe y está bloqueada a quien no conoce la contraseña.
      if (!usuario.activo) {
        const { emailContacto } = await leerConfiguracion();
        throw new Error(`Tu cuenta está bloqueada. Escríbenos a ${emailContacto} si crees que es un error.`);
      }

      const token = await crearSesion(usuario.id);
      return { ...publico(usuario), token };
    },

    registrar: async (_padre, { nombre, email, password }) => {
      nombre = nombre.trim();
      email = email.trim().toLowerCase();
      if (!nombre) throw new Error("Escribe tu nombre");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("El email no es válido");
      validarPassword(password);

      const existente = await one("SELECT id FROM usuario WHERE lower(email) = $1", [email]);
      if (existente) throw new Error("Ya existe una cuenta con ese email");

      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const usuario = await one(
        "INSERT INTO usuario (nombre, email, password, rol) VALUES ($1, $2, $3, 'CLIENTE') RETURNING *",
        [nombre, email, hash]
      );

      const token = await crearSesion(usuario.id);
      return { ...publico(usuario), token };
    },

    logout: async (_padre, _args, context) => {
      requireUser(context);
      await cerrarSesion(context.token);
      return true;
    },

    solicitarRestablecimiento: async (_padre, { email }) => {
      const usuario = await one("SELECT id, nombre, email, activo FROM usuario WHERE lower(email) = $1", [
        email.trim().toLowerCase(),
      ]);
      if (usuario?.activo) await crearYMandarRestablecimiento(usuario);
      return true;
    },

    restablecerPassword: async (_padre, { token, password }) => {
      validarPassword(password);
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const usuarioId = await transaccion(async (client) => {
        // FOR UPDATE + usado_en: el mismo link no sirve dos veces aunque se mande dos veces seguidas.
        const { rows } = await client.query(
          `SELECT r.usuario_id FROM restablecimiento r JOIN usuario u ON u.id = r.usuario_id
            WHERE r.token_hash = $1 AND r.usado_en IS NULL AND r.expira_en > NOW() AND u.activo
            FOR UPDATE OF r`,
          [hashToken(String(token))]
        );
        if (!rows[0]) throw new Error("El link para cambiar la contraseña no es válido o ya venció. Pide uno nuevo.");
        await client.query("UPDATE restablecimiento SET usado_en = NOW() WHERE token_hash = $1", [hashToken(String(token))]);
        await client.query("UPDATE usuario SET password = $2 WHERE id = $1", [rows[0].usuario_id, hash]);
        return rows[0].usuario_id;
      });
      // Si alguien más tenía la sesión abierta, se le cierra.
      await cerrarSesionesDe(usuarioId);
      return true;
    },

    actualizarMiPerfil: async (_padre, { nombre, telefono }, context) => {
      const user = requireUser(context);
      nombre = nombre.trim();
      const tel = telefono ? String(telefono).replace(/\D/g, "") : null;
      if (nombre.length < 2 || nombre.length > 80) throw new Error("Tu nombre debe tener de 2 a 80 caracteres");
      if (tel && !/^\d{10}$/.test(tel)) throw new Error("El teléfono debe tener 10 dígitos");
      return one("UPDATE usuario SET nombre = $2, telefono = $3 WHERE id = $1 RETURNING *", [user.id, nombre, tel]);
    },

    cambiarMiPassword: async (_padre, { actual, nueva }, context) => {
      const user = requireUser(context);
      validarPassword(nueva);
      const fila = await one("SELECT password FROM usuario WHERE id = $1", [user.id]);
      if (!fila.password.startsWith("$2") || !(await bcrypt.compare(actual, fila.password))) {
        throw new Error("Tu contraseña actual no es correcta");
      }
      await one("UPDATE usuario SET password = $2 WHERE id = $1 RETURNING id", [user.id, await bcrypt.hash(nueva, SALT_ROUNDS)]);
      // Cierra las demás sesiones, pero no la actual.
      await one(
        "DELETE FROM sesion WHERE usuario_id = $1 AND token_hash <> $2 RETURNING usuario_id",
        [user.id, hashToken(context.token ?? "")]
      );
      return true;
    },
  },
};

// Crea un token de un solo uso (se guarda su SHA-256, como las sesiones) y
// manda el correo. También lo usa el panel ("mandar link al cliente").
export async function crearYMandarRestablecimiento(usuario) {
  const token = randomBytes(32).toString("hex");
  await one(
    `INSERT INTO restablecimiento (token_hash, usuario_id, expira_en)
     VALUES ($1, $2, NOW() + make_interval(mins => $3)) RETURNING token_hash`,
    [hashToken(token), usuario.id, MINUTOS_RESTABLECER]
  );
  await notificarRestablecer(usuario, token);
  return token;
}
