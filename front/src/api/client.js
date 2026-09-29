// Cliente GraphQL minimo: una funcion que envia { query, variables } por POST
// al unico endpoint del backend y regresa `data` o lanza un Error con el
// mensaje que mande el servidor.

const ENDPOINT = import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/";

export async function graphqlRequest(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Error de red (${res.status}) al contactar el servidor`);
  }

  const { data, errors } = await res.json();
  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }
  return data;
}
