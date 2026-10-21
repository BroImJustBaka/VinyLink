// Panel de administración. Cada resolver empieza con requirePermiso(context, ...).
import { one, many, iso, mapProducto, mapPedido, redondear, transaccion } from "../../lib/sql.js";
import { registrar, describir } from "../../lib/bitacora.js";
import { publicarPedido } from "../../lib/pubsub.js";
import { requirePermiso, cerrarSesionesDe } from "../auth/context.js";
import { ROLES } from "../auth/permisos.js";
import { crearYMandarRestablecimiento } from "../auth/resolvers.js";
import { ES_ID, registrarHistorial } from "../pedidos/servicio.js";
import { crearLinkDePago, reembolsarPedido } from "../pagos/servicio.js";
import { notificarPedido } from "../notificaciones/servicio.js";
import { exportarCsv } from "./exportar.js";

// Estados que cuentan como venta (el dinero ya entró).
const VENTA = "('pagado', 'enviado', 'entregado')";
// Momento de la venta: cuando se pagó (los pedidos viejos no tienen pagado_en).
const CUANDO = "COALESCE(p.pagado_en, p.fecha)";

const ESTADOS = ["pendiente", "pagado", "enviado", "entregado", "cancelado", "reembolsado"];
const METODOS = ["credito", "debito", "oxxo", "spei", "link"];
// Avances permitidos desde el panel (cancelar y reembolsar tienen su propia mutación).
const SIGUIENTE = { pagado: "enviado", enviado: "entregado" };

// Periodo en días entre 1 y 365 (un valor raro no debe romper la consulta).
function validarDias(dias) {
  const n = Number(dias);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("El periodo debe ser de 1 a 365 días");
  return n;
}

const limite = (n, defecto, max) => Math.min(Math.max(Number(n) || defecto, 1), max);
const desplazamiento = (n) => Math.max(Number(n) || 0, 0);
// Los comodines de ILIKE (% y _) que escriba el admin se buscan literalmente.
const patronDe = (texto) => (texto ? `%${texto.replace(/[\\%_]/g, "\\$&")}%` : null);

async function pedidoOError(id) {
  const pedido = ES_ID.test(String(id)) ? await one("SELECT * FROM pedido WHERE id = $1", [id]) : null;
  if (!pedido) throw new Error(`No existe el pedido #${id}`);
  return pedido;
}

async function usuarioOError(id) {
  const usuario = ES_ID.test(String(id)) ? await one("SELECT * FROM usuario WHERE id = $1", [id]) : null;
  if (!usuario) throw new Error(`No existe el usuario #${id}`);
  return usuario;
}

function limpiarGuia(paqueteria, numeroGuia) {
  const p = paqueteria?.trim() || null;
  const g = numeroGuia?.trim().replace(/\s+/g, "") || null;
  if (g && !/^[A-Za-z0-9-]{4,40}$/.test(g)) throw new Error("El número de guía solo puede tener letras, números y guiones (4 a 40)");
  if (g && !p) throw new Error("Indica la paquetería del número de guía");
  if (p && p.length > 60) throw new Error("El nombre de la paquetería es demasiado largo");
  return { paqueteria: p, numeroGuia: g };
}

export const resolvers = {
  Query: {
    adminResumen: async (_padre, { dias }, context) => {
      requirePermiso(context, "reportes");
      const d = validarDias(dias);
      const ventas = await one(
        `SELECT
           COALESCE(SUM(p.total) FILTER (WHERE ${CUANDO} >= NOW() - make_interval(days => $1)), 0)::float AS ingresos,
           COUNT(*) FILTER (WHERE ${CUANDO} >= NOW() - make_interval(days => $1))::int AS pedidos,
           COALESCE(SUM(p.descuento) FILTER (WHERE ${CUANDO} >= NOW() - make_interval(days => $1)), 0)::float AS descuentos,
           COALESCE(SUM(p.total) FILTER (WHERE ${CUANDO} >= NOW() - make_interval(days => $1 * 2)
                                           AND ${CUANDO} <  NOW() - make_interval(days => $1)), 0)::float AS ingresos_antes,
           COUNT(*) FILTER (WHERE ${CUANDO} >= NOW() - make_interval(days => $1 * 2)
                              AND ${CUANDO} <  NOW() - make_interval(days => $1))::int AS pedidos_antes
         FROM pedido p
         WHERE p.estado IN ${VENTA}`,
        [d]
      );
      const { unidades } = await one(
        `SELECT COALESCE(SUM(dp.cantidad), 0)::int AS unidades
           FROM detalle_pedido dp JOIN pedido p ON p.id = dp.pedido_id
          WHERE p.estado IN ${VENTA} AND ${CUANDO} >= NOW() - make_interval(days => $1)`,
        [d]
      );
      const { pendientes, por_enviar } = await one(
        `SELECT COUNT(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
                COUNT(*) FILTER (WHERE estado = 'pagado')::int AS por_enviar
           FROM pedido`
      );
      const { nuevos } = await one(
        `SELECT COUNT(*)::int AS nuevos FROM usuario
          WHERE rol = 'CLIENTE' AND creado_en >= NOW() - make_interval(days => $1)`,
        [d]
      );
      const { reembolsos } = await one(
        `SELECT COALESCE(SUM(monto_centavos), 0)::int AS reembolsos FROM reembolso
          WHERE creado_en >= NOW() - make_interval(days => $1)`,
        [d]
      );
      return {
        ingresos: redondear(ventas.ingresos),
        pedidosPagados: ventas.pedidos,
        ticketPromedio: ventas.pedidos ? redondear(ventas.ingresos / ventas.pedidos) : 0,
        unidadesVendidas: unidades,
        ingresosPeriodoAnterior: redondear(ventas.ingresos_antes),
        pedidosPeriodoAnterior: ventas.pedidos_antes,
        pedidosPendientes: pendientes,
        pedidosPorEnviar: por_enviar,
        clientesNuevos: nuevos,
        reembolsos: reembolsos / 100,
        descuentos: redondear(ventas.descuentos),
      };
    },

    adminTopProductos: async (_padre, { dias, limite: lim }, context) => {
      requirePermiso(context, "reportes");
      const filas = await many(
        `SELECT pr.*,
                SUM(dp.cantidad)::int AS unidades,
                SUM(dp.cantidad * dp.precio_unitario)::float AS ingresos
           FROM detalle_pedido dp
           JOIN pedido p    ON p.id = dp.pedido_id
           JOIN producto pr ON pr.id = dp.producto_id
          WHERE p.estado IN ${VENTA} AND ${CUANDO} >= NOW() - make_interval(days => $1)
          GROUP BY pr.id
          ORDER BY unidades DESC, ingresos DESC, pr.id
          LIMIT $2`,
        [validarDias(dias), limite(lim, 5, 20)]
      );
      return filas.map((f) => ({
        producto: mapProducto(f),
        unidades: f.unidades,
        ingresos: redondear(f.ingresos),
      }));
    },

    adminVentasPorDia: async (_padre, { dias }, context) => {
      requirePermiso(context, "reportes");
      // generate_series arma la lista de días para que los días sin ventas
      // también aparezcan (con 0) y la gráfica no se "salte" fechas.
      const filas = await many(
        `WITH dias AS (
           SELECT generate_series(
                    (NOW() AT TIME ZONE 'America/Mexico_City')::date - ($1 - 1),
                    (NOW() AT TIME ZONE 'America/Mexico_City')::date,
                    INTERVAL '1 day'
                  )::date AS dia
         )
         SELECT to_char(dias.dia, 'YYYY-MM-DD') AS fecha,
                COALESCE(SUM(p.total), 0)::float AS ingresos,
                COUNT(p.id)::int AS pedidos
           FROM dias
           LEFT JOIN pedido p
             ON p.estado IN ${VENTA}
            AND (${CUANDO} AT TIME ZONE 'America/Mexico_City')::date = dias.dia
          GROUP BY dias.dia
          ORDER BY dias.dia`,
        [validarDias(dias)]
      );
      return filas.map((f) => ({ ...f, ingresos: redondear(f.ingresos) }));
    },

    adminVentasPorMetodo: async (_padre, { dias }, context) => {
      requirePermiso(context, "reportes");
      const filas = await many(
        `SELECT COALESCE(p.metodo_pago, 'sin_registro') AS metodo,
                COUNT(*)::int AS pedidos,
                SUM(p.total)::float AS ingresos
           FROM pedido p
          WHERE p.estado IN ${VENTA} AND ${CUANDO} >= NOW() - make_interval(days => $1)
          GROUP BY 1
          ORDER BY ingresos DESC`,
        [validarDias(dias)]
      );
      return filas.map((f) => ({ ...f, ingresos: redondear(f.ingresos) }));
    },

    adminVentasPorCategoria: async (_padre, { dias }, context) => {
      requirePermiso(context, "reportes");
      const filas = await many(
        `SELECT c.*,
                SUM(dp.cantidad)::int AS unidades,
                SUM(dp.cantidad * dp.precio_unitario)::float AS ingresos
           FROM detalle_pedido dp
           JOIN pedido p    ON p.id = dp.pedido_id
           JOIN producto pr ON pr.id = dp.producto_id
           JOIN categoria c ON c.id = pr.categoria_id
          WHERE p.estado IN ${VENTA} AND ${CUANDO} >= NOW() - make_interval(days => $1)
          GROUP BY c.id
          ORDER BY ingresos DESC`,
        [validarDias(dias)]
      );
      return filas.map((f) => ({ categoria: f, unidades: f.unidades, ingresos: redondear(f.ingresos) }));
    },

    adminStockBajo: async (_padre, { umbral }, context) => {
      requirePermiso(context, "reportes", "inventario", "catalogo");
      const u = umbral == null ? null : Math.max(Number(umbral) || 0, 0);
      return (
        await many(
          "SELECT * FROM producto WHERE activo AND stock <= COALESCE($1, stock_minimo) ORDER BY stock, nombre",
          [u]
        )
      ).map(mapProducto);
    },

    adminPedidos: async (_padre, { estado, metodo, buscar, limite: lim, offset }, context) => {
      requirePermiso(context, "pedidos.ver");
      const est = ESTADOS.includes(estado) ? estado : null;
      const met = METODOS.includes(metodo) ? metodo : null;
      const texto = (buscar ?? "").trim().replace(/^#/, "");
      const filtro = `
        FROM pedido p JOIN usuario u ON u.id = p.usuario_id
        WHERE ($1::text IS NULL OR p.estado = $1)
          AND ($2::text IS NULL OR p.metodo_pago = $2)
          AND ($3::text IS NULL OR u.nombre ILIKE $3 OR u.email ILIKE $3 OR p.id::text = $4 OR p.numero_guia ILIKE $3)`;
      const params = [est, met, patronDe(texto), texto];
      const items = await many(
        `SELECT p.* ${filtro} ORDER BY p.fecha DESC, p.id DESC LIMIT $5 OFFSET $6`,
        [...params, limite(lim, 20, 100), desplazamiento(offset)]
      );
      const { total } = await one(`SELECT COUNT(*)::int AS total ${filtro}`, params);
      return { items: items.map(mapPedido), total };
    },

    adminClientes: async (_padre, { buscar, rol, bloqueados, limite: lim, offset }, context) => {
      requirePermiso(context, "clientes", "links", "usuarios");
      const filtro = `
        WHERE ($1::text IS NULL OR u.nombre ILIKE $1 OR u.email ILIKE $1)
          AND ($2::text IS NULL OR u.rol = $2)
          AND (NOT $3::boolean OR NOT u.activo)`;
      const params = [patronDe((buscar ?? "").trim()), ROLES.includes(rol) ? rol : null, Boolean(bloqueados)];
      const filas = await many(
        `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.telefono, u.creado_en,
                COUNT(p.id) FILTER (WHERE p.estado IN ${VENTA})::int AS pedidos,
                COALESCE(SUM(p.total) FILTER (WHERE p.estado IN ${VENTA}), 0)::float AS total_gastado,
                MAX(p.fecha) AS ultimo_pedido
           FROM usuario u
           LEFT JOIN pedido p ON p.usuario_id = u.id
           ${filtro}
          GROUP BY u.id
          ORDER BY total_gastado DESC, u.id
          LIMIT $4 OFFSET $5`,
        [...params, limite(lim, 25, 500), desplazamiento(offset)]
      );
      const { total } = await one(`SELECT COUNT(*)::int AS total FROM usuario u ${filtro}`, params);
      return {
        total,
        items: filas.map((f) => ({
          usuario: { id: f.id, nombre: f.nombre, email: f.email, rol: f.rol, activo: f.activo, telefono: f.telefono },
          pedidos: f.pedidos,
          totalGastado: redondear(f.total_gastado),
          ultimoPedido: iso(f.ultimo_pedido),
          creadoEn: iso(f.creado_en),
        })),
      };
    },

    adminCliente: async (_padre, { id }, context) => {
      requirePermiso(context, "clientes");
      const u = ES_ID.test(String(id)) ? await one("SELECT * FROM usuario WHERE id = $1", [id]) : null;
      if (!u) return null;
      const r = await one(
        `SELECT COUNT(*) FILTER (WHERE estado IN ${VENTA})::int AS pagados,
                COALESCE(SUM(total) FILTER (WHERE estado IN ${VENTA}), 0)::float AS gastado,
                MAX(fecha) AS ultimo
           FROM pedido WHERE usuario_id = $1`,
        [id]
      );
      return {
        usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo, telefono: u.telefono },
        creadoEn: iso(u.creado_en),
        pedidosPagados: r.pagados,
        totalGastado: redondear(r.gastado),
        ticketPromedio: r.pagados ? redondear(r.gastado / r.pagados) : 0,
        ultimoPedido: iso(r.ultimo),
        pedidos: (await many("SELECT * FROM pedido WHERE usuario_id = $1 ORDER BY fecha DESC, id DESC", [id])).map(mapPedido),
        direcciones: await many("SELECT * FROM direccion WHERE usuario_id = $1 ORDER BY creada_en DESC", [id]),
      };
    },

    adminBitacora: async (_padre, { entidad, entidadId, usuarioId, buscar, limite: lim, offset }, context) => {
      requirePermiso(context, "bitacora");
      const filtro = `
        FROM bitacora
        WHERE ($1::text IS NULL OR entidad = $1)
          AND ($2::text IS NULL OR entidad_id = $2)
          AND ($3::int IS NULL OR usuario_id = $3)
          AND ($4::text IS NULL OR accion ILIKE $4 OR usuario_nombre ILIKE $4 OR detalle::text ILIKE $4)`;
      const params = [
        entidad?.trim() || null,
        entidadId?.trim() || null,
        usuarioId && ES_ID.test(String(usuarioId)) ? usuarioId : null,
        patronDe((buscar ?? "").trim()),
      ];
      const filas = await many(
        `SELECT * ${filtro} ORDER BY creado_en DESC, id DESC LIMIT $5 OFFSET $6`,
        [...params, limite(lim, 50, 200), desplazamiento(offset)]
      );
      const { total } = await one(`SELECT COUNT(*)::int AS total ${filtro}`, params);
      return {
        total,
        items: filas.map((f) => ({
          id: f.id,
          usuarioId: f.usuario_id,
          usuarioNombre: f.usuario_nombre,
          accion: f.accion,
          entidad: f.entidad,
          entidadId: f.entidad_id,
          detalle: JSON.stringify(f.detalle ?? {}),
          descripcion: describir(f.accion, f.entidad, f.entidad_id),
          creadoEn: iso(f.creado_en),
        })),
      };
    },

    adminExportar: async (_padre, { tipo, desde, hasta }, context) => {
      // El reporte de clientes trae datos personales; el de movimientos, costos.
      const permiso = { clientes: ["clientes"], movimientos: ["inventario"], productos: ["inventario", "catalogo"] }[tipo] ?? [];
      const user = requirePermiso(context, "reportes", ...permiso);
      const texto = await exportarCsv(tipo, desde, hasta);
      await registrar(user, "reporte.exportar", "reporte", tipo, { desde: desde ?? null, hasta: hasta ?? null });
      return texto;
    },
  },

  Pedido: {
    reembolsos: async (padre, _args, context) => {
      requirePermiso(context, "pedidos.ver");
      const filas = await many(
        `SELECT r.*, u.nombre AS autor FROM reembolso r LEFT JOIN usuario u ON u.id = r.usuario_id
          WHERE r.pedido_id = $1 ORDER BY r.creado_en`,
        [padre.id]
      );
      return filas.map((f) => ({
        id: f.id,
        monto: f.monto_centavos / 100,
        parcial: f.parcial,
        repusoStock: f.repuso_stock,
        motivo: f.motivo,
        autor: f.autor,
        creadoEn: iso(f.creado_en),
      }));
    },
  },

  Mutation: {
    actualizarEstadoPedido: async (_padre, { id, estado, paqueteria, numeroGuia }, context) => {
      const user = requirePermiso(context, "pedidos.envio");
      const pedido = await pedidoOError(id);
      if (SIGUIENTE[pedido.estado] !== estado) {
        throw new Error(`Un pedido "${pedido.estado}" no puede pasar a "${estado}"`);
      }
      const guia = estado === "enviado" ? limpiarGuia(paqueteria, numeroGuia) : null;
      const actualizado = await transaccion(async (client) => {
        // `AND estado = $3`: si otro admin lo cambió al mismo tiempo, no se pisa.
        const { rows } = await client.query(
          `UPDATE pedido
              SET estado = $2,
                  enviado_en = CASE WHEN $2 = 'enviado' THEN NOW() ELSE enviado_en END,
                  entregado_en = CASE WHEN $2 = 'entregado' THEN NOW() ELSE entregado_en END,
                  paqueteria = COALESCE($4, paqueteria),
                  numero_guia = COALESCE($5, numero_guia)
            WHERE id = $1 AND estado = $3 RETURNING *`,
          [id, estado, pedido.estado, guia?.paqueteria ?? null, guia?.numeroGuia ?? null]
        );
        if (!rows[0]) throw new Error("El pedido cambió mientras tanto; recarga la página");
        const comentario = guia?.numeroGuia ? `${guia.paqueteria} · guía ${guia.numeroGuia}` : guia?.paqueteria ?? null;
        await registrarHistorial(client, id, pedido.estado, estado, user.id, comentario);
        await registrar(user, estado === "enviado" ? "pedido.enviar" : "pedido.entregar", "pedido", id, guia ?? {}, client);
        client.alConfirmar(async () => {
          await publicarPedido(id);
          void notificarPedido(id, estado);
        });
        return rows[0];
      });
      return mapPedido(actualizado);
    },

    actualizarGuiaPedido: async (_padre, { id, paqueteria, numeroGuia }, context) => {
      const user = requirePermiso(context, "pedidos.envio");
      const pedido = await pedidoOError(id);
      if (!["enviado", "entregado"].includes(pedido.estado)) throw new Error("Solo un pedido enviado tiene guía");
      const guia = limpiarGuia(paqueteria, numeroGuia);
      if (!guia.numeroGuia) throw new Error("Escribe el número de guía");
      const fila = await one("UPDATE pedido SET paqueteria = $2, numero_guia = $3 WHERE id = $1 RETURNING *", [
        id,
        guia.paqueteria,
        guia.numeroGuia,
      ]);
      await registrar(user, "pedido.guia", "pedido", id, { antes: [pedido.paqueteria, pedido.numero_guia], despues: [guia.paqueteria, guia.numeroGuia] });
      await publicarPedido(id);
      return mapPedido(fila);
    },

    reembolsarPedido: async (_padre, { id, reponerStock, monto, motivo }, context) => {
      const user = requirePermiso(context, "reembolsos");
      if (!ES_ID.test(String(id))) throw new Error(`No existe el pedido #${id}`);
      const r = await reembolsarPedido(Number(id), { reponerStock, monto, motivo, usuarioId: user.id });
      await registrar(user, r?.parcial ? "pedido.reembolso_parcial" : "pedido.reembolsar", "pedido", id, {
        monto: monto ?? "total",
        reponerStock: r?.parcial ? false : reponerStock,
        motivo: motivo ?? null,
      });
      return mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [id]));
    },

    agregarNotaPedido: async (_padre, { pedidoId, texto }, context) => {
      const user = requirePermiso(context, "pedidos.notas");
      const pedido = await pedidoOError(pedidoId);
      const t = texto.trim();
      if (!t) throw new Error("Escribe la nota");
      if (t.length > 2000) throw new Error("La nota puede tener máximo 2000 caracteres");
      await one("INSERT INTO nota_pedido (pedido_id, usuario_id, texto) VALUES ($1, $2, $3) RETURNING id", [
        pedido.id,
        user.id,
        t,
      ]);
      await registrar(user, "pedido.nota", "pedido", pedido.id, { texto: t.slice(0, 200) });
      await publicarPedido(pedido.id);
      return mapPedido(pedido);
    },

    crearLinkDePagoAdmin: async (_padre, { usuarioId, items }, context) => {
      const user = requirePermiso(context, "links");
      const cliente = ES_ID.test(String(usuarioId))
        ? await one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1 AND activo", [usuarioId])
        : null;
      if (!cliente) throw new Error("Elige un cliente");
      const r = await crearLinkDePago({ usuario: cliente, items });
      await registrar(user, "pedido.link", "pedido", r.pedidoId, { cliente: cliente.email });
      void notificarPedido(r.pedidoId, "creado");
      return {
        pedido: mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [r.pedidoId])),
        requiereAccion: false,
        clientSecret: null,
      };
    },

    cambiarRolUsuario: async (_padre, { id, rol }, context) => {
      const admin = requirePermiso(context, "usuarios");
      if (String(id) === String(admin.id)) throw new Error("No puedes cambiar tu propio rol");
      const antes = await usuarioOError(id);
      const usuario = await one("UPDATE usuario SET rol = $2 WHERE id = $1 RETURNING id, nombre, email, rol", [id, rol]);
      await registrar(admin, "usuario.rol", "usuario", id, { email: antes.email, rol: [antes.rol, rol] });
      return usuario;
    },

    bloquearUsuario: async (_padre, { id, bloqueado }, context) => {
      const user = requirePermiso(context, "clientes");
      if (String(id) === String(user.id)) throw new Error("No puedes bloquear tu propia cuenta");
      const objetivo = await usuarioOError(id);
      // Bloquear al personal es cosa de un ADMIN (permiso "usuarios").
      if (objetivo.rol !== "CLIENTE") requirePermiso(context, "usuarios");
      const fila = await one("UPDATE usuario SET activo = $2 WHERE id = $1 RETURNING id, nombre, email, rol, activo, telefono", [
        id,
        !bloqueado,
      ]);
      if (bloqueado) await cerrarSesionesDe(id);
      await registrar(user, bloqueado ? "usuario.bloquear" : "usuario.desbloquear", "usuario", id, { email: objetivo.email });
      return fila;
    },

    enviarRestablecimientoCliente: async (_padre, { id }, context) => {
      const user = requirePermiso(context, "clientes");
      const objetivo = await usuarioOError(id);
      if (!objetivo.activo) throw new Error("La cuenta está bloqueada; desbloquéala primero");
      await crearYMandarRestablecimiento(objetivo);
      await registrar(user, "usuario.restablecer", "usuario", id, { email: objetivo.email });
      return true;
    },
  },
};
