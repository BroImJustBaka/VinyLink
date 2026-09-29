import { ProductCard } from "../components/ProductCard.jsx";
import { ProductGridSkeleton } from "../components/Skeleton.jsx";

export function CategoryView({
  categoria,
  cargando,
  error,
  busqueda,
  onReintentar,
  onVerDetalle,
  onVolver,
}) {
  const productos = (categoria?.productos ?? []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <section>
      <button className="btn btn--link" onClick={onVolver}>
        ← Volver a categorías
      </button>

      {error && (
        <div className="error-box">
          <p>No se pudo cargar la categoría: {error}</p>
          <button className="btn" onClick={onReintentar}>
            Reintentar
          </button>
        </div>
      )}

      {cargando && <ProductGridSkeleton />}

      {!cargando && !error && categoria && (
        <>
          <h2>{categoria.nombre}</h2>
          <p className="muted">{categoria.descripcion}</p>

          {productos.length === 0 ? (
            <p className="muted">No hay productos que coincidan con la búsqueda.</p>
          ) : (
            <div className="grid">
              {productos.map((prod, i) => {
                // Numeración estilo vinilo: primera mitad del catálogo = Side A,
                // segunda mitad = Side B (solo un detalle visual, no viene del backend).
                const mitad = Math.ceil(productos.length / 2);
                const lado = i < mitad ? "A" : "B";
                const pista = (i % mitad) + 1;
                return (
                  <ProductCard
                    key={prod.id}
                    producto={prod}
                    onVerDetalle={onVerDetalle}
                    numero={`${lado}${pista}`}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
