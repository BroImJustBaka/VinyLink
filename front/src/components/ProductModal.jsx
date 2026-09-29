import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

// Detalle de producto como MODAL (decision documentada en reporte-p2.md),
// montado fuera del árbol de la vista actual con un Portal (tema 15) para
// que se superponga a cualquier template sin problemas de z-index/overflow.
export function ProductModal({ producto, onCerrar, onAgregar }) {
  const [cantidad, setCantidad] = useState(1);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onCerrar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCerrar]);

  if (!producto) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de ${producto.nombre}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal__cerrar" onClick={onCerrar} aria-label="Cerrar">
          ✕
        </button>
        <img src={producto.imagen} alt={producto.nombre} />
        <h2>{producto.nombre}</h2>
        <p className="muted">{producto.descripcion}</p>
        <p className="precio">${producto.precio.toFixed(2)}</p>
        <p className="muted">{producto.stock} disponibles</p>

        <div className="modal__cantidad">
          <label htmlFor="cantidad">Cantidad</label>
          <input
            id="cantidad"
            type="number"
            min="1"
            max={producto.stock}
            value={cantidad}
            onChange={(e) =>
              setCantidad(Math.max(1, Math.min(producto.stock, Number(e.target.value))))
            }
          />
        </div>

        <button
          className="btn btn--primario"
          disabled={producto.stock === 0}
          onClick={() => {
            onAgregar(producto, cantidad);
            onCerrar();
          }}
        >
          Agregar al carrito
        </button>
      </div>
    </div>,
    document.body
  );
}
