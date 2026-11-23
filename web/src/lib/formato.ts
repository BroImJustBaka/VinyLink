// Formatos y nombres compartidos por la tienda y el panel admin.

// 1499 → "$1,499.00"
export const dinero = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

// Dólares (precio en USD con el tipo de cambio de Banxico): 49.5 → "US$49.50"
export const dolares = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }).replace(/^\$/, "US$");

// Fechas en la hora de la Ciudad de México (el servidor puede estar en otra zona).
const ZONA = "America/Mexico_City";
export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: ZONA }) : "—";
export const fechaHora = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: ZONA })
    : "—";

// Diccionarios de nombres: cualquier clave de texto → etiqueta.
type Nombres = Record<string, string>;

export const ESTADOS_PEDIDO: Nombres = {
  pendiente: "Esperando pago",
  pagado: "Pagado",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};

export const ESTADOS_PAGO: Nombres = {
  pendiente: "Pendiente",
  requiere_accion: "Esperando al cliente",
  pagado: "Pagado",
  fallido: "Rechazado",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};

export const METODOS_PAGO: Nombres = {
  credito: "Tarjeta de crédito",
  debito: "Tarjeta de débito",
  oxxo: "Efectivo en OXXO",
  spei: "Transferencia SPEI",
  link: "Link de pago",
  paypal: "PayPal",
  sin_registro: "Sin registro",
};

export const MARCAS_TARJETA: Nombres = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  carnet: "Carnet",
  discover: "Discover",
  jcb: "JCB",
  diners: "Diners Club",
  unionpay: "UnionPay",
};

// Referencias largas (ficha OXXO, CLABE) en grupos de 4 para leerlas fácil.
export const enGrupos = (texto: string | null | undefined) => String(texto ?? "").replace(/(.{4})(?=.)/g, "$1 ");

// Kárdex del inventario (movimiento_inventario.tipo).
export const TIPOS_MOVIMIENTO: Nombres = {
  inicial: "Alta",
  entrada: "Entrada",
  ajuste: "Ajuste",
  venta: "Venta",
  cancelacion: "Cancelación",
  reembolso: "Reembolso",
};

export const TIPOS_CUPON: Nombres = {
  porcentaje: "Porcentaje",
  monto: "Monto fijo",
  envio_gratis: "Envío gratis",
};

export const ESTADOS_CORREO: Nombres = {
  pendiente: "Pendiente",
  enviado: "Enviado",
  simulado: "Simulado (sin SMTP)",
  error: "Error",
};

// "33 1234 5678" para mostrar un teléfono de 10 dígitos.
export const telefono = (t: string | null | undefined) => (t && /^\d{10}$/.test(t) ? t.replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3") : t ?? "—");
