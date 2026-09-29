# Persona A: Base y catálogo

Eres dueño de la cara de la tienda: layout, estilos, home y catálogo. También
revisas los PRs que tocan archivos compartidos y al final despliegas.

## Tus archivos

- `web/src/pages/index.astro`, `web/src/pages/categoria/[id].astro`, `web/src/pages/404.astro`
- `web/src/components/catalogo/` (TopBar, Footer y lo que migres)
- `web/src/styles/`
- `web/src/lib/queries/catalogo.js`
- `back/src/modules/catalogo/`
- Revisor de: `web/src/layouts/Layout.astro`, `web/astro.config.mjs`, `web/package.json`, `back/src/schema.js`

## Tareas (Fase 1)

- [ ] Home (`index.astro`): migrar `Hero`, `CategoryCard` y `ContextSection` desde `front/src/`.
      Los datos se piden en el servidor con `graphqlServer`, ya no con `useGraphQL`.
- [ ] Sidebar de categorías: migrarlo a `.astro` y mostrarlo con `<Fragment slot="sidebar">` en las páginas que lo usen. Marca la categoría activa según la URL.
- [ ] Página de categoría (`categoria/[id].astro`): lista de `ProductCard` (con la numeración A1/B1), 404 si no existe.
- [ ] `ProductModal` como isla React (`client:load`) que llama a `useCartStore((s) => s.agregarProducto)`.
- [ ] Búsqueda: el TopBar ya manda `?q=`. Decide si filtra dentro de la categoría actual o si haces una página de resultados.
- [ ] Skeletons: en Astro ya no hacen falta para los datos de servidor. Quítalos o úsalos solo en islas.
- [ ] Revisar que el diseño responsive siga igual que en `front/`.

## Tareas (Fase 3)

- [ ] QA de la parte de B.
- [ ] Borrar `front/` cuando todo esté migrado.
- [ ] Desplegar. Con el adaptador Node actual, `web` y `back` pueden ir en Render o Railway. Si prefieren Vercel para `web`, hay que cambiar a `@astrojs/vercel` (PR compartido).

## Lo que usas de otros

- `useCartStore` de B (`web/src/stores/cart.js`): ya funciona en modo local, puedes usarlo desde el día 1.
- `<CartBadge />` (B) y `<UserMenu />` (C) viven dentro de tu TopBar: no los edites, solo decide dónde van.

## Probar solo

Con `back` y `web` corriendo no dependes de nadie: todo el catálogo es público.
