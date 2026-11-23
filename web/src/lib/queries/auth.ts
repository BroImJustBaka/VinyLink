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
      permisos
    }
  }
`;

export const MUTATION_LOGOUT = `
  mutation Logout {
    logout
  }
`;

export const MUTATION_SOLICITAR_RESTABLECIMIENTO = `
  mutation SolicitarRestablecimiento($email: String!) {
    solicitarRestablecimiento(email: $email)
  }
`;

export const MUTATION_RESTABLECER_PASSWORD = `
  mutation RestablecerPassword($token: String!, $password: String!) {
    restablecerPassword(token: $token, password: $password)
  }
`;

export const QUERY_MI_CUENTA = `
  query MiCuenta {
    me { id nombre email telefono rol }
    misDirecciones { id nombre telefono calle colonia ciudad estado cp referencias }
  }
`;

export const MUTATION_ACTUALIZAR_PERFIL = `
  mutation ActualizarMiPerfil($nombre: String!, $telefono: String) {
    actualizarMiPerfil(nombre: $nombre, telefono: $telefono) { id nombre telefono }
  }
`;

export const MUTATION_CAMBIAR_PASSWORD = `
  mutation CambiarMiPassword($actual: String!, $nueva: String!) {
    cambiarMiPassword(actual: $actual, nueva: $nueva)
  }
`;

export const MUTATION_ELIMINAR_DIRECCION = `
  mutation EliminarDireccion($id: ID!) {
    eliminarDireccion(id: $id)
  }
`;

// Ticket de un solo uso para abrir el WebSocket de las subscriptions.
export const MUTATION_TICKET_TIEMPO_REAL = `
  mutation TicketTiempoReal {
    ticketTiempoReal
  }
`;
