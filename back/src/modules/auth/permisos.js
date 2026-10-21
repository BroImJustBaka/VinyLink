// Roles del personal y lo que puede hacer cada uno en el panel.
//
// Un permiso es un texto ("pedidos.ver", "catalogo"...). Los resolvers
// llaman a requirePermiso(context, "catalogo") y el frontend recibe la
// lista en `me { permisos }` para mostrar solo las secciones permitidas.
// ADMIN tiene "*" = todos, incluidos los que solo él tiene (usuarios,
// configuración y bitácora).
export const ROLES = ["CLIENTE", "ADMIN", "ALMACEN", "SOPORTE", "FINANZAS"];

export const PERMISOS = {
  "reportes": "Ver el resumen de ventas, reportes y exportar CSV",
  "pedidos.ver": "Ver todos los pedidos",
  "pedidos.envio": "Marcar pedidos como enviados o entregados",
  "pedidos.cancelar": "Cancelar pedidos que esperan su pago",
  "pedidos.notas": "Escribir notas internas en los pedidos",
  "reembolsos": "Reembolsar pagos (completos o parciales)",
  "catalogo": "Crear y editar productos, categorías e imágenes",
  "inventario": "Registrar entradas y ajustes de stock; proveedores",
  "clientes": "Ver clientes, bloquearlos y mandarles link de contraseña",
  "links": "Crear links de pago para un cliente",
  "cupones": "Crear y editar cupones de descuento",
  "correos": "Ver y reenviar los correos de la tienda",
  "usuarios": "Cambiar el rol de otros usuarios",
  "configuracion": "Cambiar la configuración de la tienda",
  "bitacora": "Ver la bitácora de auditoría",
};

const DE_ROL = {
  CLIENTE: [],
  ADMIN: ["*"],
  ALMACEN: ["catalogo", "inventario", "pedidos.ver", "pedidos.envio"],
  SOPORTE: ["pedidos.ver", "pedidos.cancelar", "pedidos.notas", "clientes", "links", "correos"],
  FINANZAS: ["reportes", "pedidos.ver", "reembolsos", "cupones", "links"],
};

export function permisosDe(rol) {
  const lista = DE_ROL[rol] ?? [];
  return lista.includes("*") ? Object.keys(PERMISOS) : lista;
}

export const tienePermiso = (usuario, permiso) =>
  Boolean(usuario) && permisosDe(usuario.rol).includes(permiso);

// Personal = cualquier rol con al menos un permiso (todos menos CLIENTE).
export const esPersonal = (usuario) => Boolean(usuario) && permisosDe(usuario.rol).length > 0;
