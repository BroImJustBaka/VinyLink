import { requirePermiso } from "../auth/context.js";
import { registrar } from "../../lib/bitacora.js";
import { leerConfiguracion, guardarConfiguracion } from "./servicio.js";

export const resolvers = {
  Query: {
    configuracionTienda: () => leerConfiguracion(),
  },

  Mutation: {
    actualizarConfiguracion: async (_padre, { data }, context) => {
      const user = requirePermiso(context, "configuracion");
      const { antes, despues } = await guardarConfiguracion(data);
      // En la bitácora solo los campos que cambiaron: { campo: [antes, después] }.
      const cambios = Object.fromEntries(
        Object.keys(despues)
          .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
          .map((k) => [k, [antes[k], despues[k]]])
      );
      if (Object.keys(cambios).length) {
        await registrar(user, "configuracion.actualizar", "configuracion", null, cambios);
      }
      return despues;
    },
  },
};
