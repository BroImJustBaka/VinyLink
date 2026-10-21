// Dueño: Persona A. Migrado de front/src/components/ProductModal.jsx.
// Isla React (client:load). Las tarjetas de producto se renderizan en el
// servidor con un atributo data-producto; esta isla escucha los clicks en
// ellas y abre el detalle como modal, montado con un Portal sobre <body>.
// Mientras el modal está abierto, el stock y el precio se actualizan en vivo
// (subscription pública stockActualizado): si alguien compra la última pieza,
// el botón se desactiva sin recargar.
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useCartStore } from "../../stores/cart.js";
import { suscribirse } from "../../lib/tiempoReal.js";

const SUB_STOCK = `
  subscription StockProducto($id: ID) {
    stockActualizado(productoId: $id) { id stock precio activo }
  }
`;

export default function ProductModal() {
  const [producto, setProducto] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(null);
  const agregarProducto = useCartStore((s) => s.agregarProducto);

  // Delegación de eventos: una sola escucha para todas las tarjetas.
  useEffect(() => {
    function onClick(e) {
      const tarjeta = e.target.closest?.("[data-producto]");
      if (!tarjeta) return;
      setProducto(JSON.parse(tarjeta.dataset.producto));
      setCantidad(1);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!producto) return;
    function onKeyDown(e) {
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
    return suscribirse(SUB_STOCK, { id: String(productoId) }, ({ stockActualizado: p }) => {
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
            ✓ {agregado.cantidad} × {agregado.nombre} agregado al carrito ·{" "}
            <a href="/carrito">Ver carrito</a>
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
              <img src={producto.imagen} alt={producto.nombre} />
              <h2>{producto.nombre}</h2>
              <p className="muted">{producto.descripcion}</p>
              <p className="precio">${producto.precio.toFixed(2)}</p>
              <p className="muted">
                {producto.stock > 0 ? `${producto.stock} disponibles` : "Sin stock"}
              </p>

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
                      setCantidad(
                        Math.max(1, Math.min(producto.stock, Number(e.target.value) || 1))
                      )
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
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
