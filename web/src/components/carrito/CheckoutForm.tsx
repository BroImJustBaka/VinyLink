// Dueño: Persona B. Checkout con los cinco métodos de Stripe y PayPal.
//
// - Crédito / débito: el formulario de tarjeta es el Payment Element de
//   Stripe (un iframe: los números de la tarjeta nunca pasan por nuestro
//   servidor). Stripe.js lo convierte en un ConfirmationToken y el backend
//   cobra con él.
// - OXXO, SPEI y link de pago: el backend genera la ficha, la CLABE o el link
//   y aquí solo se redirige a /pedido/[id], donde se muestran.
// - PayPal: el backend crea la orden y regresa la URL de aprobación; el
//   cliente paga en PayPal y vuelve a /pedido/[id]?paypal=aprobado, donde el
//   servidor captura el cobro.
//
// El total que se cobra lo calcula el backend con los precios de la base de
// datos. Aquí se muestra el que regresa `cotizarPedido` (subtotal, cupón,
// envío e IVA), que usa exactamente el mismo cálculo que crearPedido.
//
// Antes de pagar se pide la dirección de envío (se puede elegir una de la
// libreta del cliente; el código postal llena estado, ciudad y colonias con
// COPOMEX) y, opcionalmente, un cupón.
import { useEffect, useState, type ChangeEvent, type Dispatch, type SubmitEvent, type SetStateAction } from "react";
import {
  loadStripe,
  type Appearance,
  type CssFontSource,
  type Stripe,
  type StripeElementsOptionsMode,
} from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useCartStore } from "../../stores/cart.ts";
import { graphqlClient } from "../../lib/graphql.ts";
import { ERROR_SIN_SESION } from "../../lib/queries/pedidos.ts";
import {
  MUTATION_CANCELAR_PEDIDO,
  MUTATION_CREAR_PEDIDO,
  MUTATION_SINCRONIZAR_PAGO,
  QUERY_COTIZAR,
} from "../../lib/queries/pagos.ts";
import { QUERY_CODIGO_POSTAL } from "../../lib/queries/integraciones.ts";
import { dinero } from "../../lib/formato.ts";
import {
  mensajeDe,
  type ConfigPagos,
  type Cotizacion,
  type DatosPago,
  type Direccion,
  type DireccionGuardada,
  type MetodoPago,
  type ResultadoPago,
  type UsuarioSesion,
} from "../../lib/tipos.ts";

interface Metodo {
  id: MetodoPago;
  titulo: string;
  detalle: string;
  proveedor: "stripe" | "paypal";
}

const METODOS: Metodo[] = [
  {
    id: "credito",
    titulo: "Tarjeta de crédito",
    detalle: "Visa, Mastercard o American Express. Puedes pagar a meses sin intereses.",
    proveedor: "stripe",
  },
  { id: "debito", titulo: "Tarjeta de débito", detalle: "El cargo se hace al momento.", proveedor: "stripe" },
  {
    id: "paypal",
    titulo: "PayPal",
    detalle: "Paga con tu saldo, tarjeta o cuenta bancaria ligada a PayPal.",
    proveedor: "paypal",
  },
  {
    id: "oxxo",
    titulo: "Efectivo en OXXO",
    detalle: "Te damos una ficha para pagar en cualquier OXXO. Vence en 3 días.",
    proveedor: "stripe",
  },
  {
    id: "spei",
    titulo: "Transferencia SPEI",
    detalle: "Te damos una CLABE para transferir desde la app de tu banco.",
    proveedor: "stripe",
  },
  {
    id: "link",
    titulo: "Link de pago",
    detalle: "Un link para pagar después o para que otra persona pague por ti.",
    proveedor: "stripe",
  },
];

// Colores y tipografía de la tienda para el formulario de Stripe.
const APARIENCIA: Appearance = {
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
const FUENTES: CssFontSource[] = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" },
];

const MESES_SIN_INTERESES = {
  paymentMethodOptions: { card: { installments: { enabled: true } } },
} as unknown as Pick<StripeElementsOptionsMode, "paymentMethodOptions">;

// loadStripe descarga Stripe.js una sola vez; se guarda la promesa.
let stripePromise: Promise<Stripe | null> | null = null;
const obtenerStripe = (llave: string) => (stripePromise ??= loadStripe(llave));

const DIRECCION_VACIA: Direccion = {
  nombre: "",
  telefono: "",
  calle: "",
  colonia: "",
  ciudad: "",
  estado: "",
  cp: "",
  referencias: "",
};

const desdeGuardada = (d: DireccionGuardada): Direccion => ({
  nombre: d.nombre,
  telefono: d.telefono,
  calle: d.calle,
  colonia: d.colonia,
  ciudad: d.ciudad,
  estado: d.estado,
  cp: d.cp,
  referencias: d.referencias ?? "",
});

// Lo mismo que revisa el backend (validarDireccion), para avisar antes de pagar.
function errorDeDireccion(d: Direccion): string | null {
  if (d.nombre.trim().length < 3) return "Escribe el nombre de quien recibe el pedido.";
  if (!/^\d{10}$/.test(d.telefono.replace(/\D/g, ""))) return "El teléfono debe tener 10 dígitos.";
  if (d.calle.trim().length < 3) return "Escribe la calle y el número.";
  if (d.colonia.trim().length < 2) return "Escribe la colonia.";
  if (d.ciudad.trim().length < 2) return "Escribe la ciudad o municipio.";
  if (d.estado.trim().length < 2) return "Escribe el estado.";
  if (!/^\d{5}$/.test(d.cp.trim())) return "El código postal debe tener 5 dígitos.";
  return null;
}

interface Props {
  user?: UsuarioSesion | null;
  pagos?: ConfigPagos | null;
  errorConfig?: string | null;
  direcciones?: DireccionGuardada[];
}

// Lo que reciben los formularios de cada método.
interface PropsForm {
  crearPedido: (pago: DatosPago) => Promise<ResultadoPago>;
  irAlPedido: (pedidoId: string) => void;
  total: number;
  user: UsuarioSesion | null;
}

export default function CheckoutForm({ user = null, pagos = null, errorConfig = null, direcciones = [] }: Props) {
  const items = useCartStore((s) => s.items);
  const totalLocal = useCartStore((s) => s.total());
  const limpiarLocal = useCartStore((s) => s.limpiarLocal);
  // Métodos disponibles según lo que tenga configurado el backend.
  const disponibles = METODOS.filter((m) => (m.proveedor === "stripe" ? pagos?.habilitado : pagos?.paypalHabilitado));
  const [metodo, setMetodo] = useState<MetodoPago>(disponibles[0]?.id ?? "credito");
  // Dirección: la más reciente de la libreta (o vacía) y si se guarda la nueva.
  const [envio, setEnvio] = useState<Direccion>(() => {
    const d = direcciones[0];
    return d ? desdeGuardada(d) : { ...DIRECCION_VACIA, nombre: user?.nombre ?? "" };
  });
  const [guardarDireccion, setGuardarDireccion] = useState(direcciones.length === 0);
  // Cupón: lo que escribe el cliente y el código que se mandó a cotizar.
  const [textoCupon, setTextoCupon] = useState("");
  const [cupon, setCupon] = useState<string | null>(null);
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);

  // Cada vez que cambia el carrito o el cupón, el backend recalcula el total.
  const claveItems = items.map((it) => `${it.id}x${it.cantidad}`).join(",");
  useEffect(() => {
    if (items.length === 0) return;
    let vigente = true;
    const data = { items: items.map((it) => ({ productoId: it.id, cantidad: it.cantidad })), cupon };
    graphqlClient(QUERY_COTIZAR, { data })
      .then(({ cotizarPedido }: { cotizarPedido: Cotizacion }) => vigente && setCotizacion(cotizarPedido))
      .catch(() => vigente && setCotizacion(null)); // sin cotización se muestra el total local
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claveItems resume `items`
  }, [claveItems, cupon]);

  const total = cotizacion?.total ?? totalLocal;

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

  // Llama al backend: crea el pedido, aparta el stock y pide el cobro.
  async function crearPedido(pago: DatosPago): Promise<ResultadoPago> {
    const problema = errorDeDireccion(envio);
    if (problema) {
      document.getElementById("checkout-envio")?.scrollIntoView({ behavior: "smooth" });
      throw new Error(`Revisa la dirección de envío: ${problema}`);
    }
    const data = {
      items: items.map((it) => ({ productoId: it.id, cantidad: it.cantidad })),
      cupon: cotizacion?.cupon ?? null,
      envio: { ...envio, referencias: envio.referencias || null },
      guardarDireccion,
    };
    const { crearPedido } = await graphqlClient(MUTATION_CREAR_PEDIDO, { data, pago });
    return crearPedido as ResultadoPago;
  }

  // El pedido ya existe: se vacía el carrito local y se va a su página.
  function irAlPedido(pedidoId: string) {
    limpiarLocal();
    window.location.href = `/pedido/${pedidoId}`;
  }

  const props: PropsForm = { crearPedido, irAlPedido, total, user };
  const totalCentavos = Math.round(total * 100);
  const oxxoBloqueado = !!pagos && total > pagos.maximoOxxo;

  return (
    <section className="checkout">
      <a href="/carrito">← Volver al carrito</a>
      <h2>Checkout</h2>

      <div className="checkout__columnas">
        <div className="checkout__pago">
          <DatosEnvio
            envio={envio}
            setEnvio={setEnvio}
            direcciones={direcciones}
            guardarDireccion={guardarDireccion}
            setGuardarDireccion={setGuardarDireccion}
          />
          {!pagos || disponibles.length === 0 ? (
            <div className="error-box">
              <p>
                {errorConfig
                  ? `No se pudo cargar la configuración de pagos: ${errorConfig}`
                  : "Los pagos en línea no están configurados. Agrega las llaves de Stripe o PayPal en back/.env y reinicia el backend."}
              </p>
            </div>
          ) : (
            <>
              <fieldset className="metodos">
                <legend>¿Cómo quieres pagar?</legend>
                {disponibles.map((m) => {
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
                          {bloqueado ? `OXXO acepta hasta ${dinero(pagos.maximoOxxo)} por ficha.` : m.detalle}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="metodo-panel">
                {(metodo === "credito" || metodo === "debito") && pagos.publishableKey && (
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
                      // Stripe.js lo acepta, pero sus tipos aún no incluyen `installments`.
                      ...(metodo === "credito" ? MESES_SIN_INTERESES : {}),
                      locale: "es-419",
                      appearance: APARIENCIA,
                      fonts: FUENTES,
                    }}
                  >
                    <FormTarjeta metodo={metodo} {...props} />
                  </Elements>
                )}
                {metodo === "paypal" && <FormPaypal {...props} />}
                {metodo === "oxxo" && <FormOxxo {...props} />}
                {metodo === "spei" && (
                  <FormSinDatos
                    metodo="spei"
                    boton="Generar CLABE para transferir"
                    texto="Al continuar te mostramos una CLABE y la referencia. Haz la transferencia desde la app de tu banco por el monto exacto; el pedido se confirma solo cuando llega (tienes 3 días)."
                    {...props}
                  />
                )}
                {metodo === "link" && (
                  <FormSinDatos
                    metodo="link"
                    boton="Generar link de pago"
                    texto="Te damos un link seguro de Stripe que puedes abrir ahora, guardar o mandar por WhatsApp. Se puede pagar con tarjeta u OXXO y es válido por 24 horas."
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
          {cotizacion && (
            <ul className="checkout__desglose">
              <li>
                <span>Subtotal</span>
                <span>{dinero(cotizacion.subtotal)}</span>
              </li>
              {cotizacion.descuento > 0 && (
                <li className="checkout__ahorro">
                  <span>Cupón {cotizacion.cupon}</span>
                  <span>−{dinero(cotizacion.descuento)}</span>
                </li>
              )}
              <li>
                <span>Envío</span>
                <span>{cotizacion.costoEnvio > 0 ? dinero(cotizacion.costoEnvio) : "Gratis"}</span>
              </li>
            </ul>
          )}
          <p className="checkout__total">
            <span>Total</span>
            <strong>{dinero(total)}</strong>
          </p>
          {cotizacion && <p className="muted">Incluye {dinero(cotizacion.iva)} de IVA.</p>}
          {cotizacion && cotizacion.faltaParaEnvioGratis > 0 && (
            <p className="muted">Te faltan {dinero(cotizacion.faltaParaEnvioGratis)} para el envío gratis.</p>
          )}

          <form
            className="cupon-form"
            onSubmit={(e) => {
              e.preventDefault();
              setCupon(textoCupon.trim() || null);
            }}
          >
            <input
              type="text"
              value={textoCupon}
              onChange={(e) => setTextoCupon(e.target.value)}
              placeholder="Cupón de descuento"
              aria-label="Cupón de descuento"
              maxLength={30}
            />
            <button className="btn btn--chico" type="submit">
              Aplicar
            </button>
          </form>
          {cupon && cotizacion?.errorCupon && <p className="cupon-error">{cotizacion.errorCupon}</p>}
          {cotizacion?.cupon && (
            <p className="cupon-ok">
              ✓ {cotizacion.cuponDescripcion ?? `Cupón ${cotizacion.cupon} aplicado`}{" "}
              <button
                className="btn btn--link"
                type="button"
                onClick={() => {
                  setCupon(null);
                  setTextoCupon("");
                }}
              >
                Quitar
              </button>
            </p>
          )}
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

interface PropsEnvio {
  envio: Direccion;
  setEnvio: Dispatch<SetStateAction<Direccion>>;
  direcciones: DireccionGuardada[];
  guardarDireccion: boolean;
  setGuardarDireccion: (v: boolean) => void;
}

interface ExtraCampo {
  ancho?: boolean;
  type?: string;
  opcional?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "tel" | "numeric";
  maxLength?: number;
  placeholder?: string;
  list?: string;
}

interface CodigoPostal {
  cp: string;
  estado: string;
  municipio: string;
  ciudad: string | null;
  colonias: string[];
}

// Dirección de envío: elegir una de la libreta o escribir una nueva.
function DatosEnvio({ envio, setEnvio, direcciones, guardarDireccion, setGuardarDireccion }: PropsEnvio) {
  const [colonias, setColonias] = useState<string[]>([]);
  const [buscandoCp, setBuscandoCp] = useState(false);

  // Con los 5 dígitos del C.P., COPOMEX da el estado, el municipio y las
  // colonias. Si no hay datos (C.P. inexistente o API sin configurar) el
  // cliente escribe todo a mano, como antes.
  const cp = envio.cp.trim();
  useEffect(() => {
    if (!/^\d{5}$/.test(cp)) {
      setColonias([]);
      return;
    }
    let vigente = true;
    setBuscandoCp(true);
    graphqlClient(QUERY_CODIGO_POSTAL, { cp })
      .then(({ codigoPostal: c }: { codigoPostal: CodigoPostal | null }) => {
        if (!vigente || !c) return;
        setColonias(c.colonias);
        setEnvio((d) => ({
          ...d,
          estado: c.estado,
          ciudad: c.ciudad || c.municipio,
          colonia: d.colonia || (c.colonias.length === 1 ? c.colonias[0] : ""),
        }));
      })
      .catch(() => {})
      .finally(() => vigente && setBuscandoCp(false));
    return () => {
      vigente = false;
    };
  }, [cp, setEnvio]);

  const cambiar = (campo: keyof Direccion) => (e: ChangeEvent<HTMLInputElement>) =>
    setEnvio((d) => ({ ...d, [campo]: e.target.value }));
  const campo = (nombre: keyof Direccion, etiqueta: string, extra: ExtraCampo = {}) => (
    <label className={extra.ancho ? "campos-direccion__ancho" : undefined}>
      {etiqueta}
      <input
        type={extra.type ?? "text"}
        value={envio[nombre]}
        onChange={cambiar(nombre)}
        required={!extra.opcional}
        autoComplete={extra.autoComplete}
        inputMode={extra.inputMode}
        maxLength={extra.maxLength ?? 120}
        placeholder={extra.placeholder}
        list={extra.list}
      />
    </label>
  );

  return (
    <fieldset className="checkout-seccion" id="checkout-envio">
      <legend>¿A dónde lo enviamos?</legend>
      {direcciones.length > 0 && (
        <label className="direcciones-guardadas">
          Mis direcciones
          <select
            defaultValue={direcciones[0].id}
            onChange={(e) => {
              const d = direcciones.find((x) => x.id === e.target.value);
              setEnvio(d ? desdeGuardada(d) : { ...DIRECCION_VACIA });
              setGuardarDireccion(!d);
            }}
          >
            {direcciones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre} · {d.calle}, {d.colonia}, C.P. {d.cp}
              </option>
            ))}
            <option value="">+ Otra dirección</option>
          </select>
        </label>
      )}
      <div className="campos-direccion">
        {campo("nombre", "Nombre de quien recibe", { autoComplete: "name" })}
        {campo("telefono", "Teléfono (10 dígitos)", {
          type: "tel",
          autoComplete: "tel-national",
          inputMode: "tel",
          maxLength: 14,
        })}
        {campo("calle", "Calle y número", { ancho: true, autoComplete: "address-line1" })}
        {campo("cp", buscandoCp ? "Código postal (buscando…)" : "Código postal", {
          autoComplete: "postal-code",
          inputMode: "numeric",
          maxLength: 5,
        })}
        {campo("colonia", "Colonia", { autoComplete: "address-line2", list: "colonias-cp" })}
        <datalist id="colonias-cp">
          {colonias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {campo("ciudad", "Ciudad o municipio", { autoComplete: "address-level2" })}
        {campo("estado", "Estado", { autoComplete: "address-level1" })}
        {campo("referencias", "Referencias (opcional)", {
          ancho: true,
          opcional: true,
          placeholder: "Entre calles, color de la casa…",
        })}
      </div>
      <label className="guardar-direccion">
        <input type="checkbox" checked={guardarDireccion} onChange={(e) => setGuardarDireccion(e.target.checked)} />
        Guardar esta dirección para mis próximas compras
      </label>
    </fieldset>
  );
}

// Mensaje de error, con enlace a /login si el problema es la sesión.
function ErrorPago({ error }: { error: string | null }) {
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

interface PedidoSincronizado {
  id: string;
  estado: string;
  pago: { estado: string; error: string | null } | null;
}

function FormTarjeta({ metodo, crearPedido, irAlPedido, total }: PropsForm & { metodo: "credito" | "debito" }) {
  const stripe = useStripe();
  const elements = useElements();
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pagar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setEnviando(true);
    setError(null);

    try {
      // 1) Stripe valida los campos (número, fecha, CVC) en el navegador.
      const { error: errorCampos } = await elements.submit();
      if (errorCampos) throw new Error(errorCampos.message);

      // 2) Los datos de la tarjeta se convierten en un token que solo sirve una vez.
      const { error: errorToken, confirmationToken } = await stripe.createConfirmationToken({ elements });
      if (errorToken) throw new Error(errorToken.message);

      // 3) El backend revisa crédito/débito, aparta el stock y cobra.
      const r = await crearPedido({ metodo, confirmationTokenId: confirmationToken.id });

      // 4) Si el banco pide 3D Secure, Stripe muestra su ventana de verificación.
      if (r.requiereAccion && r.clientSecret) {
        const { error: error3ds } = await stripe.handleNextAction({ clientSecret: r.clientSecret });
        // Pase lo que pase, el backend le pregunta a Stripe el resultado real.
        const { sincronizarPago: pedido }: { sincronizarPago: PedidoSincronizado } = await graphqlClient(
          MUTATION_SINCRONIZAR_PAGO,
          { pedidoId: r.pedido.id }
        );
        if (pedido.estado !== "pagado") {
          // Si se quedó a medias, se cancela para liberar el stock de inmediato.
          if (pedido.estado === "pendiente") {
            await graphqlClient(MUTATION_CANCELAR_PEDIDO, { id: pedido.id }).catch(() => {});
          }
          throw new Error(pedido.pago?.error ?? error3ds?.message ?? "No se completó la verificación de tu banco.");
        }
      }
      irAlPedido(r.pedido.id);
    } catch (err) {
      setError(mensajeDe(err));
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
        // Sin Apple Pay, Google Pay ni Stripe Link: solo los datos de la tarjeta.
        // Link abría su propia ventana pidiendo un código y confundía el pago.
        options={{
          layout: "tabs",
          wallets: { applePay: "never", googlePay: "never", link: "never" },
        }}
      />

      <ErrorPago error={error} />

      <button className="btn btn--primario btn--grande" type="submit" disabled={!stripe || !listo || enviando}>
        {enviando ? "Procesando pago..." : `Pagar ${dinero(total)}`}
      </button>
    </form>
  );
}

// PayPal: se crea el pedido y la orden, y el cliente se va a PayPal a aprobar.
// El carrito local se limpia, pero el de la base de datos se conserva hasta
// que el pago se confirma: si el cliente no paga, se vuelve a bajar solo.
function FormPaypal({ crearPedido, total }: PropsForm) {
  const limpiarLocal = useCartStore((s) => s.limpiarLocal);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continuar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await crearPedido({ metodo: "paypal" });
      if (!r.urlAprobacion) throw new Error("PayPal no regresó el enlace para pagar. Intenta de nuevo.");
      limpiarLocal();
      window.location.href = r.urlAprobacion;
    } catch (err) {
      setError(mensajeDe(err));
      setEnviando(false);
    }
  }

  return (
    <div className="checkout-form checkout-form--ancho">
      <p className="metodo-panel__texto">
        Te llevamos a PayPal para que apruebes el pago de {dinero(total)}. Al terminar regresas aquí y tu pedido se
        confirma al instante. El pedido queda apartado por 3 horas.
      </p>
      <ErrorPago error={error} />
      <button className="btn btn--grande btn--paypal" type="button" onClick={continuar} disabled={enviando}>
        {enviando ? "Conectando con PayPal..." : "Continuar a PayPal"}
      </button>
    </div>
  );
}

function FormOxxo({ crearPedido, irAlPedido, user }: PropsForm) {
  const [nombre, setNombre] = useState(user?.nombre ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await crearPedido({ metodo: "oxxo", nombre, email });
      irAlPedido(r.pedido.id);
    } catch (err) {
      setError(mensajeDe(err));
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
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>

      <ErrorPago error={error} />

      <button className="btn btn--primario btn--grande" type="submit" disabled={enviando}>
        {enviando ? "Generando ficha..." : "Generar ficha OXXO"}
      </button>
    </form>
  );
}

interface PropsSinDatos extends PropsForm {
  metodo: "spei" | "link";
  boton: string;
  texto: string;
}

// SPEI y link de pago: no piden datos, solo un botón.
function FormSinDatos({ metodo, boton, texto, crearPedido, irAlPedido }: PropsSinDatos) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await crearPedido({ metodo });
      irAlPedido(r.pedido.id);
    } catch (err) {
      setError(mensajeDe(err));
      setEnviando(false);
    }
  }

  return (
    <div className="checkout-form checkout-form--ancho">
      <p className="metodo-panel__texto">{texto}</p>
      <ErrorPago error={error} />
      <button className="btn btn--primario btn--grande" type="button" onClick={generar} disabled={enviando}>
        {enviando ? "Generando..." : boton}
      </button>
    </div>
  );
}
