// Dueño: Persona C. Solo POST (un GET desde otra página no debe cerrar sesión).
import type { APIRoute } from "astro";
import { SESSION_COOKIE, graphqlServer } from "../lib/graphql";
import { MUTATION_LOGOUT } from "../lib/queries/auth.js";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  // Invalida la sesión en la DB. Si falla (backend caído, sesión ya vencida)
  // igual borramos la cookie para que el usuario quede fuera en el navegador.
  if (cookies.has(SESSION_COOKIE)) {
    try {
      await graphqlServer(cookies, MUTATION_LOGOUT);
    } catch {
      /* se ignora a propósito */
    }
  }
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/", 303);
};
