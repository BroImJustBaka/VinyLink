// Isla React (client:load). Las tarjetas de producto se renderizan en el
// servidor con un atributo data-producto; esta isla escucha los clicks en
// ellas y abre el detalle como modal, montado con un Portal sobre <body>.
// Mientras el modal está abierto:
//  - el stock y el precio se actualizan en vivo (subscription pública
//    stockActualizado): si alguien compra la última pieza, el botón se desactiva;
//  - se muestra el precio aproximado en dólares (tipo de cambio de Banxico);
//  - se cargan las reseñas del producto (microservicio del agente, MongoDB).
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useCartStore } from "../../stores/cart.ts";
import { suscribirse } from "../../lib/tiempoReal.ts";
import { obtenerTipoCambio } from "../../lib/tipoCambio.ts";
import { dinero, dolares } from "../../lib/formato.ts";
import { imagen, srcsetDe } from "../../lib/imagen.ts";
import type { ProductoVista, TipoCambio } from "../../lib/tipos.ts";
import Resenas from "./Resenas.tsx";

const SUB_STOCK = `
  subscription StockProducto($id: ID) {
    stockActualizado(productoId: $id) { id stock precio activo }
  }
`;

interface StockActualizado {
  stockActualizado: { id: string; stock: number; precio: number; activo: boolean };
}

interface Props {
  /** Si hay sesión (para ofrecer escribir una reseña). */
  conSesion?: boolean;
}

export default function ProductModal({ conSesion = false }: Props) {
  const [producto, setProducto] = useState<ProductoVista | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState<{ nombre: string; cantidad: number } | null>(null);
  const [tipoCambio, setTipoCambio] = useState<TipoCambio | null>(null);
  const agregarProducto = useCartStore((s) => s.agregarProducto);

  // Delegación de eventos: una sola escucha para todas las tarjetas.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const tarjeta = (e.target as Element | null)?.closest?.<HTMLElement>("[data-producto]");
      if (!tarjeta?.dataset.producto) return;
      setProducto(JSON.parse(tarjeta.dataset.producto) as ProductoVista);
      setCantidad(1);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!producto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setProducto(null);
    }
    document.addEventListener("keydown", onKeyDown);
    // Evita que la página de atrás haga scroll mientras el modal está abierto.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflowAnterior;
    };
  }, [producto]);

  // Stock en vivo del producto abierto (un producto desactivado cuenta como agotado).
  const productoId = producto?.id;
  useEffect(() => {
    if (!productoId) return;
    obtenerTipoCambio().then(setTipoCambio);
    return suscribirse<StockActualizado>(SUB_STOCK, { id: String(productoId) }, ({ stockActualizado: p }) => {
      setProducto((actual) =>
        actual && String(actual.id) === String(p.id)
          ? { ...actual, precio: p.precio, stock: p.activo ? p.stock : 0 }
          : actual
      );
      setCantidad((c) => Math.max(1, Math.min(c, p.stock)));
    });
  }, [productoId]);

  // Aviso breve después de agregar ("Agregado al carrito").
  useEffect(() => {
    if (!agregado) return;
    const t = setTimeout(() => setAgregado(null), 2500);
    return () => clearTimeout(t);
  }, [agregado]);

  const cerrar = () => setProducto(null);

  return (
    <>
      {agregado &&
        createPortal(
          <div className="toast" role="status">
            ✓ {agregado.cantidad} × {agregado.nombre} agregado al carrito · <a href="/carrito">Ver carrito</a>
          </div>,
          document.body
        )}

      {producto &&
        createPortal(
          <div className="modal-overlay" onClick={cerrar}>
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Detalle de ${producto.nombre}`}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal__cerrar" onClick={cerrar} aria-label="Cerrar" autoFocus>
                ✕
              </button>
              <img
                src={imagen(producto.imagen, 420)}
                srcSet={srcsetDe(producto.imagen, [420, 840])}
                sizes="(max-width: 480px) 90vw, 370px"
                alt={producto.nombre}
                width={420}
                height={420}
              />
              <h2>{producto.nombre}</h2>
              <p className="muted">{producto.descripcion}</p>
              <p className="precio">
                {dinero(producto.precio)}
                {tipoCambio && (
                  <span
                    className="precio__dolares"
                    title={`Tipo de cambio ${tipoCambio.valor.toFixed(4)} (${tipoCambio.fuente}, ${tipoCambio.fecha})`}
                  >
                    {" "}
                    ≈ {dolares(producto.precio / tipoCambio.valor)}
                  </span>
                )}
              </p>
              <p className="muted">{producto.stock > 0 ? `${producto.stock} disponibles` : "Sin stock"}</p>

              {producto.stock > 0 && (
                <div className="modal__cantidad">
                  <label htmlFor="cantidad">Cantidad</label>
                  <input
                    id="cantidad"
                    type="number"
                    min="1"
                    max={producto.stock}
                    value={cantidad}
                    onChange={(e) =>
                      setCantidad(Math.max(1, Math.min(producto.stock, Number(e.target.value) || 1)))
                    }
                  />
                </div>
              )}

              <button
                className="btn btn--primario"
                disabled={producto.stock === 0}
                onClick={() => {
                  agregarProducto(producto, cantidad);
                  setAgregado({ nombre: producto.nombre, cantidad });
                  cerrar();
                }}
              >
                {producto.stock === 0 ? "Sin stock" : "Agregar al carrito"}
              </button>

              <Resenas productoId={String(producto.id)} conSesion={conSesion} />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
