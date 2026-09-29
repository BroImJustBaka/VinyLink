import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs, resolvers } from "./schema.js";
import { initDb } from "./db.js";
import { getUserFromRequest } from "./modules/auth/context.js";

await initDb(); // crea tablas + siembra datos en PostgreSQL antes de levantar el servidor

const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  listen: { port: process.env.PORT ? Number(process.env.PORT) : 4000 },
  context: async ({ req }) => ({ user: await getUserFromRequest(req) }),
});

console.log(`Servidor GraphQL listo en ${url}`);
console.log("Abre esa URL en tu navegador para usar Apollo Sandbox.");
