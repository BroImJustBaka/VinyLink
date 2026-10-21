// Isla (client:only) que sigue un pedido con la subscription
// `pedidoActualizado(id)`. Cuando cambia algo que la página muestra (estado,
// guía, reembolsos, notas), ofrece recargar; con `recargarSolo` recarga
// directamente (página del cliente, que no tiene formularios a medias).
import { useEffect, useRef, useState } from "react";
import { suscribirse } from "../../lib/tiempoReal.js";
import { ESTADOS_PEDIDO } from "../../lib/formato.js";

const SUBSCRIPTION = `
  subscription PedidoActualizado($id: ID) {
    pedidoActualizado(id: $id) { id estado numeroGuia montoReembolsado historial { fecha } }
  }
`;

const huella = (p) => JSON.stringify([p.estado, p.numeroGuia, p.montoReembolsado, p.historial?.length]);

export default function PedidoEnVivo({ pedidoId, estado, numeroGuia = null, montoReembolsado = 0, eventos = 0, recargarSolo = false }) {
  const inicial = useRef(huella({ estado, numeroGuia, montoReembolsado, historial: { length: eventos } }));
  const [cambio, setCambio] = useState(null);

  useEffect(
    () =>
      suscribirse(SUBSCRIPTION, { id: String(pedidoId) }, ({ pedidoActualizado: p }) => {
        if (huella(p) === inicial.current) return;
        if (recargarSolo) window.location.reload();
        else setCambio(p);
      }),
    [pedidoId, recargarSolo]
  );

  if (!cambio) return null;
  return (
    <div className="aviso-vivo" role="status">
      <span>
        Este pedido acaba de cambiar
        {cambio.estado !== estado ? ` (ahora: ${ESTADOS_PEDIDO[cambio.estado] ?? cambio.estado})` : ""}.
      </span>
      <button className="btn btn--chico btn--primario" onClick={() => window.location.reload()}>
        Ver cambios
      </button>
    </div>
  );
}
