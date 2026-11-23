// Subscriptions de GraphQL en el navegador (protocolo graphql-ws).
//
// Una sola conexión WebSocket por pestaña, compartida por todas las islas.
// Antes de conectar (y en cada reconexión) se pide un ticket de un solo uso
// con la mutación ticketTiempoReal, que pasa por /api/graphql y por eso lleva
// la cookie de sesión. Sin sesión, la conexión es anónima y solo sirve para
// lo público (stock en vivo).
import { createClient, type Client } from "graphql-ws";
import { graphqlClient } from "./graphql.ts";
import { MUTATION_TICKET_TIEMPO_REAL } from "./queries/auth.ts";

const URL_WS = import.meta.env.PUBLIC_GRAPHQL_WS_URL ?? "ws://localhost:4000/graphql";

export type EstadoConexion = "conectando" | "conectado" | "desconectado";

let cliente: Client | null = null;
const oyentesEstado = new Set<(estado: EstadoConexion) => void>();
let estadoActual: EstadoConexion = "conectando";

function avisarEstado(estado: EstadoConexion) {
  estadoActual = estado;
  for (const fn of oyentesEstado) fn(estado);
}

function obtenerCliente(): Client {
  if (cliente) return cliente;
  cliente = createClient({
    url: URL_WS,
    // Función: se llama en cada (re)conexión, así cada intento usa un ticket nuevo.
    connectionParams: async () => {
      try {
        const { ticketTiempoReal } = await graphqlClient(MUTATION_TICKET_TIEMPO_REAL);
        return { ticket: ticketTiempoReal };
      } catch {
        return {}; // sin sesión: conexión anónima
      }
    },
    // Si se cae la red o se reinicia el backend, reintenta con espera creciente.
    retryAttempts: Infinity,
    shouldRetry: () => true,
    retryWait: async (intento) => new Promise<void>((r) => setTimeout(r, Math.min(1000 * 2 ** intento, 15000))),
    on: {
      connecting: () => avisarEstado("conectando"),
      connected: () => avisarEstado("conectado"),
      closed: () => avisarEstado("desconectado"),
    },
  });
  return cliente;
}

// suscribirse(QUERY, variables, (data) => ..., (mensaje) => ...) → función para cancelar.
export function suscribirse<T = any>(
  query: string,
  variables: Record<string, unknown>,
  alRecibir: (data: T) => void,
  alFallar?: (mensaje: string) => void
): () => void {
  return obtenerCliente().subscribe(
    { query, variables },
    {
      next: (r) => (r.errors ? alFallar?.(r.errors[0].message) : alRecibir(r.data as T)),
      error: (e: unknown) => {
        const mensaje = Array.isArray(e)
          ? e[0]?.message
          : (e as { reason?: string } | null)?.reason;
        alFallar?.(mensaje || "Se perdió la conexión en vivo");
      },
      complete: () => {},
    }
  );
}

// Para el indicador "● En vivo": avisa cuando la conexión cambia de estado.
export function alCambiarConexion(fn: (estado: EstadoConexion) => void): () => void {
  oyentesEstado.add(fn);
  fn(estadoActual);
  return () => {
    oyentesEstado.delete(fn);
  };
}
