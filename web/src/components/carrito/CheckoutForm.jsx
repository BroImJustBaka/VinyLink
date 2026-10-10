// Dueño: Persona B. Checkout con los cinco métodos de pago de Stripe.
//
// - Crédito / débito: el formulario de tarjeta es el Payment Element de
//   Stripe (un iframe: los números de la tarjeta nunca pasan por nuestro
//   servidor). Stripe.js lo convierte en un ConfirmationToken y el backend
//   cobra con él.
// - OXXO, SPEI y link de pago: el backend genera la ficha, la CLABE o el link
//   y aquí solo se redirige a /pedido/[id], donde se muestran.
//
// El total que se cobra lo calcula el backend con los precios de la base de
// datos; el de aquí es solo para mostrarlo.
import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useCartStore } from "../../stores/cart.js";
import { graphqlClient } from "../../lib/graphql.ts";
import { ERROR_SIN_SESION } from "../../lib/queries/pedidos.js";
import {
  MUTATION_CANCELAR_PEDIDO,
  MUTATION_CREAR_PEDIDO,
  MUTATION_SINCRONIZAR_PAGO,
} from "../../lib/queries/pagos.js";
import { dinero } from "../../lib/formato.js";

const METODOS = [
  {
    id: "credito",
    titulo: "Tarjeta de crédito",
    detalle: "Visa, Mastercard o American Express. Puedes pagar a meses sin intereses.",
  },
  { id: "debito", titulo: "Tarjeta de débito", detalle: "El cargo se hace al momento." },
  {
    id: "oxxo",
    titulo: "Efectivo en OXXO",
    detalle: "Te damos una ficha para pagar en cualquier OXXO. Vence en 3 días.",
  },
  {
    id: "spei",
    titulo: "Transferencia SPEI",
    detalle: "Te damos una CLABE para transferir desde la app de tu banco.",
  },
  {
    id: "link",
    titulo: "Link de pago",
    detalle: "Un link para pagar después o para que otra persona pague por ti.",
  },
];

// Colores y tipografía de la tienda para el formulario de Stripe.
const APARIENCIA = {
  theme: "stripe",
  variables: {
    colorPrimary: "#59604a",
    colorText: "#242321",
    colorTextSecondary: "#765640",
    colorBackground: "#fffdf8",
    colorDanger: "#8a4229",
    fontFamily: '"DM Sans", system-ui, sans-serif',
    borderRadius: "6px",
  },
};
const FUENTES = [{ cssSrc: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" }];

// loadStripe descarga Stripe.js una sola vez; se guarda la promesa.
let stripePromise = null;
const obtenerStripe = (llave) => (stripePromise ??= loadStripe(llave));

export default function CheckoutForm({ user = null, pagos = null, errorConfig = null }) {
  const items = useCartStore((s) => s.items);
  const total = useCartStore((s) => s.total());
  const limpiarLocal = useCartStore((s) => s.limpiarLocal);
  const [metodo, setMetodo] = useState("credito");

  if (items.length === 0) {
    return (
      <section>
        <h2>Checkout</h2>
        <p className="muted">
          No hay nada que pagar: tu carrito está vacío. <a href="/">Seguir comprando</a>
        </p>
      </section>
    );
  }

  // Llama al backend: crea el pedido, aparta el stock y pide el cobro a Stripe.
  async function crearPedido(pago) {
    const data = { items: items.map((it) => ({ productoId: it.id, cantidad: it.cantidad })) };
    const { crearPedido } = await graphqlClient(MUTATION_CREAR_PEDIDO, { data, pago });
    return crearPedido;
  }

  // El pedido ya existe: se vacía el carrito local y se va a su página.
  function irAlPedido(pedidoId) {
    limpiarLocal();
    window.location.href = `/pedido/${pedidoId}`;
  }

  const props = { crearPedido, irAlPedido, total, user, modoPrueba: pagos?.modoPrueba };
  const totalCentavos = Math.round(total * 100);
  const oxxoBloqueado = pagos && total > pagos.maximoOxxo;

  return (
    <section className="checkout">
      <a href="/carrito">← Volver al carrito</a>
      <h2>Checkout</h2>

      {pagos?.habilitado && pagos.modoPrueba && (
        <p className="aviso-prueba">
          <strong>Modo de prueba.</strong> No se cobra dinero real: usa las tarjetas y datos de
          prueba que aparecen en cada método.
        </p>
      )}

      <div className="checkout__columnas">
        <div className="checkout__pago">
          {!pagos?.habilitado ? (
            <div className="error-box">
              <p>
                {errorConfig
                  ? `No se pudo cargar la configuración de pagos: ${errorConfig}`
                  : "Los pagos en línea no están configurados. Agrega las llaves de Stripe en back/.env y reinicia el backend."}
              </p>
            </div>
          ) : (
            <>
              <fieldset className="metodos">
                <legend>¿Cómo quieres pagar?</legend>
                {METODOS.map((m) => {
                  const bloqueado = m.id === "oxxo" && oxxoBloqueado;
                  return (
                    <label
                      key={m.id}
                      className={`metodo ${metodo === m.id ? "metodo--activo" : ""} ${bloqueado ? "metodo--bloqueado" : ""}`}
                    >
                      <input
                        type="radio"
                        name="metodo"
                        value={m.id}
                        checked={metodo === m.id}
                        disabled={bloqueado}
                        onChange={() => setMetodo(m.id)}
                      />
                      <span className="metodo__texto">
                        <strong>{m.titulo}</strong>
                        <span className="muted">
                          {bloqueado
                            ? `OXXO acepta hasta ${dinero(pagos.maximoOxxo)} por ficha.`
                            : m.detalle}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="metodo-panel">
                {(metodo === "credito" || metodo === "debito") && (
                  // key={metodo}: al cambiar entre crédito y débito se vuelve a
                  // montar el formulario (las opciones de Stripe no se pueden cambiar).
                  <Elements
                    key={metodo}
                    stripe={obtenerStripe(pagos.publishableKey)}
                    options={{
                      mode: "payment",
                      amount: totalCentavos,
                      currency: "mxn",
                      paymentMethodTypes: ["card"],
                      // Selector de meses sin intereses dentro del formulario (solo crédito).
                      ...(metodo === "credito"
                        ? { paymentMethodOptions: { card: { installments: { enabled: true } } } }
                        : {}),
                      locale: "es-419",
                      appearance: APARIENCIA,
                      fonts: FUENTES,
                    }}
                  >
                    <FormTarjeta metodo={metodo} {...props} />
                  </Elements>
                )}
                {metodo === "oxxo" && <FormOxxo {...props} />}
                {metodo === "spei" && (
                  <FormSinDatos
                    metodo="spei"
                    boton="Generar CLABE para transferir"
                    texto="Al continuar te mostramos una CLABE y la referencia. Haz la transferencia desde la app de tu banco por el monto exacto; el pedido se confirma solo cuando llega (tienes 3 días)."
                    pruebas="En la página del pedido aparecerá un botón para simular la transferencia."
                    {...props}
                  />
                )}
                {metodo === "link" && (
                  <FormSinDatos
                    metodo="link"
                    boton="Generar link de pago"
                    texto="Te damos un link seguro de Stripe que puedes abrir ahora, guardar o mandar por WhatsApp. Se puede pagar con tarjeta u OXXO y es válido por 24 horas."
                    pruebas="En la página de Stripe paga con la tarjeta 4242 4242 4242 4242."
                    {...props}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <aside className="checkout__resumen" aria-label="Resumen del pedido">
          <h3>Tu pedido</h3>
          <ul>
            {items.map((it) => (
              <li key={it.id}>
                <span>
                  {it.cantidad} × {it.nombre}
                </span>
                <span>{dinero(it.precio * it.cantidad)}</span>
              </li>
            ))}
          </ul>
          <p className="checkout__total">
            <span>Total</span>
            <strong>{dinero(total)}</strong>
          </p>
          {user && (
            <p className="muted">
              Comprando como {user.nombre} ({user.email})
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

// Mensaje de error, con enlace a /login si el problema es la sesión.
function ErrorPago({ error }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <p>
        {error.includes(ERROR_SIN_SESION) ? (
          <>
            Necesitas iniciar sesión para finalizar la compra. <a href="/login?next=/checkout">Iniciar sesión</a>
          </>
        ) : (
          error
        )}
      </p>
    </div>
  );
}

function PistasPrueba({ children }) {
  return (
    <details className="pistas-prueba">
      <summary>Datos de prueba</summary>
      {children}
    </details>
  );
}

function FormTarjeta({ metodo, crearPedido, irAlPedido, total, modoPrueba }) {
  const stripe = useStripe();
  const elements = useElements();
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function pagar(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setEnviando(true);
    setError(null);

    try {
      // 1) Stripe valida los campos (número, fecha, CVC) en el navegador.
      const { error: errorCampos } = await elements.submit();
      if (errorCampos) throw new Error(errorCampos.message);

      // 2) Los datos de la tarjeta se convierten en un token que solo sirve una vez.
      const { error: errorToken, confirmationToken } = await stripe.createConfirmationToken({
        elements,
      });
      if (errorToken) throw new Error(errorToken.message);

      // 3) El backend revisa crédito/débito, aparta el stock y cobra.
      const r = await crearPedido({ metodo, confirmationTokenId: confirmationToken.id });

      // 4) Si el banco pide 3D Secure, Stripe muestra su ventana de verificación.
      if (r.requiereAccion) {
        const { error: error3ds } = await stripe.handleNextAction({ clientSecret: r.clientSecret });
        // Pase lo que pase, el backend le pregunta a Stripe el resultado real.
        const { sincronizarPago: pedido } = await graphqlClient(MUTATION_SINCRONIZAR_PAGO, {
          pedidoId: r.pedido.id,
        });
        if (pedido.estado !== "pagado") {
          // Si se quedó a medias, se cancela para liberar el stock de inmediato.
          if (pedido.estado === "pendiente") {
            await graphqlClient(MUTATION_CANCELAR_PEDIDO, { id: pedido.id }).catch(() => {});
          }
          throw new Error(
            pedido.pago?.error ?? error3ds?.message ?? "No se completó la verificación de tu banco."
          );
        }
      }
      irAlPedido(r.pedido.id);
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={pagar} className="checkout-form checkout-form--ancho">
      <PaymentElement
        onReady={() => setListo(true)}
        // Si Stripe.js no puede mostrar el formulario (llave mal copiada, sin
        // internet...) se explica en vez de dejar solo un botón desactivado.
        onLoadError={({ error: e }) =>
          setError(`No se pudo cargar el formulario de tarjeta de Stripe: ${e?.message ?? "error desconocido"}`)
        }
        options={{ layout: "tabs" }}
      />

      {modoPrueba && (
        <PistasPrueba>
          {metodo === "credito" ? (
            <ul>
              <li><code>4242 4242 4242 4242</code> pago aprobado</li>
              <li><code>4000 0048 4000 0008</code> ofrece meses sin intereses</li>
              <li><code>4000 0027 6000 3184</code> pide verificación 3D Secure</li>
              <li><code>4000 0000 0000 0002</code> tarjeta rechazada</li>
              <li><code>4000 0000 0000 9995</code> fondos insuficientes</li>
            </ul>
          ) : (
            <ul>
              <li><code>4000 0566 5566 5556</code> Visa débito aprobada</li>
              <li><code>5200 8282 8282 8210</code> Mastercard débito aprobada</li>
              <li><code>4242 4242 4242 4242</code> es de crédito: verás el aviso de que elijas crédito</li>
            </ul>
          )}
          <p className="muted">Cualquier fecha futura, cualquier CVC y cualquier código postal.</p>
        </PistasPrueba>
      )}

      <ErrorPago error={error} />

      <button className="btn btn--primario btn--grande" type="submit" disabled={!stripe || !listo || enviando}>
        {enviando ? "Procesando pago..." : `Pagar ${dinero(total)}`}
      </button>
    </form>
  );
}

function FormOxxo({ crearPedido, irAlPedido, user, modoPrueba }) {
  const [nombre, setNombre] = useState(user?.nombre ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function generar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await crearPedido({ metodo: "oxxo", nombre, email });
      irAlPedido(r.pedido.id);
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={generar} className="checkout-form">
      <label>
        Nombre y apellido
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          autoComplete="name"
          placeholder="Como aparecerá en la ficha"
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>

      {modoPrueba && (
        <PistasPrueba>
          <p className="muted">En modo de prueba el email decide qué pasa con la ficha:</p>
          <div className="pistas-prueba__botones">
            <button type="button" className="btn btn--chico" onClick={() => setEmail("succeed_immediately@test.com")}>
              Se paga al instante
            </button>
            <button type="button" className="btn btn--chico" onClick={() => setEmail("pago_en_3_minutos@test.com")}>
              Se paga en 3 minutos
            </button>
            <button type="button" className="btn btn--chico" onClick={() => setEmail("expire_immediately@test.com")}>
              Vence sin pagarse
            </button>
          </div>
        </PistasPrueba>
      )}

      <ErrorPago error={error} />

      <button className="btn btn--primario btn--grande" type="submit" disabled={enviando}>
        {enviando ? "Generando ficha..." : "Generar ficha OXXO"}
      </button>
    </form>
  );
}

// SPEI y link de pago: no piden datos, solo un botón.
function FormSinDatos({ metodo, boton, texto, pruebas, crearPedido, irAlPedido, modoPrueba }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function generar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await crearPedido({ metodo });
      irAlPedido(r.pedido.id);
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="checkout-form checkout-form--ancho">
      <p className="metodo-panel__texto">{texto}</p>
      {modoPrueba && (
        <PistasPrueba>
          <p className="muted">{pruebas}</p>
        </PistasPrueba>
      )}
      <ErrorPago error={error} />
      <button className="btn btn--primario btn--grande" type="button" onClick={generar} disabled={enviando}>
        {enviando ? "Generando..." : boton}
      </button>
    </div>
  );
}
