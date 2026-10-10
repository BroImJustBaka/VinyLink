// Arranque del backend. Usa Express (en vez del servidor "standalone" de
// Apollo) porque, además de GraphQL, necesitamos una ruta para el webhook de
// Stripe que reciba el cuerpo crudo de la petición para verificar su firma.
//
//   POST /webhooks/stripe  → avisos de Stripe (pagos OXXO, SPEI, links...)
//   GET/POST /             → API GraphQL (en el navegador abre Apollo Sandbox)
import http from "node:http";
import express from "express";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { typeDefs, resolvers } from "./schema.js";
import { initDb } from "./db.js";
import { getUserFromRequest, getTokenFromRequest } from "./modules/auth/context.js";
import { revisarConfiguracion } from "./modules/pagos/stripe.js";
import { manejarWebhookStripe } from "./modules/pagos/webhook.js";
import { iniciarRevisionDeVencimientos } from "./modules/pagos/vencimientos.js";

await initDb(); // crea tablas + siembra datos en PostgreSQL antes de levantar el servidor
revisarConfiguracion();

const app = express();
const httpServer = http.createServer(app);

// El webhook va ANTES de express.json(): Stripe firma los bytes exactos que
// manda, así que aquí el cuerpo debe llegar sin convertir (express.raw).
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), manejarWebhookStripe);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  // Al apagar el servidor, espera a que terminen las peticiones en curso.
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
});
await server.start();

app.use(
  "/",
  express.json({ limit: "1mb" }),
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
console.log(`Webhook de Stripe en http://localhost:${port}/webhooks/stripe`);

iniciarRevisionDeVencimientos();
