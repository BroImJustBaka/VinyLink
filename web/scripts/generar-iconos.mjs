// Genera los íconos PNG de la PWA a partir del diseño vectorial del disco.
//   node scripts/generar-iconos.mjs
// - icono-192.png / icono-512.png: "any" (disco con fondo transparente)
// - icono-maskable-512.png: fondo crema a sangre y disco dentro de la zona
//   segura (80 %), para que Android lo recorte en círculo o squircle sin perderlo.
// - apple-touch-icon.png (180): iOS no admite transparencia.
// - Recursos de la app Android (../android): íconos por densidad, capa
//   frontal del ícono adaptativo (disco dentro de la zona segura de 66/108 dp)
//   y la imagen del splash.
import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";

const CREMA = "#f3ebdd";
const disco = await readFile(new URL("../public/favicon.svg", import.meta.url));
const salida = new URL("../public/iconos/", import.meta.url);
await mkdir(salida, { recursive: true });

async function conFondo(tamano, escala, nombre) {
  const interior = Math.round(tamano * escala);
  const png = await sharp(disco, { density: 512 }).resize(interior, interior).png().toBuffer();
  await sharp({ create: { width: tamano, height: tamano, channels: 4, background: CREMA } })
    .composite([{ input: png, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(new URL(nombre, salida).pathname.replace(/^\/([A-Z]:)/, "$1"));
}

for (const tamano of [192, 512]) {
  await sharp(disco, { density: 512 })
    .resize(tamano, tamano)
    .png({ compressionLevel: 9 })
    .toFile(new URL(`icono-${tamano}.png`, salida).pathname.replace(/^\/([A-Z]:)/, "$1"));
}
await conFondo(512, 0.72, "icono-maskable-512.png");
await conFondo(180, 0.86, "apple-touch-icon.png");
// ---- App Android (Trusted Web Activity) ----
const res = new URL("../../android/app/src/main/res/", import.meta.url);
const ruta = (url) => url.pathname.replace(/^\/([A-Z]:)/, "$1");
async function pngAndroid(carpeta, nombre, tamano, escala, fondo) {
  const dir = new URL(`${carpeta}/`, res);
  await mkdir(dir, { recursive: true });
  const interior = Math.round(tamano * escala);
  const png = await sharp(disco, { density: 512 }).resize(interior, interior).png().toBuffer();
  await sharp({ create: { width: tamano, height: tamano, channels: 4, background: fondo } })
    .composite([{ input: png, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(ruta(new URL(nombre, dir)));
}
const TRANSPARENTE = { r: 0, g: 0, b: 0, alpha: 0 };
const DENSIDADES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [densidad, factor] of Object.entries(DENSIDADES)) {
  await pngAndroid(`mipmap-${densidad}`, "ic_launcher.png", 48 * factor, 0.84, CREMA);
  await pngAndroid(`mipmap-${densidad}`, "ic_launcher_foreground.png", 108 * factor, 0.58, TRANSPARENTE);
}
await pngAndroid("drawable", "splash.png", 384, 1, TRANSPARENTE);
console.log("Íconos generados en public/iconos/ y en android/app/src/main/res/");
