# VinyLink: migración a Astro + auth

Tienda de discos e instrumentos. Estamos migrando el frontend de React/Vite
(`front/`) a Astro (`web/`) y agregando un sistema de autenticación real.
Trabajamos 3 personas en paralelo; cada quien es dueño de sus carpetas.

## Estructura

```
back/                 API GraphQL (Apollo + PostgreSQL en Neon)
  src/modules/
    catalogo/         Persona A
    pedidos/          Persona B
    auth/             Persona C
web/                  Frontend nuevo (Astro + islas React)   ← aquí se migra
front/                Frontend viejo: solo de REFERENCIA, se borra al final
db.sql                Esquema y datos semilla (PostgreSQL)
docs/equipo/          Guía de cada persona
```

## Reparto

| | Persona A: Base y catálogo | Persona B: Carrito y pedidos | Persona C: Auth y perfil |
|---|---|---|---|
| **Rutas** | `/`, `/categoria/[id]`, `404` | `/carrito`, `/checkout`, `/pedido/[id]` | `/login`, `/registro`, `/perfil`, `/logout` |
| **Guía** | [persona-a.md](docs/equipo/persona-a.md) | [persona-b.md](docs/equipo/persona-b.md) | [persona-c.md](docs/equipo/persona-c.md) |

### Qué archivos son de quién

| Dueño | Archivos |
|---|---|
| **A** | `web/src/pages/index.astro`, `web/src/pages/categoria/`, `web/src/pages/404.astro`, `web/src/components/catalogo/`, `web/src/styles/`, `web/src/lib/queries/catalogo.js`, `back/src/modules/catalogo/` |
| **B** | `web/src/pages/carrito.astro`, `web/src/pages/checkout.astro`, `web/src/pages/pedido/`, `web/src/components/carrito/`, `web/src/stores/cart.js`, `web/src/lib/queries/pedidos.js`, `back/src/modules/pedidos/` |
| **C** | `web/src/pages/login.astro`, `web/src/pages/registro.astro`, `web/src/pages/perfil.astro`, `web/src/pages/logout.ts`, `web/src/pages/api/`, `web/src/middleware.ts`, `web/src/env.d.ts`, `web/src/components/auth/`, `web/src/lib/queries/auth.js`, `back/src/modules/auth/`, `db.sql` |
| **Compartidos** (PR pequeño, lo revisa A) | `web/src/layouts/Layout.astro`, `web/astro.config.mjs`, `web/package.json`, `web/src/lib/graphql.ts`, `back/src/schema.js`, `back/src/index.js`, `back/package.json` |

**Regla de oro:** solo editas tus archivos. Si necesitas algo de otra persona,
se lo pides (issue o mensaje) o lo propones en un PR que esa persona revisa.

## Contratos (no cambiarlos sin avisar a los otros dos)

1. **Usuario en el frontend:** `Astro.locals.user` es `{ id, nombre, email, rol } | null`.
   Lo llena `web/src/middleware.ts` (C).
2. **Usuario en el backend:** cada resolver recibe `context.user` con la misma forma.
   Usa `requireUser(context)` / `requireAdmin(context)` de `back/src/modules/auth/context.js` (C).
3. **Sesión:** cookie httpOnly `sid`. El frontend la manda al backend como
   `Authorization: Bearer <sid>`. `web/src/lib/graphql.ts` ya lo hace:
   - `graphqlServer(Astro.cookies, QUERY, vars)` en páginas `.astro`.
   - `graphqlClient(QUERY, vars)` en islas React (pasa por `/api/graphql`).
4. **Carrito:** `useCartStore` de `web/src/stores/cart.js` (B) expone
   `items`, `agregarProducto(producto, cantidad)`, `cambiarCantidad(id, cantidad)`,
   `quitarProducto(id)`, `vaciarCarrito()`, `total()`, `cantidadTotal()`.
5. **TopBar:** es de A, pero sus dos huecos no: `<CartBadge />` es de B y `<UserMenu />` de C.

## Cómo correrlo

Necesitas Node 22+ y tu propia rama de Neon (te la pasa Santiago por privado).

```bash
cd back && npm install
cp .env.example .env     # pon tu DATABASE_URL
npm run dev              # http://localhost:4000

cd ../web && npm install
cp .env.example .env
npm run dev              # http://localhost:4321
```

Nunca subas `.env` al repo: tiene la contraseña de la base de datos.

## Flujo de trabajo

- Rama por persona: `persona-a/...`, `persona-b/...`, `persona-c/...`. Nadie empuja directo a `main`.
- PRs pequeños y frecuentes a `main`; lo revisa al menos otra persona.
- Antes de abrir el PR: `git pull origin main` y comprobar que `npm run build` pasa en `web/`.
- Marca lo pendiente en el código con `TODO(A)`, `TODO(B)` o `TODO(C)`.

## Fases

1. **Fase 0 (lista):** repo, backend en módulos, scaffold de Astro, contratos.
2. **Fase 1:** cada quien migra su parte en paralelo (ver su guía).
3. **Fase 2, integración:** `crearPedido` con el usuario real (B+C), huecos del
   TopBar funcionando (B+C), historial de pedidos en `/perfil` (B lo expone, C lo muestra).
4. **Fase 3:** QA cruzado (cada quien prueba la parte de otro), borrar `front/` (A) y desplegar (A).
