// // Dueño: Persona C (auth)
// //
// // TODO(C): hashear contraseñas (bcrypt/argon2), crear sesión y regresar el
// // token de sesión junto con el usuario, agregar `me` y `logout`.
// import { one } from "../../lib/sql.js";
// import bcrypt from "bcryptjs"

// export const resolvers = {
//   Mutation: {
//     login: async (_padre, { email, password }) => {
//       const usuario = await one("SELECT * FROM usuario WHERE email = $1", [email]);
//       // Password en texto plano por ahora (ver TODO arriba).
//       if (!usuario || !bcrypt.compareSync(password, usuario.password)) {
//         throw new Error("Email o contraseña incorrectos");
//       }
//       return usuario;
//     },

//     registrar: async (_padre, { nombre, email, password }) => {
//       const existente = await one("SELECT * FROM usuario WHERE email = $1", [email]);
//       if (existente) throw new Error("Ya existe una cuenta con ese email");
//       const PWHash = bcrypt.hashSync(password, SALT_ROUNDS);
//       return one(
//         "INSERT INTO usuario (nombre, email, password, rol) VALUES ($1, $2, $3, 'CLIENTE') RETURNING *",
//         [nombre, email, PWHash]
//       );
//     },
//   },
// };
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
      const usuario = await one("SELECT * FROM usuario WHERE email = $1", [email]);
      const ok = usuario && (await bcrypt.compare(password, usuario.password));
      if (!ok) throw new Error("Email o contraseña incorrectos");

      const token = await crearSesion(usuario.id);
      return { ...publico(usuario), token };
    },

    registrar: async (_padre, { nombre, email, password }) => {
      const existente = await one("SELECT id FROM usuario WHERE email = $1", [email]);
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