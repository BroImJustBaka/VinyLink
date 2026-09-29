# Frontend — E-commerce (Vite + React)

Maquetado del flujo de compra `Home → Categoría → Producto → Carrito →
Checkout`, controlado 100% por **estado y eventos** (sin `react-router`, sin
URLs). Consume el backend GraphQL de [`../back`](../back).

## Requisitos

| Herramienta | Versión probada |
|---|---|
| Node.js | v24.15.0 (funciona desde Node 18+) |
| npm | 11.12.1 |

## Instalación

```bash

npm install
```

## Variables de entorno

Por defecto apunta a `http://localhost:4000/`. Si tu backend corre en otra
URL, crea un archivo `.env` en esta carpeta:

```
VITE_GRAPHQL_URL=http://localhost:4000/
```

## Ejecución

**Importante:** levanta primero el backend (`../back`, ver su README) — el
catálogo y el checkout dependen de él.

```bash
npm run dev
```

Abre la URL que imprime Vite (por defecto `http://localhost:5173`).

## Otros comandos

```bash
npm run build     # build de producción en dist/
npm run lint       # revisa el código con oxlint
npm run preview    # sirve el build de producción
```

## Estructura

```
front/src/
├── api/           # cliente GraphQL (fetch) + queries/mutations
├── hooks/         # useGraphQL: hook de fetching con carga/error
├── store/         # useCartStore: carrito global (Zustand)
├── components/    # TopBar, Sidebar, Hero, cards, modal, skeletons...
├── views/         # HomeView, CategoryView, CartView, CheckoutView
└── App.jsx         # maquina de estados: decide que vista se muestra
```

Ver [`../reporte-p2.md`](../reporte-p2.md) para el diagrama de componentes,
la máquina de estados y los temas de React aplicados.
