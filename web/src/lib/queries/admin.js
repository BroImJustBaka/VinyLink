// Panel de administración (/admin). Todas exigen rol ADMIN en el backend.
import { CAMPOS_PAGO } from "./pagos.js";

// Todo el tablero en una sola petición.
export const QUERY_TABLERO = `
  query Tablero($dias: Int!) {
    adminResumen(dias: $dias) {
      ingresos
      pedidosPagados
      ticketPromedio
      unidadesVendidas
      ingresosPeriodoAnterior
      pedidosPeriodoAnterior
      pedidosPendientes
      clientesNuevos
    }
    adminTopProductos(dias: $dias, limite: 5) {
      unidades
      ingresos
      producto { id nombre }
    }
    adminVentasPorDia(dias: $dias) {
      fecha
      ingresos
      pedidos
    }
    adminVentasPorMetodo(dias: $dias) {
      metodo
      pedidos
      ingresos
    }
    adminStockBajo(umbral: 5) {
      id
      nombre
      stock
    }
    adminPedidos(limite: 6) {
      items {
        id
        fecha
        estado
        total
        metodoPago
        usuario { nombre }
      }
    }
  }
`;

export const QUERY_ADMIN_PEDIDOS = `
  query AdminPedidos($estado: String, $metodo: String, $buscar: String, $limite: Int, $offset: Int) {
    adminPedidos(estado: $estado, metodo: $metodo, buscar: $buscar, limite: $limite, offset: $offset) {
      total
      items {
        id
        fecha
        estado
        total
        metodoPago
        usuario { nombre email }
        pago { link { url } }
      }
    }
  }
`;

export const QUERY_ADMIN_PEDIDO = `
  query AdminPedido($id: ID!) {
    pedido(id: $id) {
      id
      fecha
      estado
      total
      metodoPago
      pagadoEn
      nota
      usuario { id nombre email }
      pago {
        ${CAMPOS_PAGO}
        stripePaymentIntentId
        stripeCheckoutSessionId
        creadoEn
      }
      detalles {
        id
        cantidad
        precioUnitario
        subtotal
        producto { id nombre imagen }
      }
    }
    configPagos { modoPrueba }
  }
`;

export const MUTATION_ACTUALIZAR_ESTADO = `
  mutation ActualizarEstadoPedido($id: ID!, $estado: String!) {
    actualizarEstadoPedido(id: $id, estado: $estado) { id estado }
  }
`;

export const MUTATION_REEMBOLSAR = `
  mutation ReembolsarPedido($id: ID!, $reponerStock: Boolean) {
    reembolsarPedido(id: $id, reponerStock: $reponerStock) { id estado }
  }
`;

export const QUERY_ADMIN_PRODUCTOS = `
  query AdminProductos {
    productos(limit: 500) {
      total
      items {
        id
        nombre
        precio
        stock
        imagen
        categoria { id nombre }
      }
    }
    categorias { id nombre }
  }
`;

export const QUERY_ADMIN_PRODUCTO = `
  query AdminProducto($id: ID!) {
    producto(id: $id) {
      id
      nombre
      descripcion
      precio
      stock
      imagen
      categoriaId
    }
    categorias { id nombre }
  }
`;

export const QUERY_CATEGORIAS_ADMIN = `
  query CategoriasAdmin {
    categorias { id nombre }
  }
`;

export const MUTATION_CREAR_PRODUCTO = `
  mutation CrearProducto($data: ProductoInput!) {
    crearProducto(data: $data) { id nombre }
  }
`;

export const MUTATION_ACTUALIZAR_PRODUCTO = `
  mutation ActualizarProducto($id: ID!, $data: ProductoInput!) {
    actualizarProducto(id: $id, data: $data) { id nombre }
  }
`;

export const MUTATION_ELIMINAR_PRODUCTO = `
  mutation EliminarProducto($id: ID!) {
    eliminarProducto(id: $id)
  }
`;

export const QUERY_ADMIN_CLIENTES = `
  query AdminClientes {
    adminClientes {
      pedidos
      totalGastado
      ultimoPedido
      creadoEn
      usuario { id nombre email rol }
    }
  }
`;

export const MUTATION_CAMBIAR_ROL = `
  mutation CambiarRolUsuario($id: ID!, $rol: Rol!) {
    cambiarRolUsuario(id: $id, rol: $rol) { id rol }
  }
`;

// Datos para el formulario de links de pago: clientes, productos y los links recientes.
export const QUERY_LINKS = `
  query LinksDePago {
    adminClientes { usuario { id nombre email rol } }
    productos(limit: 500) { items { id nombre precio stock } }
    adminPedidos(metodo: "link", limite: 10) {
      items {
        id
        fecha
        estado
        total
        usuario { nombre }
        pago { link { url expiraEn } }
      }
    }
    configPagos { habilitado }
  }
`;

export const MUTATION_CREAR_LINK_ADMIN = `
  mutation CrearLinkDePagoAdmin($usuarioId: ID!, $items: [DetallePedidoInput!]!) {
    crearLinkDePagoAdmin(usuarioId: $usuarioId, items: $items) {
      pedido {
        id
        total
        pago { link { url expiraEn } }
      }
    }
  }
`;
