// Service worker de VinyLink (PWA).
//
// Estrategias:
//  - /_astro/* (JS y CSS con hash en el nombre, nunca cambian): primero caché.
//  - Íconos, fuentes, /imagenes/* y fotos del catálogo (/img): caché y se
//    actualiza en segundo plano (así el catálogo visto se ve sin conexión).
//  - Páginas (navegación): siempre a la red, porque los precios, el stock y
//    la sesión cambian; si no hay conexión se muestra /offline.html.
//  - Nunca se guardan /api/*, el panel, el checkout, pedidos ni el perfil:
//    son datos personales o que deben estar al día.
const VERSION = "vinylink-v2";
const ESTATICOS = `${VERSION}-estaticos`;
const MEDIOS = `${VERSION}-medios`;
const PRECARGA = [
  "/offline.html",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/iconos/icono-192.png",
  "/iconos/icono-512.png",
];
const MAXIMO_MEDIOS = 80;
const PRIVADAS = /^\/(api|admin|checkout|pedido|perfil|logout|login|registro|olvide|restablecer|pago)(\/|$)/;

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(ESTATICOS)
      .then((cache) => cache.addAll(PRECARGA))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function recortar(nombre, maximo) {
  const cache = await caches.open(nombre);
  const llaves = await cache.keys();
  for (const llave of llaves.slice(0, Math.max(0, llaves.length - maximo))) await cache.delete(llave);
}

async function primeroCache(peticion) {
  const guardada = await caches.match(peticion);
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  if (respuesta.ok) (await caches.open(ESTATICOS)).put(peticion, respuesta.clone());
  return respuesta;
}

async function cacheYActualiza(peticion) {
  const cache = await caches.open(MEDIOS);
  const guardada = await cache.match(peticion);
  const deRed = fetch(peticion)
    .then((respuesta) => {
      // "no-store" = recuadro de respaldo de /img: no se guarda.
      if (respuesta.ok && !/no-store/.test(respuesta.headers.get("Cache-Control") ?? ""))
        cache.put(peticion, respuesta.clone()).then(() => recortar(MEDIOS, MAXIMO_MEDIOS));
      return respuesta;
    })
    .catch(() => guardada);
  return guardada ?? deRed;
}

async function paginaConRespaldo(peticion) {
  try {
    return await fetch(peticion);
  } catch {
    return (await caches.match("/offline.html")) ?? Response.error();
  }
}

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  if (peticion.mode === "navigate") {
    evento.respondWith(paginaConRespaldo(peticion));
    return;
  }
  if (PRIVADAS.test(url.pathname)) return;
  if (url.pathname.startsWith("/_astro/")) {
    evento.respondWith(primeroCache(peticion));
    return;
  }
  if (url.pathname === "/img" || url.pathname.startsWith("/imagenes/") || url.pathname.startsWith("/iconos/") || /\.(woff2|svg|png|webp)$/.test(url.pathname)) {
    evento.respondWith(cacheYActualiza(peticion));
  }
});
