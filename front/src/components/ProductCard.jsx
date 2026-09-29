// Fragment (<>) para agrupar nombre + precio + stock sin nodo extra (tema 9).
// `numero` es opcional: lo arma CategoryView a partir de la posición del
// producto en la lista, imitando la numeración Side A / Side B de un vinilo.
export function ProductCard({ producto, onVerDetalle, numero }) {
  return (
    <button className="card" onClick={() => onVerDetalle(producto)}>
      {numero && <span className="card__numero">{numero}</span>}
      <img src={producto.imagen} alt={producto.nombre} loading="lazy" />
      <>
        <h4>{producto.nombre}</h4>
        <p className="precio">${producto.precio.toFixed(2)}</p>
        <p className="muted">
          {producto.stock > 0 ? `${producto.stock} disponibles` : "Sin stock"}
        </p>
      </>
    </button>
  );
}
