// Dueño: Persona C. Proxy para las islas React: reenvía la operación al
// backend con la sesión de la cookie httpOnly.
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../lib/graphql";

export const POST: APIRoute = async ({ request, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const res = await fetch(import.meta.env.GRAPHQL_URL ?? "http://localhost:4000/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: await request.text(),
  });
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
};
