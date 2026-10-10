# VinyLink

Tienda en línea de discos, audífonos e instrumentos musicales. El cliente
explora el catálogo por categorías, busca productos, arma su carrito, crea una
cuenta y paga su pedido con tarjeta de crédito o débito, efectivo en OXXO,
transferencia SPEI o un link de pago (todo con Stripe). Después puede consultar
su historial desde su perfil. Los administradores tienen un panel con
estadísticas de ventas, pedidos, inventario, clientes y links de pago.

- **Frontend:** [Astro](https://astro.build) con renderizado en servidor e islas de React.
- **Backend:** API GraphQL con Apollo Server.
- **Base de datos:** PostgreSQL (hospedada en [Neon](https://neon.tech)).
- **Pagos:** [Stripe](https://stripe.com/mx) (modo de prueba para desarrollo).

## Funcionalidades

| Área | Qué hace |
|---|---|
| **Catálogo** | Home con categorías, página por categoría con numeración estilo vinilo (A1, A2… B1…), detalle de producto en un modal y búsqueda por nombre o descripción. |
| **Carrito** | Funciona sin cuenta (se guarda en el navegador). Con sesión se sincroniza con la base de datos y, al iniciar sesión, el carrito de invitado se fusiona con el guardado. |
| **Pedidos** | El pedido nace "pendiente" con el stock apartado y pasa a "pagado" cuando Stripe confirma el cobro. Página `/pedido/[id]` con la ficha OXXO, la CLABE o el link, que se actualiza sola; historial en `/perfil`. |
| **Pagos** | Crédito (con meses sin intereses), débito, OXXO, SPEI y link de pago. El backend comprueba que la tarjeta sea del tipo elegido, cancela y devuelve el stock de los pagos rechazados o vencidos, y recibe los avisos de Stripe por webhook. |
| **Panel admin** | `/admin`: ingresos, ticket promedio, gráfica de productos más vendidos, ingresos por día y por método, stock bajo; gestión de pedidos (enviar, entregar, cancelar, reembolsar), productos, clientes y links de pago. |
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
| `/pago/gracias` | A donde regresa Stripe después de pagar un link | — |
| `/admin` | Resumen: indicadores y gráficas (`?dias=7`, `30` o `90`) | ADMIN |
| `/admin/pedidos`, `/admin/pedidos/[id]` | Pedidos con filtros; detalle y acciones | ADMIN |
| `/admin/productos`, `/admin/productos/[id]` | Inventario; crear (`nuevo`) y editar | ADMIN |
| `/admin/clientes` | Compras por cliente y cambio de rol | ADMIN |
| `/admin/links` | Crear links de pago para un cliente | ADMIN |

Si una ruta protegida se abre sin sesión, se redirige a `/login?next=<ruta>` y,
al entrar, se regresa a donde estaba. Un cliente que abre `/admin` ve un 404.

## Estructura

```
back/                     API GraphQL (Apollo Server + pg)
  src/
    index.js              arranca el servidor y arma context.user
    db.js                 pool de PostgreSQL; aplica db.sql al arrancar
    schema.js             junta typeDefs y resolvers de los módulos
    modules/
      catalogo/           categorías, productos y búsqueda
      pedidos/            carrito en DB, pedidos, historial e inventario (servicio.js)
      auth/               usuarios, sesiones, login/registro, requireUser/requireAdmin
      pagos/              Stripe: cobros, webhook y revisión de pagos vencidos
      admin/              estadísticas y acciones del panel
  pruebas/                pruebas automáticas con Stripe simulado (npm run probar-pagos)
web/                      Frontend Astro (SSR con @astrojs/node)
  src/
    pages/                rutas (ver tabla de arriba) + api/graphql.ts (proxy)
    layouts/Layout.astro  estructura común: TopBar, sidebar opcional y Footer
    components/
      catalogo/           TopBar, Sidebar, Hero, ProductCard, ProductModal (isla)…
      carrito/            CartBadge, CartView y CheckoutForm (islas)
      auth/               UserMenu, AuthForm
      pagos/              PanelPago (ficha/CLABE/link) y SeguimientoPago (isla)
      admin/              AdminNav, Kpi y gráficas (GraficaBarras, GraficaColumnas)
    stores/cart.js        store de Zustand del carrito
    lib/graphql.ts        graphqlServer() y graphqlClient()
    lib/formato.js        dinero, fechas y nombres de estados y métodos de pago
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

En `back/.env` pon tu cadena de conexión en `DATABASE_URL` y las llaves de
prueba de Stripe (ver la sección **Pagos**). Al arrancar se crean las tablas y
los datos semilla de `db.sql` si no existen, y se aplican los cambios nuevos
(columnas de pago y tabla `pago`) sin borrar nada.

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

Nunca subas los archivos `.env` al repositorio: contienen la contraseña de la base de datos
y la llave secreta de Stripe.

## Pagos (Stripe)

1. Crea una cuenta en <https://dashboard.stripe.com/register> con país **México**
   y deja activado el **modo de prueba** (no se mueve dinero real).
2. En **Configuración → Pagos → Métodos de pago** activa OXXO, Transferencias
   bancarias (SPEI) y Meses sin intereses.
3. En **Desarrolladores → Claves de API** copia las dos llaves de prueba a `back/.env`:

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   WEB_URL=http://localhost:4321
   ```

4. Para recibir los avisos de Stripe (webhooks) en tu computadora instala la
   [Stripe CLI](https://docs.stripe.com/stripe-cli) y, con el backend corriendo:

   ```bash
   stripe login
   stripe listen --forward-to localhost:4000/webhooks/stripe
   ```

   Copia el `whsec_...` que imprime a `STRIPE_WEBHOOK_SECRET` en `back/.env` y
   reinicia el backend. Sin webhooks los pagos se actualizan igual (la página del
   pedido y una revisión cada 5 minutos le preguntan a Stripe), pero más lento.

**Datos de prueba:** tarjeta `4242 4242 4242 4242` (crédito), `4000 0566 5566 5556`
(débito), `4000 0048 4000 0008` (meses sin intereses), `4000 0027 6000 3184`
(3D Secure), `4000 0000 0000 0002` (rechazada); cualquier fecha futura y CVC.
En OXXO el email decide la simulación: `succeed_immediately@test.com` se paga al
instante y `expire_immediately@test.com` vence. SPEI tiene un botón
"Simular transferencia" en la página del pedido.

## Pruebas automáticas

```bash
cd back
npm run probar-pagos
```

Levanta un PostgreSQL temporal y el backend con un Stripe simulado (no necesita
cuenta, internet ni toca Neon) y recorre los cinco métodos de pago, rechazos,
vencimientos, reembolsos, webhooks, permisos y el panel admin.

## Producción

```bash
cd web
npm run build
node dist/server/entry.mjs     # servidor Node standalone
```

`web` (adaptador `@astrojs/node`) y `back` pueden desplegarse como dos servicios
Node (por ejemplo en Render o Railway). En `web` define `GRAPHQL_URL` con la URL
pública del backend; en `back`, `DATABASE_URL`, las variables de Stripe,
`WEB_URL` con la URL pública del frontend y, opcionalmente, `PORT`. En el
Dashboard de Stripe agrega un webhook hacia `https://<tu-backend>/webhooks/stripe`
y usa su secreto en `STRIPE_WEBHOOK_SECRET`. Para cobrar dinero real hay que
activar la cuenta de Stripe y cambiar las llaves `sk_test_`/`pk_test_` por
`sk_live_`/`pk_live_`.

## API GraphQL

**Consultas:** `categorias`, `categoria(id)`, `productos(limit, offset, categoriaId)`,
`producto(id)`, `buscarProductos(texto, categoriaId)`, `carrito`, `misPedidos`,
`pedido(id)`, `pedidos` (admin), `me`, `configPagos`, y para el panel (admin)
`adminResumen`, `adminTopProductos`, `adminVentasPorDia`, `adminVentasPorMetodo`,
`adminStockBajo`, `adminPedidos`, `adminClientes`.

**Mutaciones:** `login`, `registrar`, `logout`, `agregarAlCarrito`,
`cambiarCantidadCarrito`, `quitarDelCarrito`, `vaciarCarritoDB`, `fusionarCarrito`,
`crearPedido(data, pago)`, `sincronizarPago`, `cancelarPedido`,
`simularTransferenciaSpei` (solo modo de prueba), y para admin
`crearProducto` / `actualizarProducto` / `eliminarProducto`, `actualizarEstadoPedido`,
`reembolsarPedido`, `crearLinkDePagoAdmin`, `cambiarRolUsuario`.

Además de GraphQL, el backend recibe los avisos de Stripe en `POST /webhooks/stripe`.

Más detalle del backend en [back/README.md](back/README.md).
