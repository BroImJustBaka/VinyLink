// Cupones de descuento. evaluarCupon() decide si un código aplica a una
// compra y cuánto descuenta. Lo usan la cotización del checkout (sin
// bloquear) y crearPedidoPendiente (bloqueando la fila del cupón, para que
// dos compras al mismo tiempo no rebasen su límite de usos).
//
// Los usos no se guardan en un contador: se cuentan los pedidos que lo
// usaron y no se cancelaron. Así un pedido cancelado "devuelve" su uso solo.
import { pool } from "../../db.js";

export const TIPOS_CUPON = ["porcentaje", "monto", "envio_gratis"];

export const normalizarCodigo = (codigo) => String(codigo ?? "").trim().toUpperCase();

const pesos = (centavos) =>
  (centavos / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

const SIN_CUPON = { cupon: null, descuentoCentavos: 0, envioGratis: false };

export async function evaluarCupon(client = pool, { codigo, usuarioId, subtotalCentavos, bloquear = false }) {
  const cod = normalizarCodigo(codigo);
  if (!cod) return SIN_CUPON;

  const { rows } = await client.query(
    `SELECT * FROM cupon WHERE codigo = $1 ${bloquear ? "FOR UPDATE" : ""}`,
    [cod]
  );
  const cupon = rows[0];
  if (!cupon || !cupon.activo) throw new Error(`El cupón "${cod}" no existe o ya no está activo`);

  const ahora = new Date();
  if (cupon.vigente_desde && ahora < cupon.vigente_desde) throw new Error(`El cupón "${cod}" todavía no está vigente`);
  if (cupon.vigente_hasta && ahora > cupon.vigente_hasta) throw new Error(`El cupón "${cod}" ya venció`);

  const minimo = Math.round(cupon.minimo_compra * 100);
  if (subtotalCentavos < minimo) {
    throw new Error(`El cupón "${cod}" aplica en compras desde ${pesos(minimo)}`);
  }

  if (cupon.usos_maximos || cupon.usos_por_cliente) {
    const { rows: usos } = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE usuario_id = $2)::int AS del_cliente
         FROM pedido
        WHERE cupon_id = $1 AND estado <> 'cancelado'`,
      [cupon.id, usuarioId ?? null]
    );
    if (cupon.usos_maximos && usos[0].total >= cupon.usos_maximos) {
      throw new Error(`El cupón "${cod}" ya se agotó`);
    }
    if (cupon.usos_por_cliente && usuarioId && usos[0].del_cliente >= cupon.usos_por_cliente) {
      throw new Error(`Ya usaste el cupón "${cod}" las veces permitidas`);
    }
  }

  let descuentoCentavos = 0;
  if (cupon.tipo === "porcentaje") {
    descuentoCentavos = Math.round((subtotalCentavos * Math.min(cupon.valor, 100)) / 100);
  } else if (cupon.tipo === "monto") {
    descuentoCentavos = Math.min(Math.round(cupon.valor * 100), subtotalCentavos);
  }
  return { cupon, descuentoCentavos, envioGratis: cupon.tipo === "envio_gratis" };
}

// Revisa y limpia los datos de un cupón antes de guardarlo (panel admin).
export function validarCupon(data) {
  const limpio = {
    codigo: normalizarCodigo(data.codigo),
    descripcion: data.descripcion?.trim() || null,
    tipo: data.tipo,
    valor: Number(data.valor ?? 0),
    minimoCompra: Number(data.minimoCompra ?? 0),
    usosMaximos: data.usosMaximos || null,
    usosPorCliente: data.usosPorCliente || null,
    vigenteDesde: data.vigenteDesde || null,
    vigenteHasta: data.vigenteHasta || null,
    activo: data.activo ?? true,
  };
  if (!/^[A-Z0-9_-]{3,30}$/.test(limpio.codigo)) {
    throw new Error("El código debe tener de 3 a 30 letras, números, guiones o guiones bajos (sin espacios)");
  }
  if (!TIPOS_CUPON.includes(limpio.tipo)) throw new Error("Elige un tipo de cupón válido");
  if (!Number.isFinite(limpio.valor) || limpio.valor < 0) throw new Error("El valor no puede ser negativo");
  if (limpio.tipo === "porcentaje" && (limpio.valor <= 0 || limpio.valor > 100)) {
    throw new Error("El porcentaje debe ser de 1 a 100");
  }
  if (limpio.tipo === "monto" && limpio.valor <= 0) throw new Error("El monto de descuento debe ser mayor a 0");
  if (limpio.tipo === "envio_gratis") limpio.valor = 0;
  if (!Number.isFinite(limpio.minimoCompra) || limpio.minimoCompra < 0) {
    throw new Error("La compra mínima no puede ser negativa");
  }
  for (const campo of ["usosMaximos", "usosPorCliente"]) {
    if (limpio[campo] !== null && (!Number.isInteger(limpio[campo]) || limpio[campo] < 1)) {
      throw new Error("Los límites de uso deben ser enteros mayores a 0 (o vacíos para ilimitado)");
    }
  }
  for (const campo of ["vigenteDesde", "vigenteHasta"]) {
    if (limpio[campo] && Number.isNaN(new Date(limpio[campo]).getTime())) throw new Error("Fecha de vigencia inválida");
  }
  if (limpio.vigenteDesde && limpio.vigenteHasta && new Date(limpio.vigenteDesde) > new Date(limpio.vigenteHasta)) {
    throw new Error("La vigencia termina antes de empezar");
  }
  return limpio;
}
