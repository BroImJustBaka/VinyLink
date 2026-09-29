// Sidebar: lista de categorías. Al hacer click dispara el evento custom
// `onSeleccionarCategoria` que el padre usa para avanzar la máquina de estados.
export function Sidebar({ categorias, categoriaActualId, onSeleccionarCategoria }) {
  return (
    <aside className="sidebar">
      <h3>Categorías</h3>
      <ul>
        {categorias.map((cat) => (
          <li key={cat.id}>
            <button
              className={
                "sidebar__item" +
                (cat.id === categoriaActualId ? " sidebar__item--activo" : "")
              }
              onClick={() => onSeleccionarCategoria(cat.id)}
            >
              {cat.nombre}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
