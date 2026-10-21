// Arranque del backend. Usa Express (en vez del servidor "standalone" de
// Apollo) porque, además de GraphQL, necesitamos una ruta para el webhook de
// Stripe que reciba el cuerpo crudo de la petición para verificar su firma,
// la ruta de las imágenes subidas y el WebSocket de las subscriptions.
//
//   POST /webhooks/stripe  → avisos de Stripe (pagos OXXO, SPEI, links...)
//   GET  /imagenes/:id     → imágenes subidas desde el panel
//   GET/POST /             → API GraphQL (en el navegador abre Apollo Sandbox)
//   WS   /graphql          → subscriptions (protocolo graphql-ws)
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { typeDefs, resolvers } from "./schema.js";
import { initDb } from "./db.js";
import { getUserFromRequest, getTokenFromRequest } from "./modules/auth/context.js";
import { revisarConfiguracion } from "./modules/pagos/stripe.js";
import { manejarWebhookStripe } from "./modules/pagos/webhook.js";
import { iniciarRevisionDeVencimientos } from "./modules/pagos/vencimientos.js";
import { servirImagen } from "./modules/catalogo/imagenes.js";
import { canjearTicket } from "./modules/tiempo-real/tickets.js";

await initDb(); // crea tablas + siembra datos en PostgreSQL antes de levantar el servidor
revisarConfiguracion();

const app = express();
const httpServer = http.createServer(app);

// Un solo esquema para HTTP (queries y mutations) y WebSocket (subscriptions).
const schema = makeExecutableSchema({ typeDefs, resolvers });

// El webhook va ANTES de express.json(): Stripe firma los bytes exactos que
// manda, así que aquí el cuerpo debe llegar sin convertir (express.raw).
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), manejarWebhookStripe);
app.get("/imagenes/:id", servirImagen);

// WebSocket para las subscriptions, en el mismo puerto que la API.
// La sesión llega como un ticket de un solo uso (ver tiempo-real/tickets.js);
// sin ticket la conexión es anónima y solo sirve para lo público (stock).
const wsServer = new WebSocketServer({ server: httpServer, path: "/graphql" });
const limpiezaWs = useServer(
  {
    schema,
    // El usuario se resuelve UNA vez, al conectar (onConnect), y se reutiliza.
    context: (ctx) => ({ user: ctx.extra.usuario ?? null, token: null }),
    onConnect: async (ctx) => {
      // Un ticket inválido o vencido cierra la conexión (4403 Forbidden).
      if (ctx.connectionParams?.ticket) {
        ctx.extra.usuario = await canjearTicket(ctx.connectionParams.ticket);
        if (!ctx.extra.usuario) return false;
      } else {
        ctx.extra.usuario = null;
      }
      return true;
    },
  },
  wsServer
);

const server = new ApolloServer({
  schema,
  plugins: [
    // Al apagar el servidor, espera a que terminen las peticiones en curso...
    ApolloServerPluginDrainHttpServer({ httpServer }),
    // ...y cierra los WebSockets abiertos.
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await limpiezaWs.dispose();
          },
        };
      },
    },
  ],
});
await server.start();

app.use(
  "/",
  // 8 MB: las imágenes del panel viajan en base64 (5 MB de imagen ≈ 6.7 MB de texto).
  express.json({ limit: "8mb" }),
  expressMiddleware(server, {
    context: async ({ req }) => ({
      user: await getUserFromRequest(req),
      token: getTokenFromRequest(req),
    }),
  })
);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
await new Promise((resolver) => httpServer.listen({ port }, resolver));

console.log(`Servidor GraphQL listo en http://localhost:${port}/`);
console.log("Abre esa URL en tu navegador para usar Apollo Sandbox.");
console.log(`Subscriptions (WebSocket) en ws://localhost:${port}/graphql`);
console.log(`Webhook de Stripe en http://localhost:${port}/webhooks/stripe`);

iniciarRevisionDeVencimientos();
