// Formatos y nombres compartidos por la tienda y el panel admin.

// 1499 → "$1,499.00"
export const dinero = (n) =>
  Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

// Fechas en la hora de la Ciudad de México (el servidor puede estar en otra zona).
const ZONA = "America/Mexico_City";
export const fecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: ZONA }) : "—";
export const fechaHora = (iso) =>
  iso
    ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: ZONA })
    : "—";

export const ESTADOS_PEDIDO = {
  pendiente: "Esperando pago",
  pagado: "Pagado",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};

export const ESTADOS_PAGO = {
  pendiente: "Pendiente",
  requiere_accion: "Esperando al cliente",
  pagado: "Pagado",
  fallido: "Rechazado",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};

export const METODOS_PAGO = {
  credito: "Tarjeta de crédito",
  debito: "Tarjeta de débito",
  oxxo: "Efectivo en OXXO",
  spei: "Transferencia SPEI",
  link: "Link de pago",
  sin_registro: "Sin registro",
};

export const MARCAS_TARJETA = {
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
export const enGrupos = (texto) => String(texto ?? "").replace(/(.{4})(?=.)/g, "$1 ");

// Kárdex del inventario (movimiento_inventario.tipo).
export const TIPOS_MOVIMIENTO = {
  inicial: "Alta",
  entrada: "Entrada",
  ajuste: "Ajuste",
  venta: "Venta",
  cancelacion: "Cancelación",
  reembolso: "Reembolso",
};

export const TIPOS_CUPON = {
  porcentaje: "Porcentaje",
  monto: "Monto fijo",
  envio_gratis: "Envío gratis",
};

export const ESTADOS_CORREO = {
  pendiente: "Pendiente",
  enviado: "Enviado",
  simulado: "Simulado (sin SMTP)",
  error: "Error",
};

// "33 1234 5678" para mostrar un teléfono de 10 dígitos.
export const telefono = (t) => (/^\d{10}$/.test(t ?? "") ? t.replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3") : t ?? "—");
