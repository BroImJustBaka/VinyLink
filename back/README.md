# Backend — API GraphQL de VinyLink

Servidor **Apollo Server** (Node.js) que expone un único endpoint GraphQL y se
conecta a una **base de datos PostgreSQL** (hospedada en [Neon](https://neon.tech)),
vía el driver `pg`. El esquema y los datos semilla se aplican automáticamente
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

Opcionalmente, `PORT` para cambiar el puerto (por defecto `4000`).

## Ejecución

```bash
npm start        # modo normal
npm run dev       # se reinicia solo al guardar cambios
```

Verás en consola:

```
Base de datos PostgreSQL lista (esquema + seed verificados).
Servidor GraphQL listo en http://localhost:4000/
```

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
│   ├── index.js          # arranca Apollo Server y arma context.user
│   ├── db.js             # pool de conexión pg + initDb() desde db.sql
│   ├── schema.js         # junta los typeDefs y resolvers de los módulos
│   ├── lib/sql.js        # helpers one/many y mapeos snake_case → camelCase
│   └── modules/
│       ├── catalogo/     # categorías, productos y búsqueda
│       ├── pedidos/      # carrito y pedidos
│       └── auth/         # usuarios, sesiones, login, context.user
├── .env                  # DATABASE_URL (no se versiona)
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

**Escrituras**
- `login`, `registrar`, `logout`.
- `agregarAlCarrito`, `cambiarCantidadCarrito`, `quitarDelCarrito`,
  `vaciarCarritoDB`, `fusionarCarrito` — siempre sobre el carrito del usuario
  con sesión; validan el stock.
- `crearPedido(data)` — recibe los `items` (`productoId` + `cantidad`); el
  comprador es el usuario con sesión. Valida stock, calcula el total en el
  servidor, descuenta stock y vacía el carrito guardado, todo en una transacción.
- `crearProducto`, `actualizarProducto`, `eliminarProducto` — solo ADMIN.

## Usuarios de prueba

| Email | Contraseña | Rol |
|---|---|---|
| `invitado@tienda.com` | `invitado123` | CLIENTE |
| `admin@tienda.com` | `admin123` | ADMIN |
