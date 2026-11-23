// Cliente del navegador para el microservicio del asistente y las reseñas.
// Todo pasa por el proxy /api/agente/* (mismo origen), que agrega la sesión.

export interface ProductoSugerido {
  id: string;
  nombre: string;
  precio: number;
  stock: number;
  imagen: string;
}

export interface RespuestaChat {
  conversacionId: string;
  respuesta: string;
  productos: ProductoSugerido[];
}

export interface MensajeChat {
  rol: "cliente" | "asistente";
  texto: string;
  productos?: ProductoSugerido[];
}

export interface Resena {
  id: string;
  autor: string;
  calificacion: number;
  titulo: string;
  texto: string;
  compraVerificada: boolean;
  fecha: string;
  esMia: boolean;
}

export interface Resenas {
  promedio: number | null;
  total: number;
  porEstrella: Record<"1" | "2" | "3" | "4" | "5", number>;
  resenas: Resena[];
}

export interface NuevaResena {
  calificacion: number;
  titulo: string;
  texto: string;
}

export class ErrorAgente extends Error {
  constructor(
    mensaje: string,
    readonly status: number
  ) {
    super(mensaje);
  }
}

// FastAPI responde los errores como {detail: "texto"} o, si falla la
// validación, {detail: [{msg, loc}]}.
function mensajeDeDetalle(detalle: unknown, status: number): string {
  if (typeof detalle === "string") return detalle;
  if (Array.isArray(detalle) && detalle[0]?.msg) return "Revisa los datos: " + String(detalle[0].msg);
  return status >= 500 ? "El asistente no está disponible en este momento." : `Error ${status}`;
}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/agente/${ruta}`, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ErrorAgente("No hay conexión. Revisa tu internet e intenta de nuevo.", 0);
  }
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) throw new ErrorAgente(mensajeDeDetalle(cuerpo?.detail, res.status), res.status);
  return cuerpo as T;
}

export const enviarMensaje = (mensaje: string, conversacionId: string | null) =>
  pedir<RespuestaChat>("chat", { method: "POST", body: JSON.stringify({ mensaje, conversacionId }) });

export const verConversacion = (id: string) =>
  pedir<{ conversacionId: string; mensajes: MensajeChat[] }>(`chat/${encodeURIComponent(id)}`);

export const verResenas = (productoId: string) => pedir<Resenas>(`productos/${productoId}/resenas`);

export const guardarResena = (productoId: string, datos: NuevaResena) =>
  pedir<Resenas>(`productos/${productoId}/resenas`, { method: "POST", body: JSON.stringify(datos) });

export const borrarResena = (productoId: string) =>
  pedir<Resenas>(`productos/${productoId}/resenas/mia`, { method: "DELETE" });
