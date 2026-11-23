// Optimizador de imágenes:  /img?u=<url de la imagen>&w=<ancho>[&h=<alto>]
//
// Las imágenes del catálogo son URLs de otros sitios (las captura el admin).
// Servirlas tal cual hacía la tienda lenta (fotos de 600 KB para una
// miniatura) y traía cookies de terceros. Este endpoint las descarga en el
// servidor, las recorta al tamaño que se muestra, las convierte a WebP y las
// sirve con caché larga desde nuestro dominio.
//
// Seguridad (es un "fetch a cualquier URL"):
//  - solo http/https, sin usuario/contraseña en la URL;
//  - se resuelve el DNS y se rechazan IPs privadas, locales o reservadas
//    (evita usarlo para entrar a la red interna del servidor: SSRF);
//  - sin seguir redirecciones, con tiempo límite y tamaño máximo;
//  - solo anchos de una lista fija (no se puede pedir un render enorme).
import type { APIRoute } from "astro";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { ANCHOS } from "../lib/imagen.ts";

const MAXIMO_BYTES = 10 * 1024 * 1024;
const TIEMPO_LIMITE_MS = 6000;
const INTENTOS = 2; // un reintento: algunos CDN fallan de forma intermitente
const CACHE_MAXIMO = 300;
const cache = new Map<string, Uint8Array>();
// Los tamaños de una misma foto (600, 840, 1280...) se piden casi a la vez:
// comparten una sola descarga del original.
const enCurso = new Map<string, Promise<Buffer | null>>();
// Una foto que falló se recuerda un minuto para no hacer esperar a cada
// petición el tiempo límite completo.
const FALLIDA_MS = 60_000;
const fallidas = new Map<string, number>();

function ipPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return ipPrivada(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function urlPermitida(texto: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const direcciones = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (direcciones.length === 0 || direcciones.some((d) => ipPrivada(d.address))) return null;
  return url;
}

async function descargar(url: URL): Promise<Buffer | null> {
  for (let intento = 1; ; intento++) {
    try {
      return await descargarUnaVez(url);
    } catch (error) {
      // Solo se reintentan fallas de red o de tiempo; una respuesta mala no.
      if (intento >= INTENTOS) throw error;
    }
  }
}

async function descargarUnaVez(url: URL): Promise<Buffer | null> {
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    headers: { "User-Agent": "VinyLink-Imagenes/1.0", Accept: "image/avif,image/webp,image/*" },
  });
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAXIMO_BYTES) return null;
  const partes: Uint8Array[] = [];
  let total = 0;
  for await (const parte of res.body) {
    total += parte.byteLength;
    if (total > MAXIMO_BYTES) return null;
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

const respuesta = (cuerpo: Uint8Array) =>
  new Response(cuerpo as BodyInit, {
    headers: {
      "Content-Type": "image/webp",
      // La URL incluye la imagen original y el tamaño: si cambia, cambia la URL.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });

export const GET: APIRoute = async ({ url }) => {
  const origen = url.searchParams.get("u") ?? "";
  const ancho = Number(url.searchParams.get("w"));
  const alto = url.searchParams.has("h") ? Number(url.searchParams.get("h")) : null;
  if (!origen || !ANCHOS.includes(ancho) || (alto !== null && !(alto > 0 && alto <= ancho * 2))) {
    return new Response("Parámetros no válidos", { status: 400 });
  }

  const clave = `${ancho}x${alto ?? ""}|${origen}`;
  const guardada = cache.get(clave);
  if (guardada) {
    cache.delete(clave); // LRU: vuelve al final
    cache.set(clave, guardada);
    return respuesta(guardada);
  }

  const destino = await urlPermitida(origen);
  if (!destino) return new Response("Imagen no permitida", { status: 400 });
  if ((fallidas.get(destino.href) ?? 0) > Date.now()) return marcador(ancho, alto ?? ancho);
  try {
    let descarga = enCurso.get(destino.href);
    if (!descarga) {
      descarga = descargar(destino).finally(() => enCurso.delete(destino.href));
      enCurso.set(destino.href, descarga);
    }
    const original = await descarga;
    if (!original) throw new Error("sin imagen");
    const webp = await sharp(original, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(ancho, alto ?? undefined, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 74, effort: 4 })
      .toBuffer();
    const bytes = new Uint8Array(webp);
    cache.set(clave, bytes);
    if (cache.size > CACHE_MAXIMO) cache.delete(cache.keys().next().value!);
    return respuesta(bytes);
  } catch (error) {
    fallidas.set(destino.href, Date.now() + FALLIDA_MS);
    if (fallidas.size > CACHE_MAXIMO) fallidas.delete(fallidas.keys().next().value!);
    console.warn(`/img: no se pudo optimizar ${destino.href}:`, (error as Error).cause ?? (error as Error).message);
    // Si el sitio original falla (caído, certificado inválido, no es imagen...)
    // se responde un recuadro neutro desde nuestro dominio: el navegador nunca
    // contacta al tercero y no hay errores en consola. Sin caché: la próxima
    // visita vuelve a intentar con la imagen real.
    return marcador(ancho, alto ?? ancho);
  }
};

const marcador = (ancho: number, alto: number) =>
  new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">` +
      `<rect width="100%" height="100%" fill="#e9e4dc"/>` +
      `<circle cx="50%" cy="50%" r="${Math.round(Math.min(ancho, alto) / 5)}" fill="#cfc6b8"/></svg>`,
    {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
