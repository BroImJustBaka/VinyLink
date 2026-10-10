// Dueño: Persona C.
//
// CONTRATO: después de este middleware, toda página tiene
// `Astro.locals.user` = { id, nombre, email, rol } | null.
import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, graphqlServer } from "./lib/graphql";
import { QUERY_ME } from "./lib/queries/auth.js";

// Rutas que exigen sesión (incluye subrutas: /checkout/algo).
const PROTEGIDAS = ["/perfil", "/checkout", "/pedido", "/admin"];
// Rutas que además exigen rol ADMIN.
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
  // (El backend igual rechaza cada operación con requireAdmin.)
  if (coincide(pathname, SOLO_ADMIN) && context.locals.user?.rol !== "ADMIN") {
    return context.rewrite("/404");
  }

  return next();
});
