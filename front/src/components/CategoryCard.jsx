export function CategoryCard({ categoria, onSeleccionar }) {
  return (
    <button className="category-card" onClick={() => onSeleccionar(categoria.id)}>
      <img src={categoria.imagen} alt={categoria.nombre} loading="lazy" />
      <span>{categoria.nombre}</span>
    </button>
  );
}
