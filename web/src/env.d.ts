// Archivo compartido (contrato de sesión, lo mantiene C).
type Usuario = {
  id: string;
  nombre: string;
  email: string;
  rol: "CLIENTE" | "ADMIN";
};

declare namespace App {
  interface Locals {
    // null = visitante sin sesión. Lo llena src/middleware.ts en cada request.
    user: Usuario | null;
  }
}

interface ImportMetaEnv {
  readonly GRAPHQL_URL?: string;
}
