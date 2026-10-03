// Dueño: Persona C (auth)
//
// Contraseñas con bcrypt; login y registrar crean una sesión y regresan el
// token (el frontend lo guarda en la cookie httpOnly `sid`).
import bcrypt from "bcryptjs";
import { one } from "../../lib/sql.js";
import { crearSesion, cerrarSesion, requireUser } from "./context.js";

const SALT_ROUNDS = 10;

const publico = ({ id, nombre, email, rol }) => ({ id, nombre, email, rol });

export const resolvers = {
  Query: {
    me: (_padre, _args, context) => context.user ?? null,
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

      const token = await crearSesion(usuario.id);
      return { ...publico(usuario), token };
    },

    registrar: async (_padre, { nombre, email, password }) => {
      nombre = nombre.trim();
      email = email.trim().toLowerCase();
      if (!nombre) throw new Error("Escribe tu nombre");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("El email no es válido");
      if (password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");

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
  },
};
