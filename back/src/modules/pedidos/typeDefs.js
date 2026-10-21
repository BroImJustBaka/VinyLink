// Dueño: Persona B (carrito y pedidos)
export const typeDefs = `#graphql
  "Un renglón del pedido: un producto con la cantidad comprada."
  type DetallePedido {
    id: ID!
    producto: Producto!
    cantidad: Int!
    precioUnitario: Float!
    subtotal: Float!
  }

  "Dirección a la que se manda un pedido (copia guardada en el pedido)."
  type DireccionEnvio {
    nombre: String!
    telefono: String!
    calle: String!
    colonia: String!
    ciudad: String!
    estado: String!
    cp: String!
    referencias: String
  }

  "Dirección guardada en la libreta del cliente."
  type Direccion {
    id: ID!
    nombre: String!
    telefono: String!
    calle: String!
    colonia: String!
    ciudad: String!
    estado: String!
    cp: String!
    referencias: String
  }

  input DireccionInput {
    nombre: String!
    "10 dígitos."
    telefono: String!
    "Calle y número."
    calle: String!
    colonia: String!
    ciudad: String!
    estado: String!
    "5 dígitos."
    cp: String!
    referencias: String
  }

  "Un momento en la línea de tiempo del pedido."
  type EventoPedido {
    "estado (cambio de estado) o nota (nota interna, solo la ve el personal)."
    tipo: String!
    fecha: String!
    estadoAnterior: String
    estadoNuevo: String
    "Comentario del cambio o texto de la nota."
    texto: String
    "Quién lo hizo (null = el sistema o Stripe)."
    autor: String
  }

  "Pedido registrado por un usuario, con sus renglones."
  type Pedido {
    id: ID!
    fecha: String!
    "pendiente, pagado, enviado, entregado, cancelado o reembolsado."
    estado: String!
    "total = subtotal - descuento + costoEnvio."
    total: Float!
    subtotal: Float!
    descuento: Float!
    costoEnvio: Float!
    "IVA incluido en el total (desglosado con el porcentaje de la configuración)."
    iva: Float!
    "Código del cupón que se usó."
    cupon: String
    envio: DireccionEnvio
    paqueteria: String
    numeroGuia: String
    enviadoEn: String
    entregadoEn: String
    "Pesos ya devueltos al cliente (reembolsos parciales o total)."
    montoReembolsado: Float!
    usuario: Usuario!
    detalles: [DetallePedido!]!
    "Línea de tiempo. El cliente solo ve los cambios de estado; el personal también las notas."
    historial: [EventoPedido!]!
  }

  "Un renglón del carrito que se envía al registrar el pedido."
  input DetallePedidoInput {
    productoId: ID!
    cantidad: Int!
  }

  "Renglones para registrar un pedido (ver crearPedido en el módulo pagos)."
  input PedidoInput {
    items: [DetallePedidoInput!]!
    "Código de cupón (opcional)."
    cupon: String
    "Dirección de envío (el checkout la pide siempre)."
    envio: DireccionInput
    "true = guardar la dirección en la libreta del cliente."
    guardarDireccion: Boolean
  }

  "Total que se va a cobrar, calculado por el backend (lo muestra el checkout)."
  type Cotizacion {
    subtotal: Float!
    descuento: Float!
    costoEnvio: Float!
    total: Float!
    iva: Float!
    "Cupón aplicado (null si no se mandó o no aplica)."
    cupon: String
    cuponDescripcion: String
    "Por qué no aplicó el cupón (el resto de la cotización se calcula sin él)."
    errorCupon: String
    "Cuánto falta para el envío gratis (null si ya es gratis o no hay promoción)."
    faltaParaEnvioGratis: Float
  }

  "Un renglón del carrito de invitado que se fusiona al iniciar sesión."
  input ItemCarritoInput {
    productoId: ID!
    cantidad: Int!
  }

  "Un renglón del carrito guardado en base de datos."
  type DetalleCarrito {
    id: ID!
    producto: Producto!
    cantidad: Int!
    subtotal: Float!
  }

  "Carrito persistido en base de datos, uno por usuario."
  type Carrito {
    id: ID!
    usuario: Usuario!
    items: [DetalleCarrito!]!
    total: Float!
  }

  extend type Query {
    "Todos los pedidos de la tienda (permiso pedidos.ver)."
    pedidos: [Pedido!]!
    "Pedidos del usuario con sesión, del más reciente al más antiguo."
    misPedidos: [Pedido!]!
    "Consulta un pedido por id. Solo su dueño o el personal; para cualquier otro regresa null."
    pedido(id: ID!): Pedido
    "Carrito del usuario con sesión (lo crea vacío si no existe)."
    carrito: Carrito!
    "Calcula subtotal, cupón, envío e IVA de un carrito sin crear el pedido."
    cotizarPedido(data: PedidoInput!): Cotizacion!
    "Direcciones guardadas del usuario con sesión."
    misDirecciones: [Direccion!]!
  }

  extend type Mutation {
    "Agrega un producto al carrito del usuario (suma cantidad si ya estaba)."
    agregarAlCarrito(productoId: ID!, cantidad: Int = 1): Carrito!
    "Fija la cantidad exacta de un renglón del carrito (lo quita si llega a 0)."
    cambiarCantidadCarrito(productoId: ID!, cantidad: Int!): Carrito!
    "Quita un producto del carrito por completo."
    quitarDelCarrito(productoId: ID!): Carrito!
    "Vacía todos los renglones del carrito."
    vaciarCarritoDB: Carrito!
    "Suma los renglones del carrito de invitado al carrito del usuario (respeta el stock)."
    fusionarCarrito(items: [ItemCarritoInput!]!): Carrito!
    "Guarda una dirección en la libreta del usuario con sesión."
    guardarDireccion(data: DireccionInput!): Direccion!
    "Borra una dirección propia de la libreta (los pedidos conservan su copia)."
    eliminarDireccion(id: ID!): Boolean!
  }
`;
