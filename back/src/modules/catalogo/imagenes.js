// Imágenes subidas desde el panel (tabla `imagen`, columna BYTEA).
//
//   subida:  mutación subirImagen(nombre, tipo, base64) → guardarImagen()
//   lectura: GET /imagenes/:id → servirImagen() (ruta de Express)
//
// El frontend reenvía /imagenes/:id al backend, así la URL pública de la
// imagen vive en el mismo dominio de la tienda (WEB_URL).
import { one } from "../../lib/sql.js";
import { WEB_URL } from "../pagos/stripe.js";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Los primeros bytes ("firma") de cada formato. No basta con confiar en el
// tipo que dice el navegador: se revisa que el archivo de verdad sea esa imagen.
const FIRMAS = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/gif": (b) => b.subarray(0, 4).toString("ascii") === "GIF8",
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

export async function guardarImagen({ nombre, tipo, base64, usuarioId }) {
  const firma = FIRMAS[tipo];
  if (!firma) throw new Error("Solo se aceptan imágenes JPG, PNG, WebP o GIF");
  // Acepta también un "data URL" completo (data:image/png;base64,....).
  const datos = Buffer.from(String(base64).replace(/^data:[^,]*,/, ""), "base64");
  if (datos.length === 0) throw new Error("La imagen está vacía");
  if (datos.length > MAX_BYTES) throw new Error("La imagen pesa más de 5 MB");
  if (!firma(datos)) throw new Error("El archivo no es una imagen válida del tipo indicado");

  const nombreLimpio = String(nombre ?? "imagen").replace(/[^\w.\- ]/g, "").slice(0, 120) || "imagen";
  const fila = await one(
    "INSERT INTO imagen (nombre, tipo, bytes, datos, usuario_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, bytes",
    [nombreLimpio, tipo, datos.length, datos, usuarioId]
  );
  return { id: fila.id, bytes: fila.bytes, url: `${WEB_URL}/imagenes/${fila.id}` };
}

// GET /imagenes/:id — una imagen nunca cambia (subir otra crea otro id),
// así que el navegador la puede guardar en caché por un año.
export async function servirImagen(req, res) {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).send("No existe");
  try {
    const img = await one("SELECT tipo, datos FROM imagen WHERE id = $1", [req.params.id]);
    if (!img) return res.status(404).send("No existe");
    res.set({
      "Content-Type": img.tipo,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(img.datos);
  } catch (err) {
    console.error("Error sirviendo la imagen", req.params.id, err.message);
    res.status(500).send("Error");
  }
}
