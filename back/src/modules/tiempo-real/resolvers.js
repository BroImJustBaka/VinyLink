// Resolvers de las subscriptions. Cada una tiene `subscribe` (abre el canal
// y revisa permisos UNA vez, al suscribirse) y un filtro (withFilter) que se
// evalúa con cada evento para decidir si a este suscriptor le toca.
import { withFilter } from "graphql-subscriptions";
import { one } from "../../lib/sql.js";
import { pubsub, EVENTOS } from "../../lib/pubsub.js";
import { requireUser } from "../auth/context.js";
import { tienePermiso, esPersonal } from "../auth/permisos.js";
import { ES_ID } from "../pedidos/servicio.js";
import { crearTicket } from "./tickets.js";

const mismoId = (a, b) => String(a) === String(b);

export const resolvers = {
  Mutation: {
    ticketTiempoReal: (_padre, _args, context) => crearTicket(requireUser(context).id),
  },

  Subscription: {
    pedidoActualizado: {
      subscribe: withFilter(
        async (_padre, { id }, context) => {
          const user = requireUser(context);
          const personal = tienePermiso(user, "pedidos.ver");
          if (id == null && !personal) throw new Error("Indica el número del pedido que quieres seguir");
          if (id != null) {
            const pedido = ES_ID.test(String(id))
              ? await one("SELECT usuario_id FROM pedido WHERE id = $1", [id])
              : null;
            // Un pedido ajeno se responde igual que uno inexistente.
            if (!pedido || (!personal && !mismoId(pedido.usuario_id, user.id))) {
              throw new Error(`No existe el pedido #${id}`);
            }
          }
          return pubsub.asyncIterableIterator(EVENTOS.PEDIDO);
        },
        (payload, { id }) => id == null || mismoId(payload.pedidoActualizado.id, id)
      ),
    },

    stockActualizado: {
      subscribe: withFilter(
        () => pubsub.asyncIterableIterator(EVENTOS.STOCK),
        (payload, { productoId }, context) => {
          const p = payload.stockActualizado;
          if (productoId != null && !mismoId(p.id, productoId)) return false;
          // Un producto inactivo solo se le anuncia al personal.
          return p.activo || esPersonal(context.user);
        }
      ),
    },

    eventosAdmin: {
      subscribe: withFilter(
        (_padre, _args, context) => {
          const user = requireUser(context);
          if (!esPersonal(user)) throw new Error("Solo un administrador puede hacer esto");
          return pubsub.asyncIterableIterator(EVENTOS.ADMIN);
        },
        // Cada quien recibe solo los avisos de lo que su rol puede atender.
        (payload, _args, context) => {
          const e = payload.eventosAdmin;
          const u = context.user;
          if (e.tipo === "accion") return tienePermiso(u, "bitacora") && !mismoId(e.usuarioId, u.id);
          if (e.tipo === "stock_bajo") return tienePermiso(u, "inventario") || tienePermiso(u, "catalogo");
          return tienePermiso(u, "pedidos.ver");
        }
      ),
    },
  },
};
