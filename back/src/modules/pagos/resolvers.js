// Resolvers de pagos. La lógica vive en ./servicio.js; aquí solo se revisan
// permisos y se arma la respuesta para GraphQL.
import { one, iso, mapPedido } from "../../lib/sql.js";
import { requireUser } from "../auth/context.js";
import { tienePermiso } from "../auth/permisos.js";
import { ES_ID } from "../pedidos/servicio.js";
import { stripe, publishableKey, modoPrueba } from "./stripe.js";
import { registrar } from "../../lib/bitacora.js";
import {
  cobrar,
  sincronizarPedido,
  cancelarPedidoPendiente,
  simularTransferenciaSpei,
  MINIMO_CENTAVOS,
  MAXIMO_OXXO_CENTAVOS,
} from "./servicio.js";

const pedidoPorId = async (id) => mapPedido(await one("SELECT * FROM pedido WHERE id = $1", [id]));

// Un pedido propio (o cualquiera si tu rol puede ver pedidos). Igual que la
// query `pedido`, uno ajeno se responde como si no existiera.
async function pedidoPropio(id, user) {
  const pedido = ES_ID.test(String(id)) ? await pedidoPorId(id) : null;
  if (!pedido || (pedido.usuarioId !== Number(user.id) && !tienePermiso(user, "pedidos.ver"))) {
    throw new Error(`No existe el pedido #${id}`);
  }
  return pedido;
}

// Fila de la tabla `pago` → tipo Pago del schema. `detalle` (JSONB) ya trae
// los datos de la ficha OXXO, la CLABE, el link o la tarjeta.
export function mapPago(row, esAdmin = false) {
  if (!row) return null;
  const d = row.detalle ?? {};
  return {
    id: row.id,
    metodo: row.metodo,
    estado: row.estado,
    monto: row.monto_centavos / 100,
    error: row.error,
    tarjeta: d.tarjeta ?? null,
    meses: d.meses ?? null,
    oxxo: d.oxxo ?? null,
    spei: d.spei
      ? {
          ...d.spei,
          montoRestante:
            d.spei.montoRestanteCentavos == null ? null : d.spei.montoRestanteCentavos / 100,
        }
      : null,
    link: d.link ?? null,
    stripePaymentIntentId: esAdmin ? row.stripe_payment_intent_id : null,
    stripeCheckoutSessionId: esAdmin ? row.stripe_checkout_session_id : null,
    creadoEn: iso(row.creado_en),
  };
}

export const resolvers = {
  Query: {
    configPagos: () => ({
      habilitado: Boolean(stripe && publishableKey),
      publishableKey,
      modoPrueba,
      minimo: MINIMO_CENTAVOS / 100,
      maximoOxxo: MAXIMO_OXXO_CENTAVOS / 100,
    }),
  },

  Pedido: {
    pagadoEn: (padre) => iso(padre.pagado_en),
    pago: async (padre, _args, context) =>
      mapPago(
        await one("SELECT * FROM pago WHERE pedido_id = $1", [padre.id]),
        tienePermiso(context.user, "pedidos.ver")
      ),
  },

  Mutation: {
    crearPedido: async (_padre, { data, pago }, context) => {
      const usuario = requireUser(context);
      const r = await cobrar({
        usuario,
        items: data.items,
        pago,
        cupon: data.cupon,
        envio: data.envio,
        guardarDireccion: data.guardarDireccion,
      });
      return {
        pedido: await pedidoPorId(r.pedidoId),
        requiereAccion: r.requiereAccion,
        clientSecret: r.clientSecret,
      };
    },

    sincronizarPago: async (_padre, { pedidoId }, context) => {
      const user = requireUser(context);
      const pedido = await pedidoPropio(pedidoId, user);
      // Un cliente solo necesita revisar pedidos pendientes; el personal puede
      // revisar cualquiera (por ejemplo, un reembolso hecho desde Stripe).
      if (pedido.estado === "pendiente" || tienePermiso(user, "pedidos.ver")) {
        await sincronizarPedido(pedido.id);
      }
      return pedidoPorId(pedido.id);
    },

    cancelarPedido: async (_padre, { id }, context) => {
      const user = requireUser(context);
      const pedido = await pedidoPropio(id, user);
      const propio = pedido.usuarioId === Number(user.id);
      if (!propio && !tienePermiso(user, "pedidos.cancelar")) {
        throw new Error(`Tu rol (${user.rol}) no tiene permiso para cancelar pedidos`);
      }
      const motivo = propio ? "Cancelado por el cliente." : "Cancelado por la tienda.";
      await cancelarPedidoPendiente(pedido.id, motivo, user.id);
      if (!propio) await registrar(user, "pedido.cancelar", "pedido", pedido.id, { motivo });
      return pedidoPorId(pedido.id);
    },

    simularTransferenciaSpei: async (_padre, { pedidoId }, context) => {
      const pedido = await pedidoPropio(pedidoId, requireUser(context));
      await simularTransferenciaSpei(pedido.id);
      return pedidoPorId(pedido.id);
    },
  },
};
