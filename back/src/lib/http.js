// Cliente HTTP para las APIs de terceros (PayPal, Mercado Libre, Banxico,
// Copomex). Agrega lo que fetch no trae de fábrica:
//   - tiempo límite (una API lenta no debe colgar una petición de la tienda);
//   - mensajes de error en español que dicen QUÉ servicio falló;
//   - el cuerpo de la respuesta de error, para depurar desde la consola.

export class ErrorDeServicio extends Error {
  constructor(servicio, mensaje, { status = null, cuerpo = null } = {}) {
    super(mensaje);
    this.name = "ErrorDeServicio";
    this.servicio = servicio;
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

/**
 * Hace una petición y regresa el JSON de la respuesta.
 * @param {string} servicio  nombre para los mensajes ("PayPal", "Banxico"...)
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} opciones
 */
export async function pedirJson(servicio, url, { timeoutMs = 8000, ...init } = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const vencio = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new ErrorDeServicio(
      servicio,
      vencio
        ? `${servicio} tardó demasiado en responder. Intenta de nuevo.`
        : `No hay conexión con ${servicio}. Intenta de nuevo en unos segundos.`
    );
  }

  const texto = await res.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = texto;
  }
  if (!res.ok) {
    throw new ErrorDeServicio(servicio, `${servicio} respondió con un error (${res.status}).`, {
      status: res.status,
      cuerpo,
    });
  }
  return cuerpo;
}

// Caché en memoria con vencimiento. Las APIs externas cobran o limitan por
// petición: lo que no cambia seguido (tipo de cambio, códigos postales,
// precios de la competencia) se guarda un rato.
export class CacheConVencimiento {
  constructor({ ms, maximo = 500 }) {
    this.ms = ms;
    this.maximo = maximo;
    this.mapa = new Map();
  }

  obtener(clave) {
    const entrada = this.mapa.get(clave);
    if (!entrada) return undefined;
    if (entrada.vence < Date.now()) {
      this.mapa.delete(clave);
      return undefined;
    }
    return entrada.valor;
  }

  guardar(clave, valor) {
    // Al llenarse se descarta la entrada más vieja (el Map conserva el orden).
    if (this.mapa.size >= this.maximo) this.mapa.delete(this.mapa.keys().next().value);
    this.mapa.set(clave, { valor, vence: Date.now() + this.ms });
    return valor;
  }

  limpiar() {
    this.mapa.clear();
  }
}

export const limpiarEnv = (valor) => valor?.trim() || null;
