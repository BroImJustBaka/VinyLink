# VinyLink — frontend

Frontend de la tienda hecho con Astro (SSR con `@astrojs/node` en modo
middleware) e islas de React con TypeScript. Es también la PWA.
Consulta el [README principal](../README.md) para la descripción completa.

| Comando | Acción |
| :-- | :-- |
| `npm install` | Instala dependencias |
| `npm run dev` | Servidor de desarrollo en `http://localhost:4321` |
| `npm run build` | Compila a `./dist/` |
| `npm start` | Servidor de producción (`server.mjs`: Express con compresión, caché y precalentado de imágenes) |
| `npm run check` | Revisa tipos (Astro + TypeScript) |
| `npm run iconos` | Regenera los íconos de la PWA y de la app Android |

Variables de entorno (`.env`, ver `.env.example`). Astro las incrusta **al
compilar**, así que en producción deben existir antes de `npm run build`:

| Variable | Para qué |
| :-- | :-- |
| `GRAPHQL_URL` | URL del backend GraphQL (por defecto `http://localhost:4000/`) |
| `PUBLIC_GRAPHQL_WS_URL` | WebSocket de las subscriptions (`wss://…/graphql` en producción) |
| `AGENTE_URL` | Microservicio del asistente y reseñas (lo llama el servidor, no el navegador) |
| `AGENTE_CLAVE_INTERNA` | Clave compartida con el agente |

Puntos a destacar:

- `src/pages/img.ts`: optimizador de imágenes (`/img?u=…&w=…`): descarga la foto
  en el servidor, la recorta y la convierte a WebP con `sharp`, con protección
  contra SSRF, caché en memoria y un recuadro neutro si el sitio original falla.
- `src/pages/api/agente/[...ruta].ts`: proxy hacia el agente con lista de rutas
  permitidas; agrega el token de la sesión y la clave interna.
- `public/sw.js` y `public/manifest.webmanifest`: la PWA.
