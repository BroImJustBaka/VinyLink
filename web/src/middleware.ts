// Dueño: Persona C.
//
// CONTRATO: después de este middleware, toda página tiene
// `Astro.locals.user` = { id, nombre, email, rol } | null.
import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  // TODO(C): si existe la cookie de sesión, pedir `me` al backend con
  // graphqlServer(context.cookies, QUERY_ME) y guardar el resultado aquí.
  // TODO(C): redirigir a /login cuando no hay sesión en /perfil y /checkout.
  context.locals.user = null;
  return next();
});
