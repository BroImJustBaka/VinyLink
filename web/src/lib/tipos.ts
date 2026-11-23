// Tipos compartidos por las islas React y las librerías del navegador.
// Reflejan lo que responde la API GraphQL (back/src/modules/*/typeDefs.js).

export type Rol = "CLIENTE" | "ADMIN" | "ALMACEN" | "SOPORTE" | "FINANZAS";

export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  permisos: string[];
}

// Lo que necesita el modal de producto (llega en el atributo data-producto).
export interface ProductoVista {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  stock: number;
  imagen: string;
}

// Renglón del carrito local (localStorage).
export interface ItemCarrito {
  id: string;
  nombre: string;
  precio: number;
  imagen: string;
  cantidad: number;
}

export interface Direccion {
  nombre: string;
  telefono: string;
  calle: string;
  colonia: string;
  ciudad: string;
  estado: string;
  cp: string;
  referencias: string;
}

export interface DireccionGuardada extends Omit<Direccion, "referencias"> {
  id: string;
  referencias: string | null;
}

export interface ConfigPagos {
  habilitado: boolean;
  publishableKey: string | null;
  modoPrueba: boolean;
  minimo: number;
  maximoOxxo: number;
  paypalHabilitado: boolean;
}

export interface Cotizacion {
  subtotal: number;
  descuento: number;
  costoEnvio: number;
  iva: number;
  total: number;
  cupon: string | null;
  cuponDescripcion: string | null;
  errorCupon: string | null;
  faltaParaEnvioGratis: number;
}

export interface TipoCambio {
  valor: number;
  fecha: string;
  fuente: string;
}

export type MetodoPago = "credito" | "debito" | "oxxo" | "spei" | "link" | "paypal";

export interface DatosPago {
  metodo: MetodoPago;
  confirmationTokenId?: string;
  nombre?: string;
  email?: string;
}

export interface ResultadoPago {
  pedido: { id: string; estado: string; total: number };
  requiereAccion: boolean;
  clientSecret: string | null;
  urlAprobacion: string | null;
}

export interface EventoAdmin {
  tipo: string;
  mensaje: string;
  pedidoId: string | null;
  productoId: string | null;
  fecha: string;
}

// Mensaje de error legible de cualquier cosa que se lance.
export const mensajeDe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err ?? "Error desconocido");
