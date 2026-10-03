// Dueño: Persona C. Proxy para las islas React: reenvía la operación al
// backend con la sesión de la cookie httpOnly.
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../lib/graphql";

export const POST: APIRoute = async ({ request, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  let res: Response;
  try {
    res = await fetch(import.meta.env.GRAPHQL_URL ?? "http://localhost:4000/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: await request.text(),
    });
  } catch {
    // Backend caído: respondemos con la forma de error de GraphQL para que
    // graphqlClient muestre un mensaje legible.
    return Response.json(
      { errors: [{ message: "No hay conexión con el servidor. Intenta de nuevo en unos segundos." }] },
      { status: 200 }
    );
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
};
