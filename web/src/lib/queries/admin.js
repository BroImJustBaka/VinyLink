// Panel de administración (/admin). Cada operación exige un permiso del
// panel en el backend (ver back/src/modules/auth/permisos.js).
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
      pedidosPorEnviar
      clientesNuevos
      reembolsos
      descuentos
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
    adminStockBajo {
      id
      nombre
      stock
      stockMinimo
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
        numeroGuia
        envio { ciudad estado }
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
      subtotal
      descuento
      costoEnvio
      iva
      cupon
      metodoPago
      pagadoEn
      nota
      paqueteria
      numeroGuia
      enviadoEn
      entregadoEn
      montoReembolsado
      envio { nombre telefono calle colonia ciudad estado cp referencias }
      usuario { id nombre email telefono }
      historial { tipo fecha estadoAnterior estadoNuevo texto autor }
      reembolsos { id monto parcial repusoStock motivo autor creadoEn }
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
        producto { id nombre imagen sku }
      }
    }
    configPagos { modoPrueba }
    configuracionTienda { paqueterias ivaPorcentaje }
  }
`;

export const MUTATION_ACTUALIZAR_ESTADO = `
  mutation ActualizarEstadoPedido($id: ID!, $estado: String!, $paqueteria: String, $numeroGuia: String) {
    actualizarEstadoPedido(id: $id, estado: $estado, paqueteria: $paqueteria, numeroGuia: $numeroGuia) { id estado }
  }
`;

export const MUTATION_ACTUALIZAR_GUIA = `
  mutation ActualizarGuiaPedido($id: ID!, $paqueteria: String!, $numeroGuia: String!) {
    actualizarGuiaPedido(id: $id, paqueteria: $paqueteria, numeroGuia: $numeroGuia) { id }
  }
`;

export const MUTATION_REEMBOLSAR = `
  mutation ReembolsarPedido($id: ID!, $reponerStock: Boolean, $monto: Float, $motivo: String) {
    reembolsarPedido(id: $id, reponerStock: $reponerStock, monto: $monto, motivo: $motivo) { id estado }
  }
`;

export const MUTATION_NOTA_PEDIDO = `
  mutation AgregarNotaPedido($pedidoId: ID!, $texto: String!) {
    agregarNotaPedido(pedidoId: $pedidoId, texto: $texto) { id }
  }
`;

// ---------------------------------------------------------------- catálogo

export const QUERY_ADMIN_PRODUCTOS = `
  query AdminProductos($buscar: String, $categoriaId: ID) {
    productos(limit: 500, incluirInactivos: true, buscar: $buscar, categoriaId: $categoriaId) {
      total
      items {
        id
        nombre
        sku
        precio
        stock
        stockMinimo
        activo
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
      sku
      stockMinimo
      activo
      movimientos(limite: 8) { id tipo cantidad stockResultante motivo creadoEn usuario { nombre } }
    }
    categorias { id nombre }
  }
`;

export const QUERY_CATEGORIAS_ADMIN = `
  query CategoriasAdmin {
    categorias { id nombre descripcion imagen totalProductos }
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

export const MUTATION_ACTIVO_PRODUCTO = `
  mutation CambiarActivoProducto($id: ID!, $activo: Boolean!) {
    cambiarActivoProducto(id: $id, activo: $activo) { id activo }
  }
`;

export const MUTATION_ELIMINAR_PRODUCTO = `
  mutation EliminarProducto($id: ID!) {
    eliminarProducto(id: $id)
  }
`;

export const MUTATION_CREAR_CATEGORIA = `
  mutation CrearCategoria($data: CategoriaInput!) {
    crearCategoria(data: $data) { id }
  }
`;

export const MUTATION_ACTUALIZAR_CATEGORIA = `
  mutation ActualizarCategoria($id: ID!, $data: CategoriaInput!) {
    actualizarCategoria(id: $id, data: $data) { id }
  }
`;

export const MUTATION_ELIMINAR_CATEGORIA = `
  mutation EliminarCategoria($id: ID!) {
    eliminarCategoria(id: $id)
  }
`;

export const MUTATION_SUBIR_IMAGEN = `
  mutation SubirImagen($nombre: String!, $tipo: String!, $base64: String!) {
    subirImagen(nombre: $nombre, tipo: $tipo, base64: $base64) { id url bytes }
  }
`;

// ---------------------------------------------------------------- inventario

export const QUERY_INVENTARIO = `
  query Inventario($productoId: ID, $tipo: String, $limite: Int, $offset: Int) {
    adminResumenInventario { productos piezas valorVenta agotados bajoMinimo }
    adminMovimientos(productoId: $productoId, tipo: $tipo, limite: $limite, offset: $offset) {
      total
      items {
        id
        tipo
        cantidad
        stockResultante
        pedidoId
        costoUnitario
        motivo
        creadoEn
        producto { id nombre sku }
        proveedor { id nombre }
        usuario { nombre }
      }
    }
    productos(limit: 500, incluirInactivos: true) { items { id nombre sku stock stockMinimo activo } }
    proveedores { id nombre }
  }
`;

export const MUTATION_REGISTRAR_ENTRADA = `
  mutation RegistrarEntrada($productoId: ID!, $cantidad: Int!, $proveedorId: ID, $costoUnitario: Float, $motivo: String) {
    registrarEntrada(productoId: $productoId, cantidad: $cantidad, proveedorId: $proveedorId, costoUnitario: $costoUnitario, motivo: $motivo) { id stockResultante }
  }
`;

export const MUTATION_AJUSTAR_STOCK = `
  mutation AjustarStock($productoId: ID!, $stockNuevo: Int!, $motivo: String!) {
    ajustarStock(productoId: $productoId, stockNuevo: $stockNuevo, motivo: $motivo) { id stockResultante }
  }
`;

export const QUERY_PROVEEDORES = `
  query Proveedores {
    proveedores(incluirInactivos: true) {
      id nombre contacto email telefono notas activo entradas piezas ultimaEntrada
    }
  }
`;

export const MUTATION_CREAR_PROVEEDOR = `
  mutation CrearProveedor($data: ProveedorInput!) {
    crearProveedor(data: $data) { id }
  }
`;

export const MUTATION_ACTUALIZAR_PROVEEDOR = `
  mutation ActualizarProveedor($id: ID!, $data: ProveedorInput!) {
    actualizarProveedor(id: $id, data: $data) { id }
  }
`;

// ---------------------------------------------------------------- clientes

export const QUERY_ADMIN_CLIENTES = `
  query AdminClientes($buscar: String, $rol: Rol, $bloqueados: Boolean, $limite: Int, $offset: Int) {
    adminClientes(buscar: $buscar, rol: $rol, bloqueados: $bloqueados, limite: $limite, offset: $offset) {
      total
      items {
        pedidos
        totalGastado
        ultimoPedido
        creadoEn
        usuario { id nombre email rol activo }
      }
    }
  }
`;

export const QUERY_ADMIN_CLIENTE = `
  query AdminCliente($id: ID!) {
    adminCliente(id: $id) {
      creadoEn
      pedidosPagados
      totalGastado
      ticketPromedio
      ultimoPedido
      usuario { id nombre email rol activo telefono }
      pedidos { id fecha estado total metodoPago }
      direcciones { id nombre telefono calle colonia ciudad estado cp referencias }
    }
  }
`;

export const MUTATION_CAMBIAR_ROL = `
  mutation CambiarRolUsuario($id: ID!, $rol: Rol!) {
    cambiarRolUsuario(id: $id, rol: $rol) { id rol }
  }
`;

export const MUTATION_BLOQUEAR_USUARIO = `
  mutation BloquearUsuario($id: ID!, $bloqueado: Boolean!) {
    bloquearUsuario(id: $id, bloqueado: $bloqueado) { id activo }
  }
`;

export const MUTATION_RESTABLECER_CLIENTE = `
  mutation EnviarRestablecimientoCliente($id: ID!) {
    enviarRestablecimientoCliente(id: $id)
  }
`;

// Datos para el formulario de links de pago: clientes, productos y los links recientes.
export const QUERY_LINKS = `
  query LinksDePago {
    adminClientes(rol: CLIENTE, limite: 500) { items { usuario { id nombre email rol activo } } }
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

// ---------------------------------------------------------------- cupones

const CAMPOS_CUPON = `
  id codigo descripcion tipo valor minimoCompra usosMaximos usosPorCliente
  vigenteDesde vigenteHasta activo usos descuentoTotal creadoEn
`;

export const QUERY_CUPONES = `
  query AdminCupones {
    adminCupones { ${CAMPOS_CUPON} }
  }
`;

export const MUTATION_CREAR_CUPON = `
  mutation CrearCupon($data: CuponInput!) {
    crearCupon(data: $data) { id }
  }
`;

export const MUTATION_ACTUALIZAR_CUPON = `
  mutation ActualizarCupon($id: ID!, $data: CuponInput!) {
    actualizarCupon(id: $id, data: $data) { id }
  }
`;

// ---------------------------------------------------------------- reportes, correos, bitácora

export const QUERY_REPORTES = `
  query Reportes($dias: Int!) {
    adminResumen(dias: $dias) { ingresos pedidosPagados descuentos reembolsos ticketPromedio }
    adminVentasPorCategoria(dias: $dias) { unidades ingresos categoria { id nombre } }
    adminTopProductos(dias: $dias, limite: 10) { unidades ingresos producto { id nombre sku } }
  }
`;

export const QUERY_EXPORTAR = `
  query Exportar($tipo: String!, $desde: String, $hasta: String) {
    adminExportar(tipo: $tipo, desde: $desde, hasta: $hasta)
  }
`;

export const QUERY_CORREOS = `
  query AdminCorreos($buscar: String, $limite: Int, $offset: Int, $ver: ID!, $conVista: Boolean!) {
    adminCorreos(buscar: $buscar, limite: $limite, offset: $offset) {
      total
      envioReal
      items { id para asunto tipo pedidoId estado error creadoEn }
    }
    adminCorreo(id: $ver) @include(if: $conVista) { id para asunto html estado creadoEn }
  }
`;

export const MUTATION_REENVIAR_CORREO = `
  mutation ReenviarCorreo($id: ID!) {
    reenviarCorreo(id: $id) { id estado }
  }
`;

export const QUERY_BITACORA = `
  query AdminBitacora($entidad: String, $buscar: String, $limite: Int, $offset: Int) {
    adminBitacora(entidad: $entidad, buscar: $buscar, limite: $limite, offset: $offset) {
      total
      items { id usuarioId usuarioNombre accion entidad entidadId detalle descripcion creadoEn }
    }
  }
`;

// ---------------------------------------------------------------- configuración

export const QUERY_CONFIGURACION = `
  query Configuracion {
    configuracionTienda { nombreTienda emailContacto costoEnvio envioGratisDesde ivaPorcentaje paqueterias }
    permisosPorRol { rol permisos }
    permisos { clave descripcion }
  }
`;

export const MUTATION_ACTUALIZAR_CONFIGURACION = `
  mutation ActualizarConfiguracion($data: ConfiguracionInput!) {
    actualizarConfiguracion(data: $data) { nombreTienda }
  }
`;
