// Panel de administración. Cada resolver empieza con requireAdmin(context).
import { one, many, iso, mapProducto, mapPedido } from "../../lib/sql.js";
import { requireAdmin } from "../auth/context.js";
import { ES_ID } from "../pedidos/servicio.js";
import { crearLinkDePago, reembolsarPedido } from "../pagos/servicio.js";

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

const redondear = (n) => Math.round(n * 100) / 100;

export const resolvers = {
  Query: {
    adminResumen: async (_padre, { dias }, context) => {
      requireAdmin(context);
      const d = validarDias(dias);
      const ventas = await one(
        `SELECT
           COALESCE(SUM(p.total) FILTER (WHERE ${CUANDO} >= NOW() - make_interval(days => $1)), 0)::float AS ingresos,
           COUNT(*) FILTER (WHERE ${CUANDO} >= NOW() - make_interval(days => $1))::int AS pedidos,
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
      const { pendientes } = await one(
        "SELECT COUNT(*)::int AS pendientes FROM pedido WHERE estado = 'pendiente'"
      );
      const { nuevos } = await one(
        `SELECT COUNT(*)::int AS nuevos FROM usuario
          WHERE rol = 'CLIENTE' AND creado_en >= NOW() - make_interval(days => $1)`,
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
        clientesNuevos: nuevos,
      };
    },

    adminTopProductos: async (_padre, { dias, limite }, context) => {
      requireAdmin(context);
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
        [validarDias(dias), Math.min(Math.max(Number(limite) || 5, 1), 20)]
      );
      return filas.map((f) => ({
        producto: mapProducto(f),
        unidades: f.unidades,
        ingresos: redondear(f.ingresos),
      }));
    },

    adminVentasPorDia: async (_padre, { dias }, context) => {
      requireAdmin(context);
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
      requireAdmin(context);
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

    adminStockBajo: async (_padre, { umbral }, context) => {
      requireAdmin(context);
      return (
        await many("SELECT * FROM producto WHERE stock <= $1 ORDER BY stock, nombre", [
          Math.max(Number(umbral) || 0, 0),
        ])
      ).map(mapProducto);
    },

    adminPedidos: async (_padre, { estado, metodo, buscar, limite, offset }, context) => {
      requireAdmin(context);
      const est = ESTADOS.includes(estado) ? estado : null;
      const met = METODOS.includes(metodo) ? metodo : null;
      const texto = (buscar ?? "").trim().replace(/^#/, "");
      // Los comodines de ILIKE (% y _) que escriba el admin se buscan literalmente.
      const patron = texto ? `%${texto.replace(/[\\%_]/g, "\\$&")}%` : null;
      const filtro = `
        FROM pedido p JOIN usuario u ON u.id = p.usuario_id
        WHERE ($1::text IS NULL OR p.estado = $1)
          AND ($2::text IS NULL OR p.metodo_pago = $2)
          AND ($3::text IS NULL OR u.nombre ILIKE $3 OR u.email ILIKE $3 OR p.id::text = $4)`;
      const params = [est, met, patron, texto];
      const items = await many(
        `SELECT p.* ${filtro} ORDER BY p.fecha DESC, p.id DESC LIMIT $5 OFFSET $6`,
        [...params, Math.min(Math.max(Number(limite) || 20, 1), 100), Math.max(Number(offset) || 0, 0)]
      );
      const { total } = await one(`SELECT COUNT(*)::int AS total ${filtro}`, params);
      return { items: items.map(mapPedido), total };
    },

    adminClientes: async (_padre, _args, context) => {
      requireAdmin(context);
      const filas = await many(
        `SELECT u.id, u.nombre, u.email, u.rol, u.creado_en,
                COUNT(p.id) FILTER (WHERE p.estado IN ${VENTA})::int AS pedidos,
                COALESCE(SUM(p.total) FILTER (WHERE p.estado IN ${VENTA}), 0)::float AS total_gastado,
                MAX(p.fecha) AS ultimo_pedido
           FROM usuario u
           LEFT JOIN pedido p ON p.usuario_id = u.id
          GROUP BY u.id
          ORDER BY total_gastado DESC, u.id`
      );
      return filas.map((f) => ({
        usuario: { id: f.id, nombre: f.nombre, email: f.email, rol: f.rol },
        pedidos: f.pedidos,
        totalGastado: redondear(f.total_gastado),
        ultimoPedido: iso(f.ultimo_pedido),
        creadoEn: iso(f.creado_en),
      }));
    },
  },

  Mutation: {
    actualizarEstadoPedido: async (_padre, { id, estado }, context) => {
      requireAdmin(context);
      const pedido = ES_ID.test(String(id))
        ? await one("SELECT * FROM pedido WHERE id = $1", [id])
        : null;
      if (!pedido) throw new Error(`No existe el pedido #${id}`);
      if (SIGUIENTE[pedido.estado] !== estado) {
        throw new Error(`Un pedido "${pedido.estado}" no puede pasar a "${estado}"`);
      }
      // `AND estado = $3`: si otro admin lo cambió al mismo tiempo, no se pisa.
      const actualizado = await one(
        "UPDATE pedido SET estado = $2 WHERE id = $1 AND estado = $3 RETURNING *",
        [id, estado, pedido.estado]
      );
      if (!actualizado) throw new Error("El pedido cambió mientras tanto; recarga la página");
      return mapPedido(actualizado);
    },

    reembolsarPedido: async (_padre, { id, reponerStock }, context) => {
      requireAdmin(context);
      if (!ES_ID.test(String(id))) throw new Error(`No existe el pedido #${id}`);
      await reembolsarPedido(Number(id), { reponerStock });
      return mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [id]));
    },

    crearLinkDePagoAdmin: async (_padre, { usuarioId, items }, context) => {
      requireAdmin(context);
      const cliente = ES_ID.test(String(usuarioId))
        ? await one("SELECT id, nombre, email, rol FROM usuario WHERE id = $1", [usuarioId])
        : null;
      if (!cliente) throw new Error("Elige un cliente");
      const r = await crearLinkDePago({ usuario: cliente, items });
      return {
        pedido: mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [r.pedidoId])),
        requiereAccion: false,
        clientSecret: null,
      };
    },

    cambiarRolUsuario: async (_padre, { id, rol }, context) => {
      const admin = requireAdmin(context);
      if (String(id) === String(admin.id)) throw new Error("No puedes cambiar tu propio rol");
      const usuario = ES_ID.test(String(id))
        ? await one("UPDATE usuario SET rol = $2 WHERE id = $1 RETURNING id, nombre, email, rol", [
            id,
            rol,
          ])
        : null;
      if (!usuario) throw new Error(`No existe el usuario #${id}`);
      return usuario;
    },
  },
};
