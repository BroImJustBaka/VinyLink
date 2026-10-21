// Imágenes subidas desde el panel: GET /imagenes/5 → backend /imagenes/5.
// Así la URL de la imagen es del mismo dominio que la tienda (la que guarda
// el backend usa WEB_URL) y el navegador nunca necesita la dirección del backend.
import type { APIRoute } from "astro";

const BACKEND = (import.meta.env.GRAPHQL_URL ?? "http://localhost:4000/").replace(/\/+$/, "");

export const GET: APIRoute = async ({ params }) => {
  if (!/^\d+$/.test(params.id ?? "")) return new Response("No existe", { status: 404 });
  try {
    const res = await fetch(`${BACKEND}/imagenes/${params.id}`);
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": res.headers.get("cache-control") ?? "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Servidor no disponible", { status: 502 });
  }
};
