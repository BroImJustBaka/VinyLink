# Backend — API GraphQL del e-commerce

Servidor **Apollo Server** (Node.js) que expone un único endpoint GraphQL y se
conecta a una **base de datos PostgreSQL** (hospedada en [Neon](https://neon.tech)),
vía el driver `pg`. El esquema y los datos semilla se aplican automáticamente
al arrancar, a partir del script [`../db.sql`](../db.sql) (es idempotente: no
duplica datos si ya existen).

## Requisitos

| Herramienta | Versión probada |
|---|---|
| Node.js | v24.15.0 (funciona desde Node 18+) |
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
│       ├── catalogo/     # categorías y productos (Persona A)
│       ├── pedidos/      # carrito y pedidos (Persona B)
│       └── auth/         # usuarios, login, context.user (Persona C)
├── .env                  # DATABASE_URL (no se versiona)
└── package.json
```

Cada módulo tiene `typeDefs.js` (usa `extend type Query/Mutation`) y
`resolvers.js`. Si dos módulos definen el mismo resolver, el servidor no
arranca y te dice cuál está duplicado.

## Operaciones principales

**Lecturas**
- `categorias` — todas las categorías con sus productos anidados.
- `categoria(id)` — una categoría por id.
- `productos(limit, offset, categoriaId)` — catálogo paginado.
- `producto(id)` — un producto por id.
- `pedidos` / `pedido(id)` — historial de pedidos.

**Escrituras**
- `crearProducto(data)`, `actualizarProducto(id, data)`, `eliminarProducto(id)`.
- `crearPedido(data)` — recibe comprador (`nombre`, `email`) y `items`
  (`productoId` + `cantidad`); valida stock, calcula el total en el servidor
  y descuenta el stock de cada producto dentro de una transacción.

Ver [`../reporte-p6.md`](../reporte-p6.md) para el DER, el detalle del schema
y las pruebas realizadas.
