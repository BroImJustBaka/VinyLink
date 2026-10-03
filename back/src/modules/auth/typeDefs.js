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
    token: String
  }
    extend type Query {  
me: Usuario
    }


  extend type Mutation {
    "Valida email+password contra la tabla usuario y regresa el usuario si coinciden."
    login(email: String!, password: String!): Usuario!
    "Crea un usuario nuevo (rol CLIENTE) y lo regresa."
    registrar(nombre: String!, email: String!, password: String!): Usuario!
    logout: Boolean! 
  }
`;
