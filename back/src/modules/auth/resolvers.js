// Dueño: Persona C (auth)
//
// TODO(C): hashear contraseñas (bcrypt/argon2), crear sesión y regresar el
// token de sesión junto con el usuario, agregar `me` y `logout`.
import { one } from "../../lib/sql.js";

export const resolvers = {
  Mutation: {
    login: async (_padre, { email, password }) => {
      const usuario = await one("SELECT * FROM usuario WHERE email = $1", [email]);
      // Password en texto plano por ahora (ver TODO arriba).
      if (!usuario || usuario.password !== password) {
        throw new Error("Email o contraseña incorrectos");
      }
      return usuario;
    },

    registrar: async (_padre, { nombre, email, password }) => {
      const existente = await one("SELECT * FROM usuario WHERE email = $1", [email]);
      if (existente) throw new Error("Ya existe una cuenta con ese email");
      return one(
        "INSERT INTO usuario (nombre, email, password, rol) VALUES ($1, $2, $3, 'CLIENTE') RETURNING *",
        [nombre, email, password]
      );
    },
  },
};
