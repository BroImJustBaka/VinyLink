// Reportes en CSV para descargar desde el panel (se abren en Excel o Sheets).
//
// Detalles que importan:
//  - BOM (﻿) al inicio: sin él, Excel abre los acentos como "Ã¡".
//  - Campos con coma, comillas o saltos de línea van entre comillas.
//  - "Inyección CSV": una celda que empieza con = + - @ Excel la ejecuta como
//    fórmula. Un cliente podría llamarse "=HYPERLINK(...)"; por eso a esos
//    textos se les antepone un apóstrofo.
import { many } from "../../lib/sql.js";

const TIPOS = ["pedidos", "productos", "clientes", "movimientos", "ventas_dia"];

function celda(valor) {
  if (valor == null) return "";
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "number") return String(valor);
  let t = String(valor);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const csv = (encabezados, filas) =>
  "﻿" + [encabezados, ...filas].map((f) => f.map(celda).join(",")).join("\r\n") + "\r\n";

// desde/hasta en AAAA-MM-DD (hora de la Ciudad de México). hasta es inclusivo.
function rango(desde, hasta) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if (desde && !fecha.test(desde)) throw new Error("La fecha 'desde' debe tener formato AAAA-MM-DD");
  if (hasta && !fecha.test(hasta)) throw new Error("La fecha 'hasta' debe tener formato AAAA-MM-DD");
  return [desde || null, hasta || null];
}

const FILTRO_FECHA = (col) => `
  ($1::date IS NULL OR (${col} AT TIME ZONE 'America/Mexico_City')::date >= $1::date)
  AND ($2::date IS NULL OR (${col} AT TIME ZONE 'America/Mexico_City')::date <= $2::date)`;

export async function exportarCsv(tipo, desde, hasta) {
  if (!TIPOS.includes(tipo)) throw new Error(`Reporte desconocido. Usa: ${TIPOS.join(", ")}`);
  const params = rango(desde, hasta);

  if (tipo === "pedidos") {
    const filas = await many(
      `SELECT p.id, p.fecha, p.estado, p.metodo_pago, u.nombre, u.email,
              p.subtotal, p.descuento, p.costo_envio, p.total, p.monto_reembolsado,
              c.codigo AS cupon, p.pagado_en, p.paqueteria, p.numero_guia,
              p.envio->>'ciudad' AS ciudad, p.envio->>'estado' AS estado_envio, p.envio->>'cp' AS cp,
              (SELECT SUM(cantidad) FROM detalle_pedido d WHERE d.pedido_id = p.id) AS piezas
         FROM pedido p
         JOIN usuario u ON u.id = p.usuario_id
         LEFT JOIN cupon c ON c.id = p.cupon_id
        WHERE ${FILTRO_FECHA("p.fecha")}
        ORDER BY p.id`,
      params
    );
    return csv(
      ["Pedido", "Fecha", "Estado", "Método", "Cliente", "Email", "Piezas", "Subtotal", "Descuento", "Envío", "Total", "Reembolsado", "Cupón", "Pagado el", "Paquetería", "Guía", "Ciudad", "Estado (envío)", "C.P."],
      filas.map((f) => [f.id, f.fecha, f.estado, f.metodo_pago, f.nombre, f.email, f.piezas, f.subtotal, f.descuento, f.costo_envio, f.total, f.monto_reembolsado, f.cupon, f.pagado_en, f.paqueteria, f.numero_guia, f.ciudad, f.estado_envio, f.cp])
    );
  }

  if (tipo === "productos") {
    const filas = await many(
      `SELECT p.id, p.sku, p.nombre, c.nombre AS categoria, p.precio, p.stock, p.stock_minimo, p.activo,
              p.stock * p.precio AS valor,
              COALESCE((SELECT SUM(d.cantidad) FROM detalle_pedido d JOIN pedido pe ON pe.id = d.pedido_id
                         WHERE d.producto_id = p.id AND pe.estado IN ('pagado','enviado','entregado')), 0) AS vendidas
         FROM producto p JOIN categoria c ON c.id = p.categoria_id
        ORDER BY p.id`
    );
    return csv(
      ["ID", "SKU", "Producto", "Categoría", "Precio", "Stock", "Stock mínimo", "Activo", "Valor en inventario", "Piezas vendidas"],
      filas.map((f) => [f.id, f.sku, f.nombre, f.categoria, f.precio, f.stock, f.stock_minimo, f.activo ? "Sí" : "No", f.valor, f.vendidas])
    );
  }

  if (tipo === "clientes") {
    const filas = await many(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.rol, u.activo, u.creado_en,
              COUNT(p.id) FILTER (WHERE p.estado IN ('pagado','enviado','entregado')) AS pedidos,
              COALESCE(SUM(p.total) FILTER (WHERE p.estado IN ('pagado','enviado','entregado')), 0) AS gastado,
              MAX(p.fecha) AS ultimo
         FROM usuario u LEFT JOIN pedido p ON p.usuario_id = u.id
        WHERE ${FILTRO_FECHA("u.creado_en")}
        GROUP BY u.id ORDER BY u.id`,
      params
    );
    return csv(
      ["ID", "Nombre", "Email", "Teléfono", "Rol", "Activo", "Alta", "Pedidos pagados", "Total comprado", "Último pedido"],
      filas.map((f) => [f.id, f.nombre, f.email, f.telefono, f.rol, f.activo ? "Sí" : "No", f.creado_en, f.pedidos, f.gastado, f.ultimo])
    );
  }

  if (tipo === "movimientos") {
    const filas = await many(
      `SELECT m.id, m.creado_en, p.nombre AS producto, p.sku, m.tipo, m.cantidad, m.stock_resultante,
              m.pedido_id, pr.nombre AS proveedor, m.costo_unitario, u.nombre AS usuario, m.motivo
         FROM movimiento_inventario m
         JOIN producto p ON p.id = m.producto_id
         LEFT JOIN proveedor pr ON pr.id = m.proveedor_id
         LEFT JOIN usuario u ON u.id = m.usuario_id
        WHERE ${FILTRO_FECHA("m.creado_en")}
        ORDER BY m.id`,
      params
    );
    return csv(
      ["ID", "Fecha", "Producto", "SKU", "Tipo", "Cantidad", "Stock después", "Pedido", "Proveedor", "Costo unitario", "Usuario", "Motivo"],
      filas.map((f) => [f.id, f.creado_en, f.producto, f.sku, f.tipo, f.cantidad, f.stock_resultante, f.pedido_id, f.proveedor, f.costo_unitario, f.usuario, f.motivo])
    );
  }

  // ventas_dia
  const filas = await many(
    `SELECT to_char((COALESCE(p.pagado_en, p.fecha) AT TIME ZONE 'America/Mexico_City')::date, 'YYYY-MM-DD') AS dia,
            COUNT(*) AS pedidos, SUM(p.subtotal) AS subtotal, SUM(p.descuento) AS descuento,
            SUM(p.costo_envio) AS envio, SUM(p.total) AS total
       FROM pedido p
      WHERE p.estado IN ('pagado','enviado','entregado') AND ${FILTRO_FECHA("COALESCE(p.pagado_en, p.fecha)")}
      GROUP BY 1 ORDER BY 1`,
    params
  );
  return csv(
    ["Día", "Pedidos", "Subtotal", "Descuentos", "Envíos", "Total"],
    filas.map((f) => [f.dia, f.pedidos, f.subtotal, f.descuento, f.envio, f.total])
  );
}
