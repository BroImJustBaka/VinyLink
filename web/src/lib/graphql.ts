// Archivo compartido (contrato). Dos formas de hablar con el backend:
//
//  - En páginas .astro / middleware (servidor):
//      const data = await graphqlServer(Astro.cookies, QUERY, vars)
//    Llama directo al backend y reenvía la cookie de sesión como
//    `Authorization: Bearer <sid>`.
//
//  - En islas React (navegador):
//      const data = await graphqlClient(QUERY, vars)
//    Llama a /api/graphql (mismo origen), que reenvía la petición al backend
//    agregando la sesión. Así la cookie puede ser httpOnly.
import type { AstroCookies } from "astro";

export const SESSION_COOKIE = "sid";

async function parse(res: Response) {
  if (!res.ok) throw new Error(`Error de red (${res.status}) al contactar el servidor`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors[0].message);
  return data;
}

export async function graphqlServer(
  cookies: AstroCookies,
  query: string,
  variables: Record<string, unknown> = {}
) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const res = await fetch(import.meta.env.GRAPHQL_URL ?? "http://localhost:4000/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return parse(res);
}

export async function graphqlClient(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch("/api/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return parse(res);
}
