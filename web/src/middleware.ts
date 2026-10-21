// Dueño: Persona C.
//
// CONTRATO: después de este middleware, toda página tiene
// `Astro.locals.user` = { id, nombre, email, rol } | null.
import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, graphqlServer } from "./lib/graphql";
import { QUERY_ME } from "./lib/queries/auth.js";
import { esPersonal, puede, seccionDe, seccionesDe } from "./lib/permisos.js";

// Rutas que exigen sesión (incluye subrutas: /checkout/algo).
const PROTEGIDAS = ["/perfil", "/checkout", "/pedido", "/admin"];
// Rutas del panel: solo el personal (cualquier rol con permisos).
const SOLO_ADMIN = ["/admin"];

const coincide = (pathname: string, rutas: string[]) =>
  rutas.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;

  // El proxy de las islas solo reenvía la cookie; no necesita `me` (ahorra un viaje al backend).
  if (context.url.pathname.startsWith("/api/")) return next();

  if (context.cookies.has(SESSION_COOKIE)) {
    try {
      const { me } = await graphqlServer(context.cookies, QUERY_ME);
      context.locals.user = me ?? null;
      // El backend respondió pero no reconoce el token (vencido/revocado):
      // borramos la cookie huérfana.
      if (!me) context.cookies.delete(SESSION_COOKIE, { path: "/" });
    } catch {
      // Backend caído o error de red: se trata como visitante, sin borrar la cookie.
    }
  }

  const { pathname, search } = context.url;
  if (coincide(pathname, PROTEGIDAS) && !context.locals.user) {
    return context.redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
  // Un cliente que abre /admin ve un 404: no se revela que el panel existe.
  // (El backend igual rechaza cada operación con requirePermiso.)
  if (coincide(pathname, SOLO_ADMIN)) {
    const user = context.locals.user;
    if (!esPersonal(user)) return context.rewrite("/404");
    // Cada sección pide su permiso. Si el rol no lo tiene: en /admin se le
    // manda a su primera sección (p. ej. Almacén → Productos); en otra ruta, 404.
    // Las descargas CSV no son una sección: el backend revisa el permiso de cada reporte.
    const seccion = pathname.startsWith("/admin/exportar/") ? null : seccionDe(pathname);
    if (seccion && !puede(user, seccion.permiso)) {
      const primera = seccionesDe(user)[0];
      if (seccion.href === "/admin" && pathname.replace(/\/$/, "") === "/admin" && primera) {
        return context.redirect(primera.href);
      }
      return context.rewrite("/404");
    }
  }

  return next();
});
