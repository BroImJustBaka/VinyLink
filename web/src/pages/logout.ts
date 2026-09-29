// Dueño: Persona C.
// TODO(C): invalidar también la sesión en el backend.
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../lib/graphql";

export const POST: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/");
};
