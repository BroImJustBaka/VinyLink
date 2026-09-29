import { useEffect, useState } from "react";
import { graphqlRequest } from "../api/client.js";

// Hook propio: dispara una query GraphQL cuando cambian `query`/`variables`
// y expone { data, cargando, error, recargar } al componente que lo use.
// Encapsula el patron cargando/error/data que pide la practica (seccion 7.3).
export function useGraphQL(query, variables) {
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;

    setCargando(true);
    setError(null);

    graphqlRequest(query, variables)
      .then((res) => {
        if (!cancelado) setData(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, JSON.stringify(variables), intento]);

  const recargar = () => setIntento((n) => n + 1);

  return { data, cargando, error, recargar };
}
