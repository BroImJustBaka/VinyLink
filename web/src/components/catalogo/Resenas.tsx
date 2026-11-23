// Reseñas de un producto (dentro del ProductModal). Se guardan en MongoDB a
// través del microservicio del agente. Cualquiera las lee; para escribir una
// hay que iniciar sesión, y cada cliente tiene una sola por producto (la
// segunda reemplaza a la primera). "Compra verificada" = el cliente tiene un
// pedido pagado con ese producto.
import { useEffect, useId, useState, type SubmitEvent } from "react";
import {
  borrarResena,
  guardarResena,
  verResenas,
  type NuevaResena,
  type Resenas as DatosResenas,
} from "../../lib/agente.ts";
import { fecha } from "../../lib/formato.ts";
import { mensajeDe } from "../../lib/tipos.ts";

interface Props {
  productoId: string;
  conSesion: boolean;
}

export function Estrellas({ valor, etiqueta }: { valor: number; etiqueta?: string }) {
  const llenas = Math.round(valor);
  return (
    <span className="estrellas" role="img" aria-label={etiqueta ?? `${valor} de 5 estrellas`}>
      {"★".repeat(llenas)}
      <span className="estrellas__vacias">{"★".repeat(5 - llenas)}</span>
    </span>
  );
}

const VACIA: NuevaResena = { calificacion: 0, titulo: "", texto: "" };

export default function Resenas({ productoId, conSesion }: Props) {
  const [datos, setDatos] = useState<DatosResenas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [nueva, setNueva] = useState<NuevaResena>(VACIA);
  const [enviando, setEnviando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const idForm = useId();

  useEffect(() => {
    let vigente = true;
    setDatos(null);
    setError(null);
    setFormAbierto(false);
    verResenas(productoId)
      .then((d) => vigente && setDatos(d))
      .catch((e: unknown) => vigente && setError(mensajeDe(e)));
    return () => {
      vigente = false;
    };
  }, [productoId]);

  const mia = datos?.resenas.find((r) => r.esMia);

  function abrirForm() {
    setNueva(mia ? { calificacion: mia.calificacion, titulo: mia.titulo, texto: mia.texto } : VACIA);
    setErrorForm(null);
    setFormAbierto(true);
  }

  async function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (nueva.calificacion < 1) return setErrorForm("Elige de 1 a 5 estrellas.");
    setEnviando(true);
    setErrorForm(null);
    try {
      setDatos(await guardarResena(productoId, nueva));
      setFormAbierto(false);
    } catch (err) {
      setErrorForm(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  async function borrar() {
    setEnviando(true);
    try {
      setDatos(await borrarResena(productoId));
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="resenas" aria-labelledby={`${idForm}-titulo`}>
      <h3 id={`${idForm}-titulo`}>Reseñas</h3>
      {error && <p className="muted">{error}</p>}
      {!datos && !error && <p className="muted">Cargando reseñas…</p>}

      {datos && (
        <>
          {datos.total > 0 && datos.promedio !== null ? (
            <p className="resenas__resumen">
              <Estrellas valor={datos.promedio} etiqueta={`Promedio: ${datos.promedio} de 5 estrellas`} />
              <strong>{datos.promedio.toFixed(1)}</strong>
              <span className="muted">
                ({datos.total} {datos.total === 1 ? "reseña" : "reseñas"})
              </span>
            </p>
          ) : (
            <p className="muted">Todavía no hay reseñas. ¡Sé la primera persona en opinar!</p>
          )}

          {!formAbierto &&
            (conSesion ? (
              <div className="resenas__acciones">
                <button type="button" className="btn btn--chico" onClick={abrirForm}>
                  {mia ? "Editar mi reseña" : "Escribir una reseña"}
                </button>
                {mia && (
                  <button type="button" className="btn btn--chico btn--peligro" onClick={borrar} disabled={enviando}>
                    Borrar mi reseña
                  </button>
                )}
              </div>
            ) : (
              <p className="muted">
                <a href={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Inicia sesión</a>{" "}
                para escribir una reseña.
              </p>
            ))}

          {formAbierto && (
            <form className="resenas__form" onSubmit={enviar}>
              <fieldset className="resenas__calificar">
                <legend>Calificación</legend>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className={n <= nueva.calificacion ? "activa" : undefined}>
                    <input
                      type="radio"
                      name={`${idForm}-calificacion`}
                      value={n}
                      checked={nueva.calificacion === n}
                      onChange={() => setNueva({ ...nueva, calificacion: n })}
                    />
                    <span aria-hidden="true">★</span>
                    <span className="sr-only">
                      {n} {n === 1 ? "estrella" : "estrellas"}
                    </span>
                  </label>
                ))}
              </fieldset>
              <label htmlFor={`${idForm}-tit`}>Título</label>
              <input
                id={`${idForm}-tit`}
                required
                minLength={3}
                maxLength={80}
                value={nueva.titulo}
                onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })}
              />
              <label htmlFor={`${idForm}-txt`}>Tu opinión</label>
              <textarea
                id={`${idForm}-txt`}
                required
                minLength={10}
                maxLength={1000}
                rows={3}
                value={nueva.texto}
                onChange={(e) => setNueva({ ...nueva, texto: e.target.value })}
              />
              {errorForm && (
                <p className="error-texto" role="alert">
                  {errorForm}
                </p>
              )}
              <div className="resenas__acciones">
                <button type="submit" className="btn btn--primario btn--chico" disabled={enviando}>
                  {enviando ? "Guardando…" : "Publicar"}
                </button>
                <button type="button" className="btn btn--chico" onClick={() => setFormAbierto(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {datos.resenas.length > 0 && (
            <ul className="resenas__lista">
              {datos.resenas.map((r) => (
                <li key={r.id}>
                  <p className="resenas__cabecera">
                    <Estrellas valor={r.calificacion} />
                    <strong>{r.titulo}</strong>
                  </p>
                  <p>{r.texto}</p>
                  <p className="muted resenas__autor">
                    {r.autor} · {fecha(r.fecha)}
                    {r.compraVerificada && <span className="resenas__verificada"> · ✓ Compra verificada</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
