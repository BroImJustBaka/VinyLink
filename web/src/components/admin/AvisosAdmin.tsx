// Isla del panel (client:only): avisos en tiempo real con la subscription
// `eventosAdmin` — pedidos nuevos, pagos, cancelaciones, stock bajo y lo que
// hace el resto del personal. Muestra cada aviso unos segundos en una
// esquina, un indicador "● En vivo" y avisa a la página con un evento
// `vinylink:evento-admin` (la lista de pedidos lo usa para ofrecer recargar).
import { useEffect, useState } from "react";
import { suscribirse, alCambiarConexion, type EstadoConexion } from "../../lib/tiempoReal.ts";
import type { EventoAdmin } from "../../lib/tipos.ts";

interface Aviso extends EventoAdmin {
  id: number;
}

const SUBSCRIPTION = `
  subscription EventosAdmin {
    eventosAdmin { tipo mensaje pedidoId productoId fecha }
  }
`;

const ICONOS: Record<string, string> = {
  pedido_nuevo: "🛒",
  pago_recibido: "💳",
  pedido_cancelado: "✕",
  reembolso: "↩",
  stock_bajo: "⚠",
  accion: "✎",
};

const DURACION_MS = 8000;

function enlace(e: EventoAdmin) {
  if (e.pedidoId) return `/admin/pedidos/${e.pedidoId}`;
  if (e.productoId) return `/admin/inventario?producto=${e.productoId}`;
  return null;
}

export default function AvisosAdmin() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [conexion, setConexion] = useState<EstadoConexion>("conectando");

  useEffect(() => alCambiarConexion(setConexion), []);

  useEffect(() => {
    let siguiente = 0;
    const cancelar = suscribirse<{ eventosAdmin: EventoAdmin }>(SUBSCRIPTION, {}, ({ eventosAdmin: e }) => {
      const id = ++siguiente;
      setAvisos((lista) => [...lista.slice(-3), { ...e, id }]);
      setTimeout(() => setAvisos((lista) => lista.filter((a) => a.id !== id)), DURACION_MS);
      window.dispatchEvent(new CustomEvent("vinylink:evento-admin", { detail: e }));
    });
    return cancelar;
  }, []);

  const quitar = (id: number) => setAvisos((lista) => lista.filter((a) => a.id !== id));

  return (
    <>
      <p className={`en-vivo en-vivo--${conexion}`} title="Avisos en tiempo real por WebSocket">
        <span aria-hidden="true">●</span>{" "}
        {conexion === "conectado" ? "En vivo" : conexion === "conectando" ? "Conectando…" : "Sin conexión en vivo"}
      </p>
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => {
          const href = enlace(a);
          return (
            <div key={a.id} className={`aviso aviso--${a.tipo}`}>
              <span className="aviso__icono" aria-hidden="true">
                {ICONOS[a.tipo] ?? "•"}
              </span>
              <span className="aviso__texto">{href ? <a href={href}>{a.mensaje}</a> : a.mensaje}</span>
              <button className="aviso__cerrar" onClick={() => quitar(a.id)} aria-label="Cerrar aviso">
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
