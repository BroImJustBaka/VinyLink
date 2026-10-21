// Dueño: Persona C (auth)
export const typeDefs = `#graphql
  "Rol de un usuario dentro de la tienda. Todos menos CLIENTE son personal del panel."
  enum Rol {
    CLIENTE
    ADMIN
    ALMACEN
    SOPORTE
    FINANZAS
  }

  "Usuario de la tienda (cliente o personal)."
  type Usuario {
    id: ID!
    nombre: String!
    email: String!
    rol: Rol!
    telefono: String
    "false = cuenta bloqueada (no puede iniciar sesión)."
    activo: Boolean!
    "Permisos del panel según su rol (vacío para un CLIENTE)."
    permisos: [String!]!
    "Token de sesión. Solo viene en la respuesta de login y registrar."
    token: String
  }

  "Un permiso del panel con su descripción."
  type Permiso {
    clave: String!
    descripcion: String!
  }

  "Qué puede hacer cada rol (para mostrarlo en el panel)."
  type RolPermisos {
    rol: Rol!
    permisos: [String!]!
  }

  extend type Query {
    "Usuario de la sesión actual (null si no hay sesión)."
    me: Usuario
    "Catálogo de permisos y roles (cualquier persona del personal)."
    permisosPorRol: [RolPermisos!]!
    permisos: [Permiso!]!
  }

  extend type Mutation {
    "Valida email+password (bcrypt), crea una sesión y regresa el usuario con su token."
    login(email: String!, password: String!): Usuario!
    "Crea un usuario nuevo (rol CLIENTE), inicia su sesión y lo regresa con su token."
    registrar(nombre: String!, email: String!, password: String!): Usuario!
    "Cierra la sesión actual (borra el token en la base de datos)."
    logout: Boolean!
    """
    Manda por correo un link para elegir una contraseña nueva. Siempre
    responde true (aunque el email no exista), para no revelar qué cuentas hay.
    """
    solicitarRestablecimiento(email: String!): Boolean!
    "Cambia la contraseña con el token del correo. Cierra las demás sesiones."
    restablecerPassword(token: String!, password: String!): Boolean!
    "Cambia el nombre y el teléfono del usuario con sesión."
    actualizarMiPerfil(nombre: String!, telefono: String): Usuario!
    "Cambia la contraseña del usuario con sesión (pide la actual)."
    cambiarMiPassword(actual: String!, nueva: String!): Boolean!
  }
`;
