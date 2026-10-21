// Archivo compartido: solo junta los módulos. Cada quien edita su carpeta
// en src/modules/ y no debería necesitar tocar este archivo.
import * as catalogo from "./modules/catalogo/typeDefs.js";
import * as catalogoR from "./modules/catalogo/resolvers.js";
import * as pedidos from "./modules/pedidos/typeDefs.js";
import * as pedidosR from "./modules/pedidos/resolvers.js";
import * as auth from "./modules/auth/typeDefs.js";
import * as authR from "./modules/auth/resolvers.js";
import * as pagos from "./modules/pagos/typeDefs.js";
import * as pagosR from "./modules/pagos/resolvers.js";
import * as admin from "./modules/admin/typeDefs.js";
import * as adminR from "./modules/admin/resolvers.js";
import * as inventario from "./modules/inventario/typeDefs.js";
import * as inventarioR from "./modules/inventario/resolvers.js";
import * as cupones from "./modules/cupones/typeDefs.js";
import * as cuponesR from "./modules/cupones/resolvers.js";
import * as configuracion from "./modules/configuracion/typeDefs.js";
import * as configuracionR from "./modules/configuracion/resolvers.js";
import * as notificaciones from "./modules/notificaciones/typeDefs.js";
import * as notificacionesR from "./modules/notificaciones/resolvers.js";
import * as tiempoReal from "./modules/tiempo-real/typeDefs.js";
import * as tiempoRealR from "./modules/tiempo-real/resolvers.js";

const base = `#graphql
  type Query
  type Mutation
`;

export const typeDefs = [
  base,
  catalogo.typeDefs,
  pedidos.typeDefs,
  auth.typeDefs,
  pagos.typeDefs,
  admin.typeDefs,
  inventario.typeDefs,
  cupones.typeDefs,
  configuracion.typeDefs,
  notificaciones.typeDefs,
  tiempoReal.typeDefs,
];

function mergeResolvers(...mapas) {
  const resultado = {};
  for (const mapa of mapas) {
    for (const [tipo, campos] of Object.entries(mapa)) {
      for (const campo of Object.keys(campos)) {
        if (resultado[tipo]?.[campo]) {
          throw new Error(`Resolver duplicado: ${tipo}.${campo} está definido en dos módulos`);
        }
      }
      resultado[tipo] = { ...resultado[tipo], ...campos };
    }
  }
  return resultado;
}

export const resolvers = mergeResolvers(
  catalogoR.resolvers,
  pedidosR.resolvers,
  authR.resolvers,
  pagosR.resolvers,
  adminR.resolvers,
  inventarioR.resolvers,
  cuponesR.resolvers,
  configuracionR.resolvers,
  notificacionesR.resolvers,
  tiempoRealR.resolvers
);
