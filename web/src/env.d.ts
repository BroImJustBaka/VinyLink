/// <reference types="astro/client" />
// Archivo compartido (contrato de sesión, lo mantiene C).
type Usuario = {
  id: string;
  nombre: string;
  email: string;
  rol: "CLIENTE" | "ADMIN" | "ALMACEN" | "SOPORTE" | "FINANZAS";
  // Permisos del panel según el rol (vacío para un cliente). Ver lib/permisos.js.
  permisos: string[];
};

declare namespace App {
  interface Locals {
    // null = visitante sin sesión. Lo llena src/middleware.ts en cada request.
    user: Usuario | null;
  }
}

interface ImportMetaEnv {
  readonly GRAPHQL_URL?: string;
  // WebSocket de las subscriptions; lo usa el navegador (por eso PUBLIC_).
  readonly PUBLIC_GRAPHQL_WS_URL?: string;
}
