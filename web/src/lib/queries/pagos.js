// Pagos con Stripe: configuración pública, crear el pedido (cobrar) y
// seguimiento del cobro. Lo usan /checkout y /pedido/[id].

// Todos los datos del cobro que se muestran en /pedido/[id] y en el panel.
export const CAMPOS_PAGO = `
  id
  metodo
  estado
  monto
  error
  meses
  tarjeta { marca ultimos4 fondos }
  oxxo { referencia urlFicha expiraEn }
  spei { clabe banco referencia montoRestante urlInstrucciones }
  link { url expiraEn }
`;

export const QUERY_CONFIG_PAGOS = `
  query ConfigPagos {
    configPagos {
      habilitado
      publishableKey
      modoPrueba
      minimo
      maximoOxxo
    }
  }
`;

export const MUTATION_CREAR_PEDIDO = `
  mutation CrearPedido($data: PedidoInput!, $pago: DatosPagoInput!) {
    crearPedido(data: $data, pago: $pago) {
      requiereAccion
      clientSecret
      pedido {
        id
        estado
        total
      }
    }
  }
`;

export const MUTATION_SINCRONIZAR_PAGO = `
  mutation SincronizarPago($pedidoId: ID!) {
    sincronizarPago(pedidoId: $pedidoId) {
      id
      estado
      pago { estado error }
    }
  }
`;

export const MUTATION_CANCELAR_PEDIDO = `
  mutation CancelarPedido($id: ID!) {
    cancelarPedido(id: $id) {
      id
      estado
    }
  }
`;

export const MUTATION_SIMULAR_SPEI = `
  mutation SimularTransferenciaSpei($pedidoId: ID!) {
    simularTransferenciaSpei(pedidoId: $pedidoId) {
      id
      estado
    }
  }
`;
