// Dueño: Persona C (auth)
export const typeDefs = `#graphql
  "Rol de un usuario dentro de la tienda"
  enum Rol {
    CLIENTE
    ADMIN
  }

  "Usuario de la tienda (cliente o administrador)."
  type Usuario {
    id: ID!
    nombre: String!
    email: String!
    rol: Rol!
    "Token de sesión. Solo viene en la respuesta de login y registrar."
    token: String
  }

  extend type Query {
    "Usuario de la sesión actual (null si no hay sesión)."
    me: Usuario
  }

  extend type Mutation {
    "Valida email+password (bcrypt), crea una sesión y regresa el usuario con su token."
    login(email: String!, password: String!): Usuario!
    "Crea un usuario nuevo (rol CLIENTE), inicia su sesión y lo regresa con su token."
    registrar(nombre: String!, email: String!, password: String!): Usuario!
    "Cierra la sesión actual (borra el token en la base de datos)."
    logout: Boolean!
  }
`;
