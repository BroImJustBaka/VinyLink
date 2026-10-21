import { one, many, iso, redondear } from "../../lib/sql.js";
import { requirePermiso } from "../auth/context.js";
import { registrar } from "../../lib/bitacora.js";
import { ES_ID } from "../pedidos/servicio.js";
import { validarCupon } from "./servicio.js";

// Cupón con sus usos (pedidos no cancelados) y lo que ha descontado.
const CONSULTA = `
  SELECT c.*,
         COUNT(p.id) FILTER (WHERE p.estado <> 'cancelado')::int AS usos,
         COALESCE(SUM(p.descuento) FILTER (WHERE p.estado <> 'cancelado'), 0)::float AS descuento_total
    FROM cupon c
    LEFT JOIN pedido p ON p.cupon_id = c.id`;

const mapCupon = (f) => ({
  ...f,
  minimoCompra: f.minimo_compra,
  usosMaximos: f.usos_maximos,
  usosPorCliente: f.usos_por_cliente,
  vigenteDesde: iso(f.vigente_desde),
  vigenteHasta: iso(f.vigente_hasta),
  descuentoTotal: redondear(f.descuento_total ?? 0),
  usos: f.usos ?? 0,
  creadoEn: iso(f.creado_en),
});

const cuponPorId = async (id) => mapCupon(await one(`${CONSULTA} WHERE c.id = $1 GROUP BY c.id`, [id]));

// El índice único del código responde 23505 si ya existe.
async function guardar(sql, params) {
  try {
    return await one(sql, params);
  } catch (err) {
    if (err.code === "23505") throw new Error(`Ya existe un cupón con el código "${params[0]}"`);
    throw err;
  }
}

const campos = (c) => [
  c.codigo, c.descripcion, c.tipo, c.valor, c.minimoCompra, c.usosMaximos,
  c.usosPorCliente, c.vigenteDesde, c.vigenteHasta, c.activo,
];

export const resolvers = {
  Query: {
    adminCupones: async (_padre, _args, context) => {
      requirePermiso(context, "cupones");
      return (await many(`${CONSULTA} GROUP BY c.id ORDER BY c.activo DESC, c.creado_en DESC`)).map(mapCupon);
    },
  },

  Mutation: {
    crearCupon: async (_padre, { data }, context) => {
      const user = requirePermiso(context, "cupones");
      const c = validarCupon(data);
      const fila = await guardar(
        `INSERT INTO cupon (codigo, descripcion, tipo, valor, minimo_compra, usos_maximos,
                            usos_por_cliente, vigente_desde, vigente_hasta, activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        campos(c)
      );
      await registrar(user, "cupon.crear", "cupon", fila.id, { codigo: c.codigo, tipo: c.tipo, valor: c.valor });
      return cuponPorId(fila.id);
    },

    actualizarCupon: async (_padre, { id, data }, context) => {
      const user = requirePermiso(context, "cupones");
      const c = validarCupon(data);
      const fila = ES_ID.test(String(id))
        ? await guardar(
            `UPDATE cupon SET codigo = $1, descripcion = $2, tipo = $3, valor = $4, minimo_compra = $5,
                    usos_maximos = $6, usos_por_cliente = $7, vigente_desde = $8, vigente_hasta = $9, activo = $10
              WHERE id = $11 RETURNING id`,
            [...campos(c), id]
          )
        : null;
      if (!fila) throw new Error(`No existe el cupón #${id}`);
      await registrar(user, "cupon.actualizar", "cupon", id, { codigo: c.codigo, activo: c.activo });
      return cuponPorId(id);
    },
  },
};
