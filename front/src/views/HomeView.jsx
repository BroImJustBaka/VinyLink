import { Hero } from "../components/Hero.jsx";
import { ContextSection } from "../components/ContextSection.jsx";
import { CategoryCard } from "../components/CategoryCard.jsx";
import { ProductGridSkeleton } from "../components/Skeleton.jsx";

export function HomeView({ categorias, cargando, error, onReintentar, onSeleccionarCategoria }) {
  // Usa la foto de la primera categoría del catálogo como fondo del Hero
  // (misma imagen que ya se ve más abajo en su tarjeta), en vez de dejarlo liso.
  const imagenHero = categorias[0]?.imagen;

  return (
    <>
      <Hero imagen={imagenHero} />

      <section>
        <h2>Categorías</h2>

        {error && (
          <div className="error-box">
            <p>No se pudo cargar el catálogo: {error}</p>
            <button className="btn" onClick={onReintentar}>
              Reintentar
            </button>
          </div>
        )}

        {cargando && <ProductGridSkeleton cantidad={3} />}

        {!cargando && !error && (
          <div className="grid grid--categorias">
            {categorias.map((cat) => (
              <CategoryCard key={cat.id} categoria={cat} onSeleccionar={onSeleccionarCategoria} />
            ))}
          </div>
        )}
      </section>

      <ContextSection />
    </>
  );
}
