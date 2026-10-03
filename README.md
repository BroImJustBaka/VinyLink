# VinyLink

Tienda en línea de discos, audífonos e instrumentos musicales. El cliente
explora el catálogo por categorías, busca productos, arma su carrito, crea una
cuenta y confirma su pedido; después puede consultar su historial desde su perfil.

- **Frontend:** [Astro](https://astro.build) con renderizado en servidor e islas de React.
- **Backend:** API GraphQL con Apollo Server.
- **Base de datos:** PostgreSQL (hospedada en [Neon](https://neon.tech)).

## Funcionalidades

| Área | Qué hace |
|---|---|
| **Catálogo** | Home con categorías, página por categoría con numeración estilo vinilo (A1, A2… B1…), detalle de producto en un modal y búsqueda por nombre o descripción. |
| **Carrito** | Funciona sin cuenta (se guarda en el navegador). Con sesión se sincroniza con la base de datos y, al iniciar sesión, el carrito de invitado se fusiona con el guardado. |
| **Pedidos** | Checkout con validación de stock en una transacción; página de confirmación `/pedido/[id]`; historial en `/perfil`. |
| **Cuentas** | Registro e inicio de sesión con contraseñas hasheadas (bcrypt), sesiones en base de datos y cookie `httpOnly`. Roles `CLIENTE` y `ADMIN`. |

## Rutas

| Ruta | Descripción | Sesión |
|---|---|---|
| `/` | Home: hero, categorías y vista rápida del carrito | — |
| `/categoria/[id]` | Productos de una categoría. `?q=` filtra dentro de ella | — |
| `/buscar?q=` | Búsqueda en toda la tienda | — |
| `/carrito` | Carrito editable | — |
| `/checkout` | Confirmar la compra | Requerida |
| `/pedido/[id]` | Confirmación y detalle de un pedido propio | Requerida |
| `/login`, `/registro` | Formularios de acceso (funcionan sin JavaScript) | — |
| `/perfil` | Datos del usuario, historial de pedidos y cerrar sesión | Requerida |
| `/logout` | Cierra la sesión (solo `POST`) | — |

Si una ruta protegida se abre sin sesión, se redirige a `/login?next=<ruta>` y,
al entrar, se regresa a donde estaba.

## Estructura

```
back/                     API GraphQL (Apollo Server + pg)
  src/
    index.js              arranca el servidor y arma context.user
    db.js                 pool de PostgreSQL; aplica db.sql al arrancar
    schema.js             junta typeDefs y resolvers de los módulos
    modules/
      catalogo/           categorías, productos y búsqueda
      pedidos/            carrito en DB, pedidos e historial
      auth/               usuarios, sesiones, login/registro, requireUser/requireAdmin
web/                      Frontend Astro (SSR con @astrojs/node)
  src/
    pages/                rutas (ver tabla de arriba) + api/graphql.ts (proxy)
    layouts/Layout.astro  estructura común: TopBar, sidebar opcional y Footer
    components/
      catalogo/           TopBar, Sidebar, Hero, ProductCard, ProductModal (isla)…
      carrito/            CartBadge, CartView y CheckoutForm (islas)
      auth/               UserMenu, AuthForm
    stores/cart.js        store de Zustand del carrito
    lib/graphql.ts        graphqlServer() y graphqlClient()
    middleware.ts         llena Astro.locals.user y protege rutas
    styles/               estilos globales y de la app
db.sql                    esquema y datos semilla (idempotente)
```

## Cómo funciona

- **Datos en el servidor.** Las páginas `.astro` piden sus datos con
  `graphqlServer(Astro.cookies, QUERY, vars)` y llegan al navegador ya
  renderizadas, sin pantallas de carga.
- **Islas React** solo donde hace falta interacción: `ProductModal`
  (`client:load`), y `CartBadge`, `CartView`, `CheckoutForm` y la vista rápida
  del carrito (`client:only`, porque el carrito vive en `localStorage`). Todas
  comparten el mismo store `useCartStore`.
- **Sesión.** `login`/`registrar` regresan un token aleatorio; el backend guarda
  solo su SHA-256 en la tabla `sesion` (expira en 7 días). El frontend lo guarda
  en la cookie `sid` (`httpOnly`, `sameSite=lax`, `secure` en producción) y lo
  reenvía como `Authorization: Bearer <sid>`. Las islas llaman a `/api/graphql`,
  que agrega la sesión porque el JavaScript del navegador no puede leer la cookie.
- **Permisos en el backend.** Cada resolver recibe `context.user`
  (`{ id, nombre, email, rol } | null`). Carrito y pedidos usan
  `requireUser`; crear, editar o borrar productos y listar todos los pedidos
  usan `requireAdmin`. Un pedido ajeno se responde igual que uno inexistente.

## Cómo correrlo

Requisitos: Node.js 22.12 o superior y una base PostgreSQL (por ejemplo, un
proyecto gratuito de Neon).

**1. Backend** (`http://localhost:4000`, con Apollo Sandbox para probar la API):

```bash
cd back
npm install
cp .env.example .env
npm run dev
```

En `back/.env` pon tu cadena de conexión en `DATABASE_URL`. Al arrancar se crean
las tablas y los datos semilla de `db.sql` si no existen.

**2. Frontend** (`http://localhost:4321`), en otra terminal:

```bash
cd web
npm install
cp .env.example .env
npm run dev
```

`web/.env` solo necesita `GRAPHQL_URL` (por defecto `http://localhost:4000/`).

**Usuarios de prueba** (vienen en `db.sql`):

| Email | Contraseña | Rol |
|---|---|---|
| `invitado@tienda.com` | `invitado123` | CLIENTE |
| `admin@tienda.com` | `admin123` | ADMIN |

Nunca subas los archivos `.env` al repositorio: contienen la contraseña de la base de datos.

## Producción

```bash
cd web
npm run build
node dist/server/entry.mjs     # servidor Node standalone
```

`web` (adaptador `@astrojs/node`) y `back` pueden desplegarse como dos servicios
Node (por ejemplo en Render o Railway). En `web` define `GRAPHQL_URL` con la URL
pública del backend; en `back`, `DATABASE_URL` y, opcionalmente, `PORT`.

## API GraphQL

**Consultas:** `categorias`, `categoria(id)`, `productos(limit, offset, categoriaId)`,
`producto(id)`, `buscarProductos(texto, categoriaId)`, `carrito`, `misPedidos`,
`pedido(id)`, `pedidos` (admin), `me`.

**Mutaciones:** `login`, `registrar`, `logout`, `agregarAlCarrito`,
`cambiarCantidadCarrito`, `quitarDelCarrito`, `vaciarCarritoDB`, `fusionarCarrito`,
`crearPedido`, y `crearProducto` / `actualizarProducto` / `eliminarProducto` (admin).

Más detalle del backend en [back/README.md](back/README.md).
