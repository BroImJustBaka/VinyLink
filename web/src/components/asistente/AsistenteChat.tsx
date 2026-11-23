// Isla del asistente de compras con IA ("Vinny"). Se monta en todas las
// páginas de la tienda con client:idle, así que no compite con lo que se ve
// primero. Un botón flotante abre el chat; las respuestas vienen del
// microservicio agente/ (Gemini con herramientas), a través de /api/agente.
//
// - La conversación sigue entre páginas: su id se guarda en sessionStorage
//   y al reabrir se baja el historial del servidor.
// - Las tarjetas de productos que encuentra el asistente se pueden agregar
//   al carrito ahí mismo.
// - El texto del asistente se muestra con un formato mínimo (párrafos, listas
//   y **negritas**) armado con elementos de React: nunca se inserta HTML.
import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { enviarMensaje, verConversacion, type MensajeChat, type ProductoSugerido } from "../../lib/agente.ts";
import { dinero } from "../../lib/formato.ts";
import { imagen } from "../../lib/imagen.ts";
import { mensajeDe } from "../../lib/tipos.ts";
import { useCartStore } from "../../stores/cart.ts";
import "../../styles/asistente.css";

const CLAVE = "vinylink-asistente";
const SUGERENCIAS = ["¿Qué audífonos inalámbricos tienen?", "Recomiéndame un vinilo de rock", "¿Dónde está mi pedido?"];
const BIENVENIDA: MensajeChat = {
  rol: "asistente",
  texto: "¡Hola! Soy Vinny, el asistente de VinyLink. Te ayudo a encontrar discos, audífonos e instrumentos, o a revisar tus pedidos. ¿Qué buscas?",
};

const leerId = (): string | null => {
  try {
    return sessionStorage.getItem(CLAVE);
  } catch {
    return null;
  }
};
const guardarId = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(CLAVE, id);
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: la conversación dura lo que la página */
  }
};

// **negritas** y rutas de la tienda (/login, /carrito, /perfil) como enlaces.
function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*|\/(?:login|carrito|perfil|checkout)\b)/g).map((parte, i) => {
    if (parte.startsWith("**") && parte.endsWith("**")) return <strong key={i}>{parte.slice(2, -2)}</strong>;
    if (/^\/(login|carrito|perfil|checkout)$/.test(parte))
      return (
        <a key={i} href={parte}>
          {parte}
        </a>
      );
    return parte;
  });
}

function Formato({ texto }: { texto: string }) {
  const bloques: ReactNode[] = [];
  let lista: string[] = [];
  const cerrarLista = () => {
    if (lista.length)
      bloques.push(
        <ul key={bloques.length}>
          {lista.map((li, i) => (
            <li key={i}>{enLinea(li)}</li>
          ))}
        </ul>
      );
    lista = [];
  };
  for (const linea of texto.split("\n")) {
    const item = linea.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      lista.push(item[1]);
      continue;
    }
    cerrarLista();
    if (linea.trim()) bloques.push(<p key={bloques.length}>{enLinea(linea.replace(/^#+\s*/, ""))}</p>);
  }
  cerrarLista();
  return <>{bloques}</>;
}

function Tarjetas({ productos }: { productos: ProductoSugerido[] }) {
  const agregar = useCartStore((s) => s.agregarProducto);
  const [agregados, setAgregados] = useState<Set<string>>(new Set());
  return (
    <ul className="asistente__productos">
      {productos.map((p) => (
        <li key={p.id} className="asistente__producto">
          <img src={imagen(p.imagen, 96)} alt="" width={48} height={48} loading="lazy" />
          <span className="asistente__producto-info">
            <strong>{p.nombre}</strong>
            <span>{dinero(p.precio)}</span>
          </span>
          <button
            type="button"
            className="btn btn--chico"
            disabled={agregados.has(p.id)}
            onClick={() => {
              agregar({ id: p.id, nombre: p.nombre, precio: p.precio, imagen: p.imagen }, 1);
              setAgregados((s) => new Set(s).add(p.id));
            }}
            aria-label={`Agregar ${p.nombre} al carrito`}
          >
            {agregados.has(p.id) ? "✓ Agregado" : "Agregar"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function AsistenteChat() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([BIENVENIDA]);
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historialCargado, setHistorialCargado] = useState(false);
  const id = useId();
  const entrada = useRef<HTMLTextAreaElement>(null);
  const final = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  // Al abrir por primera vez, se recupera la conversación de esta sesión.
  useEffect(() => {
    if (!abierto || historialCargado) return;
    setHistorialCargado(true);
    const guardado = leerId();
    if (!guardado) return;
    verConversacion(guardado)
      .then((r) => {
        setConversacionId(r.conversacionId);
        setMensajes([BIENVENIDA, ...r.mensajes]);
      })
      .catch(() => guardarId(null)); // vencida o de otra sesión: se empieza de nuevo
  }, [abierto, historialCargado]);

  useEffect(() => {
    if (!abierto) return;
    entrada.current?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  useEffect(() => {
    final.current?.scrollIntoView({ block: "end" });
  }, [mensajes, pensando, abierto]);

  async function mandar(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || pensando) return;
    setTexto("");
    setError(null);
    setMensajes((m) => [...m, { rol: "cliente", texto: limpio }]);
    setPensando(true);
    try {
      const r = await enviarMensaje(limpio, conversacionId);
      setConversacionId(r.conversacionId);
      guardarId(r.conversacionId);
      setMensajes((m) => [...m, { rol: "asistente", texto: r.respuesta, productos: r.productos }]);
    } catch (err) {
      setError(mensajeDe(err));
      // El mensaje no se procesó: se regresa al cuadro de texto para reintentar.
      setMensajes((m) => m.slice(0, -1));
      setTexto(limpio);
    } finally {
      setPensando(false);
      entrada.current?.focus();
    }
  }

  function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    mandar(texto);
  }

  function nueva() {
    guardarId(null);
    setConversacionId(null);
    setMensajes([BIENVENIDA]);
    setError(null);
    entrada.current?.focus();
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        className="asistente__boton"
        aria-expanded={abierto}
        aria-controls={`${id}-panel`}
        onClick={() => setAbierto((a) => !a)}
      >
        <span aria-hidden="true">{abierto ? "✕" : "💬"}</span>
        <span className="asistente__boton-texto">{abierto ? "Cerrar" : "Pregúntale a Vinny"}</span>
      </button>

      {abierto && (
        <section id={`${id}-panel`} className="asistente" role="dialog" aria-labelledby={`${id}-titulo`}>
          <header className="asistente__cabecera">
            <div>
              <h2 id={`${id}-titulo`}>Vinny</h2>
              <p>Asistente de compras con IA</p>
            </div>
            <button type="button" className="btn btn--link" onClick={nueva} disabled={pensando}>
              Nueva conversación
            </button>
          </header>

          <div className="asistente__mensajes" aria-live="polite" aria-busy={pensando}>
            {mensajes.map((m, i) => (
              <div key={i} className={`asistente__mensaje asistente__mensaje--${m.rol}`}>
                <span className="sr-only">{m.rol === "cliente" ? "Tú:" : "Vinny:"}</span>
                {m.rol === "asistente" ? <Formato texto={m.texto} /> : <p>{m.texto}</p>}
                {m.productos && m.productos.length > 0 && <Tarjetas productos={m.productos} />}
              </div>
            ))}
            {mensajes.length === 1 && !pensando && (
              <div className="asistente__sugerencias">
                {SUGERENCIAS.map((s) => (
                  <button key={s} type="button" className="btn btn--chico" onClick={() => mandar(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {pensando && (
              <p className="asistente__pensando" role="status">
                Vinny está buscando…
              </p>
            )}
            <div ref={final} />
          </div>

          {error && (
            <p className="asistente__error" role="alert">
              {error}
            </p>
          )}

          <form className="asistente__form" onSubmit={enviar}>
            <label htmlFor={`${id}-texto`} className="sr-only">
              Escribe tu pregunta
            </label>
            <textarea
              id={`${id}-texto`}
              ref={entrada}
              rows={1}
              maxLength={1000}
              value={texto}
              placeholder="Escribe tu pregunta…"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  mandar(texto);
                }
              }}
            />
            <button type="submit" className="btn btn--primario" disabled={pensando || !texto.trim()}>
              Enviar
            </button>
          </form>
          <p className="asistente__aviso">Las respuestas las genera una IA y pueden tener errores.</p>
        </section>
      )}
    </>
  );
}
