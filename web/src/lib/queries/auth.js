// Dueño: Persona C.

export const MUTATION_LOGIN = `
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      id
      nombre
      email
      rol
      token
    }
  }
`;

export const MUTATION_REGISTRAR = `
  mutation Registrar($nombre: String!, $email: String!, $password: String!) {
    registrar(nombre: $nombre, email: $email, password: $password) {
      id
      nombre
      email
      rol
      token
    }
  }
`;
export const QUERY_ME = `
  query Me {
    me {
      id
      nombre
      email
      rol
    }
  }
`;

export const MUTATION_LOGOUT = `
  mutation Logout {
    logout
  }
`;
