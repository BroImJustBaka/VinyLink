// Dueño: Persona B (carrito y pedidos)
//
// Inventario y totales de los pedidos. Lo usan los pagos (al crear un pedido
// se aparta el stock) y la cancelación o el reembolso (se devuelve). Cada
// cambio de stock pasa por moverStock() para quedar en el kárdex.
import { pool } from "../../db.js";
import { transaccion } from "../../lib/sql.js";
import { publicarPedido, publicarEventoAdmin } from "../../lib/pubsub.js";
import { moverStock, devolverPiezasDePedido } from "../inventario/servicio.js";
import { evaluarCupon } from "../cupones/servicio.js";
import { costoEnvioCentavos } from "../configuracion/servicio.js";

export const ES_ID = /^\d+$/;

// Precio en centavos (entero). Stripe cobra en centavos y así las sumas no
// arrastran errores de punto flotante (0.1 + 0.2 = 0.30000000000000004).
export const aCentavos = (pesos) => Math.round(Number(pesos) * 100);

export function validarCantidad(cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error("La cantidad debe ser un entero mayor a 0");
  }
}

// Junta renglones repetidos del mismo producto (suma sus cantidades).
export function agruparItems(items) {
  const mapa = new Map();
  for (const { productoId, cantidad } of items) {
    validarCantidad(cantidad);
    const clave = String(productoId);
    mapa.set(clave, (mapa.get(clave) ?? 0) + cantidad);
  }
  return [...mapa].map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

// Revisa y limpia la dirección de envío. Regresa el objeto que se guarda
// (copia) en pedido.envio y en la libreta de direcciones.
export function validarDireccion(d) {
  const t = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
  const dir = {
    nombre: t(d?.nombre),
    telefono: String(d?.telefono ?? "").replace(/\D/g, ""),
    calle: t(d?.calle),
    colonia: t(d?.colonia),
    ciudad: t(d?.ciudad),
    estado: t(d?.estado),
    cp: String(d?.cp ?? "").trim(),
    referencias: t(d?.referencias) || null,
  };
  if (dir.nombre.length < 3) throw new Error("Envío: escribe el nombre de quien recibe");
  if (!/^\d{10}$/.test(dir.telefono)) throw new Error("Envío: el teléfono debe tener 10 dígitos");
  if (dir.calle.length < 3) throw new Error("Envío: escribe la calle y el número");
  if (dir.colonia.length < 2) throw new Error("Envío: escribe la colonia");
  if (dir.ciudad.length < 2) throw new Error("Envío: escribe la ciudad o municipio");
  if (dir.estado.length < 2) throw new Error("Envío: escribe el estado");
  if (!/^\d{5}$/.test(dir.cp)) throw new Error("Envío: el código postal debe tener 5 dígitos");
  for (const v of Object.values(dir)) {
    if (v && v.length > 200) throw new Error("Envío: algún campo es demasiado largo");
  }
  return dir;
}

// Lee los productos de los renglones. Con `bloquear` los toma con FOR UPDATE
// (en orden de id, para evitar interbloqueos). Exige que estén a la venta y
// que alcance el stock.
export async function leerRenglones(client, items, { bloquear = false } = {}) {
  if (!items || items.length === 0) {
    throw new Error("El pedido necesita al menos un producto");
  }
  const agrupados = agruparItems(items);
  const ordenados = [...agrupados].sort((a, b) => Number(a.productoId) - Number(b.productoId));
  const renglones = [];
  for (const { productoId, cantidad } of ordenados) {
    if (!ES_ID.test(String(productoId))) {
      throw new Error(`No existe el producto con id ${productoId}`);
    }
    const { rows } = await client.query(
      `SELECT * FROM producto WHERE id = $1 ${bloquear ? "FOR UPDATE" : ""}`,
      [productoId]
    );
    const producto = rows[0];
    if (!producto) throw new Error(`No existe el producto con id ${productoId}`);
    if (!producto.activo) throw new Error(`"${producto.nombre}" ya no está a la venta`);
    if (producto.stock < cantidad) {
      throw new Error(`Stock insuficiente para "${producto.nombre}"`);
    }
    renglones.push({ producto, cantidad, centavos: aCentavos(producto.precio) });
  }
  return renglones;
}

// Desglose del pedido en centavos. Lo usan la cotización del checkout y
// crearPedidoPendiente, así el total que ve el cliente es el que se cobra.
//   total = subtotal - descuento + envío
export async function calcularTotales(client, { usuarioId, renglones, cupon, bloquear = false }) {
  const subtotalCentavos = renglones.reduce((acc, r) => acc + r.centavos * r.cantidad, 0);
  const c = await evaluarCupon(client, { codigo: cupon, usuarioId, subtotalCentavos, bloquear });
  const base = subtotalCentavos - c.descuentoCentavos;
  const envioCentavos = await costoEnvioCentavos(base, { envioGratis: c.envioGratis });
  return {
    subtotalCentavos,
    descuentoCentavos: c.descuentoCentavos,
    envioCentavos,
    totalCentavos: base + envioCentavos,
    cupon: c.cupon,
  };
}

// Deja constancia de un cambio de estado en la línea de tiempo del pedido.
// usuarioId = null significa que lo hizo el sistema (Stripe, la revisión de vencimientos).
export async function registrarHistorial(client, pedidoId, anterior, nuevo, usuarioId = null, comentario = null) {
  await client.query(
    `INSERT INTO historial_pedido (pedido_id, estado_anterior, estado_nuevo, usuario_id, comentario)
     VALUES ($1, $2, $3, $4, $5)`,
    [pedidoId, anterior, nuevo, usuarioId, comentario]
  );
}

const pesos = (centavos) =>
  (centavos / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

// Crea un pedido "pendiente" con su renglón en la tabla `pago` y aparta el
// stock, todo en una transacción. `validarTotal(totalCentavos)` deja que el
// método de pago rechace montos que no acepta (por ejemplo, OXXO > $10,000).
// `cupon` (código) y `envio` (dirección) son opcionales.
export async function crearPedidoPendiente({ usuarioId, items, metodo, validarTotal, cupon = null, envio = null }) {
  const direccion = envio ? validarDireccion(envio) : null;

  return transaccion(async (client) => {
    // Bloquea los productos y valida el stock de todos ANTES de escribir nada.
    const renglones = await leerRenglones(client, items, { bloquear: true });
    const totales = await calcularTotales(client, { usuarioId, renglones, cupon, bloquear: true });
    validarTotal?.(totales.totalCentavos);

    const { rows: pedidoRows } = await client.query(
      `INSERT INTO pedido (total, subtotal, descuento, costo_envio, cupon_id, envio, usuario_id, estado, metodo_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', $8) RETURNING *`,
      [
        totales.totalCentavos / 100,
        totales.subtotalCentavos / 100,
        totales.descuentoCentavos / 100,
        totales.envioCentavos / 100,
        totales.cupon?.id ?? null,
        direccion ? JSON.stringify(direccion) : null,
        usuarioId,
        metodo,
      ]
    );
    const pedido = pedidoRows[0];

    for (const { producto, cantidad, centavos } of renglones) {
      await client.query(
        `INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [pedido.id, producto.id, cantidad, centavos / 100]
      );
      await moverStock(client, {
        productoId: producto.id,
        cantidad: -cantidad,
        tipo: "venta",
        pedidoId: pedido.id,
        usuarioId,
        motivo: `Apartado para el pedido #${pedido.id}`,
      });
    }

    await client.query(
      "INSERT INTO pago (pedido_id, metodo, monto_centavos) VALUES ($1, $2, $3)",
      [pedido.id, metodo, totales.totalCentavos]
    );
    await registrarHistorial(client, pedido.id, null, "pendiente", usuarioId, "Pedido creado");

    client.alConfirmar(async () => {
      await publicarPedido(pedido.id);
      await publicarEventoAdmin({
        tipo: "pedido_nuevo",
        mensaje: `Pedido nuevo #${pedido.id} por ${pesos(totales.totalCentavos)}`,
        pedidoId: pedido.id,
      });
    });

    return { pedido, renglones, totalCentavos: totales.totalCentavos, totales };
  });
}

// Regresa al inventario las piezas de un pedido. Recibe el `client` de una
// transacción para que se haga junto con el cambio de estado del pedido.
// tipo: "cancelacion" o "reembolso" (así queda en el kárdex).
export async function devolverStock(client, pedidoId, tipo = "cancelacion", usuarioId = null) {
  await devolverPiezasDePedido(client, pedidoId, tipo, usuarioId);
}

// Vuelve a apartar el stock de un pedido que se había cancelado y que al final
// sí se pagó (por ejemplo, una ficha OXXO pagada a última hora). Si ya no
// alcanza para algún producto no toca nada y regresa false.
export async function volverAApartarStock(client, pedidoId) {
  const { rows } = await client.query(
    `SELECT p.id, p.stock, SUM(d.cantidad)::int AS cantidad
       FROM detalle_pedido d JOIN producto p ON p.id = d.producto_id
      WHERE d.pedido_id = $1
      GROUP BY p.id
      ORDER BY p.id`,
    [pedidoId]
  );
  // Bloquea los productos (en orden de id) antes de revisar el stock.
  for (const r of rows) {
    const { rows: actual } = await client.query("SELECT stock FROM producto WHERE id = $1 FOR UPDATE", [r.id]);
    r.stock = actual[0].stock;
  }
  if (rows.some((r) => r.stock < r.cantidad)) return false;
  for (const r of rows) {
    await moverStock(client, {
      productoId: r.id,
      cantidad: -r.cantidad,
      tipo: "venta",
      pedidoId,
      motivo: `Pedido #${pedidoId} pagado después de cancelarse`,
    });
  }
  return true;
}

// Vacía el carrito guardado en la base de datos (el pedido ya lo "consumió").
export async function vaciarCarrito(usuarioId, client = pool) {
  await client.query(
    "DELETE FROM detalle_carrito WHERE carrito_id IN (SELECT id FROM carrito WHERE usuario_id = $1)",
    [usuarioId]
  );
}

// Guarda una dirección en la libreta del cliente, salvo que ya tenga una igual.
export async function guardarEnLibreta(usuarioId, direccion, client = pool) {
  const d = validarDireccion(direccion);
  const { rows } = await client.query(
    `SELECT id FROM direccion
      WHERE usuario_id = $1 AND lower(calle) = lower($2) AND cp = $3 AND lower(nombre) = lower($4)`,
    [usuarioId, d.calle, d.cp, d.nombre]
  );
  if (rows[0]) return rows[0].id;
  const { rows: nueva } = await client.query(
    `INSERT INTO direccion (usuario_id, nombre, telefono, calle, colonia, ciudad, estado, cp, referencias)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [usuarioId, d.nombre, d.telefono, d.calle, d.colonia, d.ciudad, d.estado, d.cp, d.referencias]
  );
  return nueva[0].id;
}
