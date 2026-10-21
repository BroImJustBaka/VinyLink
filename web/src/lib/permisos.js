// Secciones del panel y el permiso que pide cada una. El backend es quien
// de verdad protege cada operación (requirePermiso); esto solo decide qué
// se muestra en el menú y qué rutas abre el middleware.
// Los permisos del usuario llegan en `me { permisos }` (Astro.locals.user).
export const SECCIONES_ADMIN = [
  { href: "/admin", nombre: "Resumen", permiso: "reportes" },
  { href: "/admin/pedidos", nombre: "Pedidos", permiso: "pedidos.ver" },
  { href: "/admin/productos", nombre: "Productos", permiso: "catalogo" },
  { href: "/admin/categorias", nombre: "Categorías", permiso: "catalogo" },
  { href: "/admin/inventario", nombre: "Inventario", permiso: "inventario" },
  { href: "/admin/proveedores", nombre: "Proveedores", permiso: "inventario" },
  { href: "/admin/clientes", nombre: "Clientes", permiso: "clientes" },
  { href: "/admin/cupones", nombre: "Cupones", permiso: "cupones" },
  { href: "/admin/links", nombre: "Links de pago", permiso: "links" },
  { href: "/admin/reportes", nombre: "Reportes", permiso: "reportes" },
  { href: "/admin/correos", nombre: "Correos", permiso: "correos" },
  { href: "/admin/bitacora", nombre: "Bitácora", permiso: "bitacora" },
  { href: "/admin/configuracion", nombre: "Configuración", permiso: "configuracion" },
];

export const puede = (user, permiso) => Boolean(user?.permisos?.includes(permiso));

export const esPersonal = (user) => (user?.permisos?.length ?? 0) > 0;

// Sección a la que pertenece una ruta: la de href más largo que coincide
// (/admin/productos/5 → Productos, /admin → Resumen).
export function seccionDe(pathname) {
  const ruta = pathname.replace(/\/$/, "") || "/";
  return [...SECCIONES_ADMIN]
    .sort((a, b) => b.href.length - a.href.length)
    .find((s) => ruta === s.href || ruta.startsWith(`${s.href}/`));
}

export const seccionesDe = (user) => SECCIONES_ADMIN.filter((s) => puede(user, s.permiso));

// Exportar CSV: "reportes" puede todo; los demás, lo de su área.
export const PERMISOS_EXPORTAR = {
  pedidos: ["reportes"],
  ventas_dia: ["reportes"],
  productos: ["reportes", "inventario", "catalogo"],
  movimientos: ["reportes", "inventario"],
  clientes: ["reportes", "clientes"],
};

export const NOMBRES_ROL = {
  CLIENTE: "Cliente",
  ADMIN: "Administrador",
  ALMACEN: "Almacén",
  SOPORTE: "Soporte",
  FINANZAS: "Finanzas",
};
