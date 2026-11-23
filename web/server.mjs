// Servidor de producción de la web:  npm start  (después de npm run build)
//
// Astro genera el manejador SSR (adaptador @astrojs/node en modo middleware)
// y aquí se monta en Express con lo que el modo standalone no hace:
//  - compresión gzip/brotli de HTML, CSS y JS (React pasa de ~210 KB a ~65 KB);
//  - caché de un año para /_astro/* (los nombres llevan hash: nunca cambian);
//  - el service worker y el manifest sin caché, para que las actualizaciones
//    de la PWA lleguen de inmediato;
//  - precalentado de las imágenes de la página de inicio al arrancar.
import express from "express";
import compression from "compression";
import { fileURLToPath } from "node:url";
import { handler as ssr } from "./dist/server/entry.mjs";

const cliente = fileURLToPath(new URL("./dist/client/", import.meta.url));
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // Render pone la IP real en X-Forwarded-For
app.use(compression());

app.use("/_astro", express.static(`${cliente}_astro`, { immutable: true, maxAge: "1y", index: false }));
// assetlinks.json: lo verifica Android para abrir la app (TWA) sin barra de
// direcciones. express.static ignora las carpetas con punto, por eso va aparte.
app.use("/.well-known", express.static(`${cliente}.well-known`, { dotfiles: "allow", index: false, maxAge: "1h" }));
app.use(
  express.static(cliente, {
    index: false,
    maxAge: "1d",
    setHeaders(res, ruta) {
      if (/[\\/](sw\.js|manifest\.webmanifest)$/.test(ruta)) res.setHeader("Cache-Control", "no-cache");
    },
  })
);
app.use(ssr);

const puerto = Number(process.env.PORT ?? 4321);
const host = process.env.HOST ?? "0.0.0.0";
app.listen(puerto, host, () => {
  console.log(`VinyLink web en http://${host === "0.0.0.0" ? "localhost" : host}:${puerto}`);
  if (process.env.PRECALENTAR !== "0") precalentar(`http://127.0.0.1:${puerto}`);
});

// El optimizador de imágenes (/img) guarda en memoria lo que ya convirtió, y
// esa memoria se pierde al reiniciar (en Render pasa cada vez que el servicio
// se duerme). Al arrancar se piden las imágenes de la página de inicio para
// que el primer visitante no espere la descarga de la foto principal (LCP).
async function precalentar(base) {
  try {
    const html = await (await fetch(`${base}/`)).text();
    const urls = new Set(
      [...html.matchAll(/\/img\?u=[^"\s,]+/g)].map((m) => m[0].replaceAll("&amp;", "&"))
    );
    for (const ruta of urls) await fetch(base + ruta).then((r) => r.arrayBuffer()).catch(() => {});
    console.log(`Imágenes precalentadas: ${urls.size}`);
  } catch (error) {
    console.warn("No se pudieron precalentar las imágenes:", error.message);
  }
}
