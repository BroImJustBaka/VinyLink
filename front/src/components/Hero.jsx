// `imagen` es opcional: HomeView le pasa la foto de una de las categorías ya
// cargadas del catálogo, para usarla como fondo editorial del Hero.
export function Hero({ imagen }) {
  return (
    <section
      className={"hero" + (imagen ? " hero--foto" : "")}
      style={imagen ? { "--hero-img": `url(${imagen})` } : undefined}
    >
      <div className="hero__contenido">
        <h1>Musica e intrumentos de todo tipo para todo tipo de personas</h1>
        <p>Explora nuestras categorías y arma tu pedido en minutos.</p>
      </div>
    </section>
  );
}
