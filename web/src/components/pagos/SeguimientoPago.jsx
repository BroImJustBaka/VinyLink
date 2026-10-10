// Isla de /pedido/[id] (client:load).
//
// Mientras el pedido espera su pago, cada pocos segundos le pide al backend
// que revise con Stripe (sincronizarPago). Si el estado cambió (se pagó la
// ficha OXXO, llegó la transferencia, venció...) recarga la página para
// mostrar el estado nuevo. También tiene el botón "Cancelar pedido".
import { useEffect, useState } from "react";
import { graphqlClient } from "../../lib/graphql.ts";
import { MUTATION_CANCELAR_PEDIDO, MUTATION_SINCRONIZAR_PAGO } from "../../lib/queries/pagos.js";

const RAPIDO = 15; // primeras 15 revisiones cada 4 s (1 minuto)
const MAXIMO = 15 + 56; // luego cada 15 s hasta completar ~15 minutos

export default function SeguimientoPago({ pedidoId, estado, puedeCancelar = false }) {
  const [trabajando, setTrabajando] = useState(null); // "cancelar" | null
  const [error, setError] = useState(null);

  useEffect(() => {
    if (estado !== "pendiente") return;
    let vueltas = 0;
    let temporizador;
    let activo = true;

    async function revisar() {
      vueltas += 1;
      try {
        const { sincronizarPago } = await graphqlClient(MUTATION_SINCRONIZAR_PAGO, { pedidoId });
        if (sincronizarPago && sincronizarPago.estado !== estado) {
          window.location.reload();
          return;
        }
      } catch {
        /* sin red o backend caído: se intenta en la siguiente vuelta */
      }
      if (activo && vueltas < MAXIMO) {
        temporizador = setTimeout(revisar, vueltas < RAPIDO ? 4000 : 15000);
      }
    }

    temporizador = setTimeout(revisar, 3000);
    // Al salir de la página se detiene el sondeo.
    return () => {
      activo = false;
      clearTimeout(temporizador);
    };
  }, [pedidoId, estado]);

  async function ejecutar(accion, mutacion, variables) {
    setTrabajando(accion);
    setError(null);
    try {
      await graphqlClient(mutacion, variables);
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setTrabajando(null);
    }
  }

  if (estado !== "pendiente") return null;

  return (
    <div className="seguimiento">
      <p className="seguimiento__estado" role="status">
        <span className="seguimiento__punto" aria-hidden="true"></span>
        Esperando la confirmación del pago. Esta página se actualiza sola.
      </p>

      {puedeCancelar && (
        <div className="seguimiento__acciones">
          {puedeCancelar && (
            <button
              className="btn btn--link"
              type="button"
              disabled={trabajando !== null}
              onClick={() => {
                if (confirm("¿Cancelar este pedido? Ya no se podrá pagar.")) {
                  ejecutar("cancelar", MUTATION_CANCELAR_PEDIDO, { id: pedidoId });
                }
              }}
            >
              {trabajando === "cancelar" ? "Cancelando..." : "Cancelar pedido"}
            </button>
          )}
        </div>
      )}

      {error && <p className="error-box">{error}</p>}
    </div>
  );
}
