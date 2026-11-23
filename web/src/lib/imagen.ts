// URLs de imágenes optimizadas (ver src/pages/img.ts).
//
//   imagen(url, 300)        → miniatura cuadrada de 300×300 en WebP
//   imagen(url, 1280, 520)  → recorte de 1280×520 (fondo del hero)
//   srcsetDe(url, [200, 400]) → "…&w=200 200w, …&w=400 400w"
//
// Las imágenes que ya son de la tienda (/imagenes/…) o vacías se dejan igual.

export const ANCHOS = [64, 96, 128, 200, 300, 400, 420, 600, 840, 1280];

const optimizable = (src: string | null | undefined): src is string => !!src && /^https?:\/\//i.test(src);

export function imagen(src: string, ancho: number, alto: number | null = ancho): string {
  if (!optimizable(src)) return src;
  const params = new URLSearchParams({ u: src, w: String(ancho) });
  if (alto !== null) params.set("h", String(alto));
  return `/img?${params}`;
}

export function srcsetDe(src: string, anchos: number[], cuadrada = true): string | undefined {
  if (!optimizable(src)) return undefined;
  return anchos.map((w) => `${imagen(src, w, cuadrada ? w : null)} ${w}w`).join(", ");
}
