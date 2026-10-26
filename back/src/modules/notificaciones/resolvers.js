import { one, many, iso } from "../../lib/sql.js";
import { requirePermiso } from "../auth/context.js";
import { registrar } from "../../lib/bitacora.js";
import { ES_ID } from "../pedidos/servicio.js";
import { correoReal, reenviarCorreo } from "./correo.js";
import { parametroBusqueda, condicionBusqueda } from "../../lib/busqueda.js";

const mapCorreo = (f) =>
  f && {
    ...f,
    pedidoId: f.pedido_id,
    creadoEn: iso(f.creado_en),
    enviadoEn: iso(f.enviado_en),
  };

export const resolvers = {
  Query: {
    adminCorreos: async (_padre, { buscar, limite, offset }, context) => {
      requirePermiso(context, "correos");
      const patron = parametroBusqueda(buscar);
      const filtro = `FROM correo WHERE ${condicionBusqueda(["para", "asunto", "tipo"], 1)}`;
      const items = await many(
        `SELECT * ${filtro} ORDER BY creado_en DESC, id DESC LIMIT $2 OFFSET $3`,
        [patron, Math.min(Math.max(Number(limite) || 30, 1), 100), Math.max(Number(offset) || 0, 0)]
      );
      const { total } = await one(`SELECT COUNT(*)::int AS total ${filtro}`, [patron]);
      return { items: items.map(mapCorreo), total, envioReal: correoReal };
    },

    adminCorreo: async (_padre, { id }, context) => {
      requirePermiso(context, "correos");
      return ES_ID.test(String(id)) ? mapCorreo(await one("SELECT * FROM correo WHERE id = $1", [id])) : null;
    },
  },

  Mutation: {
    reenviarCorreo: async (_padre, { id }, context) => {
      const user = requirePermiso(context, "correos");
      const correo = ES_ID.test(String(id)) ? await one("SELECT id, para FROM correo WHERE id = $1", [id]) : null;
      if (!correo) throw new Error(`No existe el correo #${id}`);
      await reenviarCorreo(correo.id);
      await registrar(user, "correo.reenviar", "correo", id, { para: correo.para });
      return mapCorreo(await one("SELECT * FROM correo WHERE id = $1", [id]));
    },
  },
};
