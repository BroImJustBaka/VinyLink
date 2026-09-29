// Esqueletos de carga: se muestran mientras el fetch al backend está en
// vuelo, en vez de un spinner genérico (tema 14 del recurso).

export function ProductCardSkeleton() {
  return (
    <div className="card card--skeleton" aria-hidden="true">
      <div className="skeleton skeleton--img" />
      <div className="skeleton skeleton--line" style={{ width: "70%" }} />
      <div className="skeleton skeleton--line" style={{ width: "40%" }} />
    </div>
  );
}

export function ProductGridSkeleton({ cantidad = 6 }) {
  return (
    <div className="grid" role="status" aria-label="Cargando productos">
      {Array.from({ length: cantidad }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
