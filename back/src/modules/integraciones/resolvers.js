import { one } from "../../lib/sql.js";
import { requireUser, requirePermiso } from "../auth/context.js";
import { ES_ID } from "../pedidos/servicio.js";
import { stripe } from "../pagos/stripe.js";
import { paypalHabilitado } from "../pagos/paypal.js";
import { obtenerTipoCambio, banxicoHabilitado } from "./banxico.js";
import { consultarCodigoPostal, copomexHabilitado } from "./copomex.js";
import { buscarPrecios, mercadoLibreHabilitado } from "./mercadolibre.js";

const agenteConfigurado = Boolean(process.env.AGENTE_URL?.trim());

export const resolvers = {
  Query: {
    tipoCambio: () => obtenerTipoCambio(),

    codigoPostal: (_padre, { cp }, context) => {
      // Con sesión: el checkout ya la exige y así nadie gasta las consultas
      // de COPOMEX desde fuera de la tienda.
      requireUser(context);
      return consultarCodigoPostal(cp);
    },

    adminPreciosMercadoLibre: async (_padre, { productoId, busqueda }, context) => {
      requirePermiso(context, "catalogo", "reportes");
      const producto = ES_ID.test(String(productoId))
        ? await one("SELECT id, nombre, precio FROM producto WHERE id = $1", [productoId])
        : null;
      if (!producto) throw new Error(`No existe el producto con id ${productoId}`);
      const r = await buscarPrecios(busqueda?.trim() || producto.nombre);
      const precioTienda = Number(producto.precio);
      return {
        ...r,
        precioTienda,
        diferenciaPorcentaje: r.mediana ? Math.round(((precioTienda - r.mediana) / r.mediana) * 1000) / 10 : null,
      };
    },

    adminIntegraciones: (_padre, _args, context) => {
      requirePermiso(context, "configuracion");
      return [
        { clave: "stripe", nombre: "Stripe", uso: "Tarjetas, OXXO, SPEI y links de pago", configurada: Boolean(stripe), variables: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"] },
        { clave: "paypal", nombre: "PayPal", uso: "Pago con cuenta PayPal", configurada: paypalHabilitado, variables: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] },
        { clave: "mercadolibre", nombre: "Mercado Libre", uso: "Comparador de precios en el panel", configurada: mercadoLibreHabilitado, variables: ["MELI_CLIENT_ID", "MELI_CLIENT_SECRET"] },
        { clave: "banxico", nombre: "Banxico SIE", uso: "Precios en dólares con el tipo de cambio oficial", configurada: banxicoHabilitado, variables: ["BANXICO_TOKEN"] },
        { clave: "copomex", nombre: "COPOMEX", uso: "Autollenado de la dirección por código postal", configurada: copomexHabilitado, variables: ["COPOMEX_TOKEN"] },
        { clave: "ia", nombre: "Gemini (Google AI Studio)", uso: "Asistente de compras con IA (microservicio agente/)", configurada: agenteConfigurado, variables: ["AGENTE_URL (y GEMINI_API_KEY en agente/.env)"] },
      ];
    },
  },
};
