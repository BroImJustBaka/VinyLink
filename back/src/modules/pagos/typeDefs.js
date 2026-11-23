// Pagos con Stripe y PayPal. Los métodos se escriben en minúsculas:
// credito, debito, oxxo, spei, link (Stripe) y paypal.
export const typeDefs = `#graphql
  "Configuración pública de pagos (la necesita el checkout)."
  type ConfigPagos {
    "true si el backend tiene llaves de Stripe y se puede cobrar."
    habilitado: Boolean!
    "Llave publicable de Stripe (pk_...). Es pública: la usa Stripe.js en el navegador."
    publishableKey: String
    "true si las llaves son de prueba (no se mueve dinero real)."
    modoPrueba: Boolean!
    "Total mínimo que acepta Stripe, en pesos."
    minimo: Float!
    "Máximo por ficha OXXO, en pesos."
    maximoOxxo: Float!
    "true si el backend tiene credenciales de PayPal (método PayPal disponible)."
    paypalHabilitado: Boolean!
  }

  "Tarjeta con la que se pagó."
  type PagoTarjeta {
    "visa, mastercard, amex..."
    marca: String
    ultimos4: String
    "credit, debit o prepaid (lo informa el banco)."
    fondos: String
  }

  "Ficha para pagar en efectivo en OXXO."
  type PagoOxxo {
    "Número de referencia que se dicta o escanea en la caja."
    referencia: String
    "Página de Stripe con el código de barras para imprimir."
    urlFicha: String
    expiraEn: String
  }

  "Datos para pagar por transferencia SPEI."
  type PagoSpei {
    "CLABE interbancaria de 18 dígitos a la que se transfiere."
    clabe: String
    banco: String
    referencia: String
    "Lo que falta por transferir, en pesos."
    montoRestante: Float
    "Página de Stripe con las instrucciones."
    urlInstrucciones: String
  }

  "Orden de PayPal."
  type PagoPaypal {
    "Link para aprobar el pago en PayPal (mientras siga pendiente)."
    url: String
    "Id de la orden en PayPal."
    ordenId: String
    "Cuenta de PayPal con la que se pagó."
    correoPagador: String
  }

  "Link de pago (Stripe Checkout) para compartir."
  type PagoLink {
    url: String
    expiraEn: String
  }

  "Cobro de un pedido (Stripe o PayPal)."
  type Pago {
    id: ID!
    "credito, debito, oxxo, spei, link o paypal."
    metodo: String!
    "pendiente, requiere_accion, pagado, fallido, cancelado o reembolsado."
    estado: String!
    monto: Float!
    "Motivo del rechazo o la cancelación, si lo hubo."
    error: String
    tarjeta: PagoTarjeta
    "Meses sin intereses elegidos (solo crédito)."
    meses: Int
    oxxo: PagoOxxo
    spei: PagoSpei
    link: PagoLink
    paypal: PagoPaypal
    "Id del cobro en Stripe (solo lo ve un ADMIN)."
    stripePaymentIntentId: String
    "Id del link en Stripe (solo lo ve un ADMIN)."
    stripeCheckoutSessionId: String
    "Id de la captura en PayPal (solo lo ve el personal)."
    paypalCaptureId: String
    creadoEn: String!
  }

  extend type Pedido {
    "Método de pago elegido (null en pedidos anteriores a los pagos en línea)."
    metodoPago: String
    pagadoEn: String
    "Nota interna (por ejemplo, si se pagó después de cancelarse)."
    nota: String
    pago: Pago
  }

  "Cómo quiere pagar el cliente."
  input DatosPagoInput {
    "credito, debito, oxxo, spei, link o paypal."
    metodo: String!
    "Solo tarjetas: id del ConfirmationToken que crea Stripe.js con los datos de la tarjeta."
    confirmationTokenId: String
    "Solo OXXO: nombre y apellido que aparecen en la ficha."
    nombre: String
    "Solo OXXO: email al que se asocia la ficha."
    email: String
  }

  "Respuesta de crearPedido."
  type ResultadoPago {
    pedido: Pedido!
    "true si el banco pide 3D Secure: el navegador debe llamar a stripe.handleNextAction."
    requiereAccion: Boolean!
    "Secreto del cobro para stripe.handleNextAction (solo cuando requiereAccion es true)."
    clientSecret: String
    "Solo PayPal: link al que se manda al cliente para aprobar el pago."
    urlAprobacion: String
  }

  extend type Query {
    configPagos: ConfigPagos!
  }

  extend type Mutation {
    "Crea el pedido del usuario con sesión, aparta el stock y le pide el cobro a Stripe o PayPal."
    crearPedido(data: PedidoInput!, pago: DatosPagoInput!): ResultadoPago!
    "Le pregunta a Stripe o a PayPal cómo va el pago de un pedido propio y actualiza su estado (en PayPal, captura la orden aprobada)."
    sincronizarPago(pedidoId: ID!): Pedido
    "Cancela un pedido propio que sigue esperando su pago (un ADMIN puede cancelar cualquiera)."
    cancelarPedido(id: ID!): Pedido!
    "Solo en modo de prueba: simula que llegó la transferencia SPEI de un pedido."
    simularTransferenciaSpei(pedidoId: ID!): Pedido!
  }
`;
