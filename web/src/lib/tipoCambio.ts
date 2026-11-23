// Tipo de cambio de Banxico para mostrar precios aproximados en dólares.
// Se pide una sola vez por página (y se comparte entre islas) y se guarda
// en sessionStorage para no repetir la consulta al navegar.
import { graphqlClient } from "./graphql.ts";
import { QUERY_TIPO_CAMBIO } from "./queries/integraciones.ts";
import type { TipoCambio } from "./tipos.ts";

const CLAVE = "vinylink-tipo-cambio";
let promesa: Promise<TipoCambio | null> | null = null;

export function obtenerTipoCambio(): Promise<TipoCambio | null> {
  if (promesa) return promesa;
  try {
    const guardado = sessionStorage.getItem(CLAVE);
    if (guardado) return (promesa = Promise.resolve(JSON.parse(guardado) as TipoCambio | null));
  } catch {
    // sessionStorage bloqueado: se consulta igual.
  }
  promesa = graphqlClient(QUERY_TIPO_CAMBIO)
    .then(({ tipoCambio }: { tipoCambio: TipoCambio | null }) => {
      try {
        sessionStorage.setItem(CLAVE, JSON.stringify(tipoCambio));
      } catch {
        /* sin almacenamiento: no pasa nada */
      }
      return tipoCambio;
    })
    .catch(() => null);
  return promesa;
}
