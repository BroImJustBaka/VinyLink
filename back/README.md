# Backend — API GraphQL de VinyLink

Servidor **Apollo Server** sobre **Express** (Node.js) que expone un endpoint
GraphQL, recibe los avisos de **Stripe** en `/webhooks/stripe` y se conecta a una
**base de datos PostgreSQL** (hospedada en [Neon](https://neon.tech)), vía el driver `pg`. El esquema y los datos semilla se aplican automáticamente
al arrancar, a partir del script [`../db.sql`](../db.sql) (es idempotente: no
duplica datos si ya existen).

## Requisitos

| Herramienta | Versión probada |
|---|---|
| Node.js | v24.15.0 (funciona desde Node 20+) |
| npm | 11.12.1 |
| PostgreSQL | proyecto en Neon (o cualquier Postgres accesible) |

## Instalación

```bash
cd back
npm install
```

## Variables de entorno

Copia `.env.example` a `.env` y pon la cadena de conexión de tu base Neon:

```
DATABASE_URL=postgresql://usuario:password@ep-xxxx.neon.tech/neondb?sslmode=require
```

Para los pagos agrega las llaves de **prueba** de Stripe (Dashboard →
Desarrolladores → Claves de API) y el secreto del webhook:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # lo imprime `stripe listen`
WEB_URL=http://localhost:4321     # a donde regresa Stripe al cliente
```

Sin `STRIPE_SECRET_KEY` el backend arranca igual, pero el checkout avisa que
los pagos no están configurados. Opcionalmente, `PORT` para cambiar el puerto
(por defecto `4000`).

## Ejecución

```bash
npm start        # modo normal
npm run dev       # se reinicia solo al guardar cambios
```

Verás en consola:

```
Base de datos PostgreSQL lista (esquema + seed verificados).
Stripe listo en modo PRUEBA (sin dinero real).
Servidor GraphQL listo en http://localhost:4000/
Abre esa URL en tu navegador para usar Apollo Sandbox.
Webhook de Stripe en http://localhost:4000/webhooks/stripe
```

Para recibir los webhooks en tu computadora, en otra terminal:

```bash
stripe listen --forward-to localhost:4000/webhooks/stripe
```

## Pruebas automáticas

```bash
npm run probar-pagos
```

Levanta un PostgreSQL temporal (paquete `embedded-postgres`) y el backend real
con un Stripe simulado (`pruebas/stripe-simulado.mjs`), y comprueba los cinco
métodos de pago, rechazos, 3D Secure, fichas vencidas, reembolsos, webhooks,
permisos, concurrencia y las estadísticas del panel. No usa internet ni tu base
de Neon.

Abre esa URL en el navegador para usar **Apollo Sandbox** y probar queries y
mutations directamente.

## Reiniciar la base de datos

Para volver a los datos semilla de `db.sql`, borra las filas de las tablas
(o el proyecto/rama en Neon) y vuelve a levantar el servidor: las tablas y el
seed se recrean automáticamente porque `db.sql` usa `CREATE TABLE IF NOT EXISTS`
e inserta el seed solo si la tabla está vacía.

## Estructura

```
back/
├── src/
│   ├── index.js          # Express + Apollo Server, webhook de Stripe y context.user
│   ├── db.js             # pool de conexión pg + initDb() desde db.sql
│   ├── schema.js         # junta los typeDefs y resolvers de los módulos
│   ├── lib/sql.js        # helpers one/many/transaccion y mapeos snake_case → camelCase
│   └── modules/
│       ├── catalogo/     # categorías, productos y búsqueda
│       ├── pedidos/      # carrito, pedidos e inventario (servicio.js)
│       ├── auth/         # usuarios, sesiones, login, context.user
│       ├── pagos/        # Stripe: stripe.js, servicio.js, webhook.js, vencimientos.js
│       └── admin/        # estadísticas y acciones del panel
├── pruebas/              # pruebas automáticas con Stripe simulado
├── .env                  # DATABASE_URL y llaves de Stripe (no se versiona)
└── package.json
```

Cada módulo tiene `typeDefs.js` (usa `extend type Query/Mutation`) y
`resolvers.js`. Si dos módulos definen el mismo resolver, el servidor no
arranca y te dice cuál está duplicado.

## Autenticación

- `login` y `registrar` regresan el usuario con un `token` de sesión. La
  contraseña se guarda con **bcrypt** y la sesión en la tabla `sesion`
  (solo el SHA-256 del token, expira en 7 días).
- El cliente manda el token en el header `Authorization: Bearer <token>`.
- `src/modules/auth/context.js` convierte el token en `context.user`
  (`{ id, nombre, email, rol } | null`) y expone `requireUser(context)` y
  `requireAdmin(context)` para los resolvers.
- Atajo de desarrollo: `AUTH_USUARIO_FALSO=<id>` en `.env` hace que todas las
  peticiones sean de ese usuario. No lo uses en producción.

## Operaciones principales

**Lecturas**
- `categorias`, `categoria(id)` — categorías con sus productos anidados.
- `productos(limit, offset, categoriaId)` — catálogo paginado.
- `producto(id)` — un producto por id.
- `buscarProductos(texto, categoriaId)` — busca en nombre y descripción (sin distinguir mayúsculas).
- `me` — usuario de la sesión actual.
- `carrito` — carrito del usuario con sesión (se crea vacío si no existe).
- `misPedidos` — historial del usuario con sesión.
- `pedido(id)` — un pedido propio (o cualquiera si eres ADMIN).
- `pedidos` — todos los pedidos (solo ADMIN).
- `configPagos` — si hay pagos, la llave publicable y si es modo de prueba.
- Panel (solo ADMIN): `adminResumen(dias)`, `adminTopProductos(dias, limite)`,
  `adminVentasPorDia(dias)`, `adminVentasPorMetodo(dias)`, `adminStockBajo(umbral)`,
  `adminPedidos(estado, metodo, buscar, limite, offset)`, `adminClientes`.

**Escrituras**
- `login`, `registrar`, `logout`.
- `agregarAlCarrito`, `cambiarCantidadCarrito`, `quitarDelCarrito`,
  `vaciarCarritoDB`, `fusionarCarrito` — siempre sobre el carrito del usuario
  con sesión; validan el stock.
- `crearPedido(data, pago)` — recibe los `items` y el método de pago
  (`credito`, `debito`, `oxxo`, `spei` o `link`). Crea el pedido "pendiente"
  apartando el stock en una transacción, calcula el total en el servidor y le
  pide el cobro a Stripe. Regresa el pedido y, si el banco pide 3D Secure, el
  `clientSecret` para terminarlo en el navegador.
- `sincronizarPago(pedidoId)` — le pregunta a Stripe cómo va un cobro.
- `cancelarPedido(id)` — cancela un pedido pendiente y devuelve el stock.
- `simularTransferenciaSpei(pedidoId)` — solo con llaves de prueba.
- `crearProducto`, `actualizarProducto`, `eliminarProducto` — solo ADMIN.
- `actualizarEstadoPedido`, `reembolsarPedido`, `crearLinkDePagoAdmin`,
  `cambiarRolUsuario` — solo ADMIN.

Estados de un pedido: `pendiente → pagado → enviado → entregado`; un pago
rechazado o vencido lo deja `cancelado` (y regresa el stock); un reembolso lo
deja `reembolsado`.

## Usuarios de prueba

| Email | Contraseña | Rol |
|---|---|---|
| `invitado@tienda.com` | `invitado123` | CLIENTE |
| `admin@tienda.com` | `admin123` | ADMIN |
