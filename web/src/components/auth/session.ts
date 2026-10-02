// Dueño: Persona C. Utilidades compartidas por /login y /registro.
import type { AstroCookies } from "astro";
import { SESSION_COOKIE } from "../../lib/graphql";

const SIETE_DIAS = 60 * 60 * 24 * 7; // igual que DURACION_DIAS en back/.../context.js

// Guarda el token como cookie `sid`. httpOnly: el JS del navegador no la ve,
// solo el servidor de Astro la reenvía al backend como Authorization: Bearer.
export function guardarSesion(cookies: AstroCookies, token: string) {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: import.meta.env.PROD,
    path: "/",
    maxAge: SIETE_DIAS,
  });
}

// `?next=` solo puede apuntar a rutas internas (evita open redirect).
export function destinoSeguro(next: string | null | undefined, porDefecto = "/perfil") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return porDefecto;
  }
  return next;
}
