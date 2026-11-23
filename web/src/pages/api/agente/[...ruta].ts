// Proxy hacia el microservicio del asistente y las reseñas (carpeta agente/).
// El navegador nunca habla con el agente directo:
//  - solo pasan las rutas de la lista (nada de /docs ni rutas internas);
//  - la cookie httpOnly de sesión se reenvía como `Authorization: Bearer`;
//  - se agrega la clave interna que el agente exige, y la IP real del cliente
//    para su límite de mensajes.
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../../lib/graphql";

const PERMITIDAS: [string, RegExp][] = [
  ["POST", /^chat$/],
  ["GET", /^chat\/[\w-]{1,64}$/],
  ["GET", /^productos\/\d{1,9}\/resenas$/],
  ["POST", /^productos\/\d{1,9}\/resenas$/],
  ["DELETE", /^productos\/\d{1,9}\/resenas\/mia$/],
];

const error = (status: number, detail: string) => Response.json({ detail }, { status });

export const ALL: APIRoute = async ({ params, request, cookies, clientAddress }) => {
  const ruta = params.ruta ?? "";
  if (!PERMITIDAS.some(([m, patron]) => m === request.method && patron.test(ruta))) {
    return error(404, "No encontrado");
  }
  const base = import.meta.env.AGENTE_URL;
  if (!base) return error(503, "El asistente no está configurado en este servidor.");

  const token = cookies.get(SESSION_COOKIE)?.value;
  // En Render (y cualquier proxy) la IP original viene en X-Forwarded-For.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || clientAddress;
  const headers: Record<string, string> = { "X-Cliente-IP": ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (import.meta.env.AGENTE_CLAVE_INTERNA) headers["X-Clave-Interna"] = import.meta.env.AGENTE_CLAVE_INTERNA;
  if (request.method === "POST") headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(new URL(ruta, base.endsWith("/") ? base : `${base}/`), {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
      // La IA puede tardar varios segundos en usar herramientas y responder.
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return error(503, "El asistente no está disponible en este momento. Intenta más tarde.");
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
  });
};
