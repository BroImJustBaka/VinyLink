# VinyLink

Tienda en línea de discos, audífonos e instrumentos musicales. El cliente
explora el catálogo por categorías, busca productos, arma su carrito, crea una
cuenta y paga su pedido con tarjeta de crédito o débito, efectivo en OXXO,
transferencia SPEI o un link de pago (todo con Stripe). Después puede consultar
su historial desde su perfil. El personal de la tienda tiene un **back office**
completo: ventas y reportes, pedidos con envío y guía, catálogo, inventario con
kárdex y proveedores, clientes, cupones, correos, bitácora de auditoría y
configuración, con roles (Admin, Almacén, Soporte, Finanzas) y avisos en tiempo
real por **GraphQL subscriptions** (WebSocket).

- **Frontend:** [Astro](https://astro.build) con renderizado en servidor e islas de React.
- **Backend:** API GraphQL con Apollo Server; subscriptions con `graphql-ws` sobre WebSocket.
- **Base de datos:** PostgreSQL (hospedada en [Neon](https://neon.tech)).
- **Pagos:** [Stripe](https://stripe.com/mx) (modo de prueba para desarrollo).

## Funcionalidades

| Área | Qué hace |
|---|---|
| **Catálogo** | Home con categorías, página por categoría con numeración estilo vinilo (A1, A2… B1…), detalle de producto en un modal y búsqueda por nombre o descripción. |
| **Carrito** | Funciona sin cuenta (se guarda en el navegador). Con sesión se sincroniza con la base de datos y, al iniciar sesión, el carrito de invitado se fusiona con el guardado. |
| **Pedidos** | El pedido nace "pendiente" con el stock apartado y pasa a "pagado" cuando Stripe confirma el cobro. Página `/pedido/[id]` con la ficha OXXO, la CLABE o el link, que se actualiza sola; historial en `/perfil`. |
| **Pagos** | Crédito (con meses sin intereses), débito, OXXO, SPEI y link de pago. El backend comprueba que la tarjeta sea del tipo elegido, cancela y devuelve el stock de los pagos rechazados o vencidos, y recibe los avisos de Stripe por webhook. |
| **Envío y cupones** | El checkout pide la dirección (con libreta de direcciones del cliente) y acepta cupones (porcentaje, monto fijo o envío gratis). El backend cotiza subtotal, descuento, envío e IVA con el mismo cálculo con el que cobra. |
| **Panel admin** | `/admin`: indicadores, gráficas y stock bajo; pedidos con dirección, paquetería y guía, línea de tiempo, notas internas y reembolsos totales o parciales; productos (SKU, activo/inactivo, subida de imágenes) y categorías; inventario con kárdex, entradas, ajustes y proveedores; clientes (ficha, bloqueo, link de contraseña); cupones; links de pago; reportes y CSV; correos; bitácora; configuración. |
| **Roles y permisos** | `ADMIN`, `ALMACEN`, `SOPORTE` y `FINANZAS` ven solo las secciones de su rol; el backend revisa el permiso en cada operación (`requirePermiso`). |
| **Tiempo real** | Subscriptions `pedidoActualizado`, `stockActualizado` y `eventosAdmin`: avisos en el panel (pedido nuevo, pago, stock bajo, acciones del personal), la página del pedido del cliente se actualiza sola y el stock del detalle de producto cambia en vivo. |
| **Correos** | Confirmación, pago, envío con guía, cancelación, reembolso y recuperación de contraseña. Con SMTP se mandan de verdad; sin SMTP quedan "simulados" y se leen en `/admin/correos`. |
| **Cuentas** | Registro e inicio de sesión con contraseñas hasheadas (bcrypt), sesiones en base de datos y cookie `httpOnly`. Recuperar contraseña por correo, editar perfil y cambiar contraseña. Cuentas bloqueables. |

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
| `/olvide`, `/restablecer?token=` | Pedir y usar el link para cambiar la contraseña | — |
| `/perfil` | Historial de pedidos, datos, contraseña, libreta de direcciones y cerrar sesión | Requerida |
| `/logout` | Cierra la sesión (solo `POST`) | — |
| `/pago/gracias` | A donde regresa Stripe después de pagar un link | — |
| `/admin` | Resumen: indicadores y gráficas (`?dias=7`, `30` o `90`) | reportes |
| `/admin/pedidos`, `/admin/pedidos/[id]` | Pedidos con filtros; detalle, envío, línea de tiempo y acciones | pedidos.ver |
| `/admin/productos`, `/admin/productos/[id]` | Productos; crear (`nuevo`) y editar, con subida de imagen | catalogo |
| `/admin/categorias` | Crear, editar y borrar categorías | catalogo |
| `/admin/inventario` | Kárdex, entradas de mercancía y ajustes (`?producto=5`) | inventario |
| `/admin/proveedores` | Proveedores | inventario |
| `/admin/clientes`, `/admin/clientes/[id]` | Búsqueda, ficha, bloqueo y cambio de rol | clientes |
| `/admin/cupones` | Cupones de descuento | cupones |
| `/admin/links` | Crear links de pago para un cliente | links |
| `/admin/reportes` | Ventas por categoría y descargas CSV | reportes |
| `/admin/exportar/[tipo].csv` | Descarga de un reporte (`?desde=&hasta=`) | según el reporte |
| `/admin/correos` | Bandeja de salida con vista previa (`?ver=5`) | correos |
| `/admin/bitacora` | Bitácora de auditoría | bitacora (ADMIN) |
| `/admin/configuracion` | Envío, IVA, paqueterías y tabla de permisos por rol | configuracion (ADMIN) |
| `/imagenes/[id]` | Imágenes subidas desde el panel | — |

Si una ruta protegida se abre sin sesión, se redirige a `/login?next=<ruta>` y,
al entrar, se regresa a donde estaba. Un cliente que abre `/admin` ve un 404;
alguien del personal que abre una sección que su rol no tiene, también (y en
`/admin` se le manda a su primera sección).

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
      admin/              estadísticas, clientes, envíos, reembolsos, bitácora y CSV
      inventario/         kárdex (moverStock), entradas, ajustes y proveedores
      cupones/            cupones y su validación
      configuracion/      envío, IVA y paqueterías (tabla configuracion)
      notificaciones/     correos (nodemailer o simulados) y sus plantillas
      tiempo-real/        subscriptions GraphQL y tickets del WebSocket
    lib/pubsub.js         eventos en tiempo real (PubSub)
    lib/bitacora.js       registrar() de la bitácora de auditoría
  pruebas/                pruebas automáticas (npm run probar) y demo (npm run demo)
web/                      Frontend Astro (SSR con @astrojs/node)
  src/
    pages/                rutas (ver tabla de arriba) + api/graphql.ts (proxy)
    layouts/Layout.astro  estructura común: TopBar, sidebar opcional y Footer
    components/
      catalogo/           TopBar, Sidebar, Hero, ProductCard, ProductModal (isla)…
      carrito/            CartBadge, CartView y CheckoutForm (islas)
      auth/               UserMenu, AuthForm
      pagos/              PanelPago (ficha/CLABE/link) y SeguimientoPago (isla)
      admin/              AdminNav, AvisosAdmin (isla en vivo), Kpi y gráficas
    stores/cart.js        store de Zustand del carrito
    lib/graphql.ts        graphqlServer() y graphqlClient()
    lib/formato.js        dinero, fechas y nombres de estados y métodos de pago
    lib/permisos.js       secciones del panel y el permiso de cada una
    lib/tiempoReal.js     cliente graphql-ws del navegador (suscribirse)
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

`web/.env` necesita `GRAPHQL_URL` (por defecto `http://localhost:4000/`) y,
para el tiempo real, `PUBLIC_GRAPHQL_WS_URL` (por defecto `ws://localhost:4000/graphql`).

**Demo sin Neon ni Stripe:** `cd back && npm run demo` levanta el backend en el
puerto 4000 con una base temporal y Stripe simulado (OXXO, SPEI y links
funcionan; tarjeta no). Al cerrarlo se borra todo.

**Usuarios de prueba** (vienen en `db.sql`):

| Email | Contraseña | Rol |
|---|---|---|
| `invitado@tienda.com` | `invitado123` | CLIENTE |
| `admin@tienda.com` | `admin123` | ADMIN |

Para probar los otros roles, registra una cuenta y cámbiale el rol en
`/admin/clientes` (Almacén, Soporte o Finanzas). Cupones de ejemplo:
`BIENVENIDA10` (10 %) y `ENVIOGRATIS`.

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
npm run probar
```

Levanta un PostgreSQL temporal y el backend con un Stripe simulado (no necesita
cuenta, internet ni toca Neon). `probar-pagos` recorre los cinco métodos de
pago, rechazos, vencimientos, reembolsos y webhooks; `probar-backoffice`, los
roles, catálogo, kárdex, cupones, envíos, reembolsos parciales, clientes,
contraseñas, correos, bitácora, CSV y las subscriptions por WebSocket.

## Producción

```bash
cd web
npm run build
node dist/server/entry.mjs     # servidor Node standalone
```

`web` (adaptador `@astrojs/node`) y `back` pueden desplegarse como dos servicios
Node (por ejemplo en Render o Railway). En `web` define `GRAPHQL_URL` con la URL
pública del backend y `PUBLIC_GRAPHQL_WS_URL` con `wss://<tu-backend>/graphql`
(se usa al compilar); en `back`, `DATABASE_URL`, las variables de Stripe,
`WEB_URL` con la URL pública del frontend, las de SMTP si quieres mandar
correos y, opcionalmente, `PORT`. El tiempo real usa un PubSub en memoria:
con un solo proceso del backend funciona tal cual. En el
Dashboard de Stripe agrega un webhook hacia `https://<tu-backend>/webhooks/stripe`
y usa su secreto en `STRIPE_WEBHOOK_SECRET`. Para cobrar dinero real hay que
activar la cuenta de Stripe y cambiar las llaves `sk_test_`/`pk_test_` por
`sk_live_`/`pk_live_`.

## API GraphQL

**Consultas:** `categorias`, `categoria(id)`, `productos(limit, offset, categoriaId)`,
`producto(id)`, `buscarProductos(texto, categoriaId)`, `carrito`, `misPedidos`,
`pedido(id)`, `cotizarPedido(data)`, `misDirecciones`, `me`, `configPagos`,
`configuracionTienda`, y para el panel `pedidos`, `adminResumen`,
`adminTopProductos`, `adminVentasPorDia`, `adminVentasPorMetodo`,
`adminVentasPorCategoria`, `adminStockBajo`, `adminPedidos`, `adminClientes`,
`adminCliente`, `adminMovimientos`, `adminResumenInventario`, `proveedores`,
`adminCupones`, `adminCorreos`, `adminBitacora`, `adminExportar`,
`permisosPorRol`.

**Mutaciones:** `login`, `registrar`, `logout`, `agregarAlCarrito`,
`cambiarCantidadCarrito`, `quitarDelCarrito`, `vaciarCarritoDB`, `fusionarCarrito`,
`crearPedido(data, pago)`, `sincronizarPago`, `cancelarPedido`,
`simularTransferenciaSpei` (solo modo de prueba), `guardarDireccion`,
`eliminarDireccion`, `solicitarRestablecimiento`, `restablecerPassword`,
`actualizarMiPerfil`, `cambiarMiPassword`, `ticketTiempoReal`, y para el panel
`crearProducto` / `actualizarProducto` / `cambiarActivoProducto` /
`eliminarProducto`, `crearCategoria` / `actualizarCategoria` / `eliminarCategoria`,
`subirImagen`, `registrarEntrada`, `ajustarStock`, `crearProveedor` /
`actualizarProveedor`, `crearCupon` / `actualizarCupon`, `actualizarEstadoPedido`,
`actualizarGuiaPedido`, `agregarNotaPedido`, `reembolsarPedido` (total o parcial),
`crearLinkDePagoAdmin`, `cambiarRolUsuario`, `bloquearUsuario`,
`enviarRestablecimientoCliente`, `reenviarCorreo`, `actualizarConfiguracion`.

**Subscriptions** (WebSocket en `ws://localhost:4000/graphql`, protocolo
`graphql-ws`): `pedidoActualizado(id)`, `stockActualizado(productoId)` y
`eventosAdmin`. Para conectarse con sesión se pide primero `ticketTiempoReal`
(un ticket de un solo uso que vence en 60 s) y se manda como
`connectionParams.ticket`.

Además de GraphQL, el backend recibe los avisos de Stripe en `POST /webhooks/stripe`
y sirve las imágenes subidas en `GET /imagenes/:id`.

Más detalle del backend en [back/README.md](back/README.md).
