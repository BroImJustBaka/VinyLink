# Persona C: Auth, perfil y seguridad

Eres dueño del sistema de autenticación completo: de la contraseña en la base
de datos hasta `Astro.locals.user` en cada página.

## Tus archivos

- `web/src/pages/login.astro`, `web/src/pages/registro.astro`, `web/src/pages/perfil.astro`, `web/src/pages/logout.ts`
- `web/src/pages/api/graphql.ts` (proxy que reenvía la sesión)
- `web/src/middleware.ts`, `web/src/env.d.ts`
- `web/src/components/auth/` (UserMenu y lo que migres)
- `web/src/lib/queries/auth.js`
- `back/src/modules/auth/`
- `db.sql` (tabla de sesiones, cambios de esquema)

## Tareas (Fase 1)

- [ ] **Contraseñas:** hoy se guardan en texto plano. Hashearlas con `bcrypt` o `argon2` y migrar los 2 usuarios semilla de `db.sql`.
- [ ] **Sesiones:** tabla `sesion (token, usuario_id, expira)` en `db.sql`. `login` y `registrar` crean una sesión y regresan el token.
- [ ] Agregar la query `me` y la mutation `logout` al backend.
- [ ] `getUserFromRequest` en `back/src/modules/auth/context.js`: token → usuario. Esto llena `context.user` para B.
- [ ] `/login` y `/registro`: formularios que, al tener éxito, guardan la cookie `sid` (httpOnly, sameSite=lax, secure en producción) y redirigen. Pueden ser formularios Astro con POST (sin JS) o una isla con `AuthForm.jsx`.
- [ ] `middleware.ts`: si hay cookie, pedir `me` y llenar `Astro.locals.user`. Redirigir a `/login?next=...` en `/perfil` y `/checkout` sin sesión.
- [ ] `/logout`: también invalidar la sesión en el backend.
- [ ] `/perfil`: migrar `PerfilView.jsx`.
- [ ] Roles: proteger `crearProducto`, `actualizarProducto` y `eliminarProducto` con `requireAdmin` (pídele a A que lo aplique en su módulo, o mándale el PR).

## Mantén el contrato

A y B dependen de esto, no cambies la forma sin avisar:
- `Astro.locals.user` = `{ id, nombre, email, rol } | null`
- `context.user` en el backend con la misma forma
- Cookie `sid` → header `Authorization: Bearer <sid>`

## Integración (Fase 2)

- Con B: `crearPedido` usa `context.user`; mostrar `misPedidos` en `/perfil`.
- Con B: al iniciar sesión, B fusiona el carrito de invitado (avísale en qué momento pasa).
- QA de la parte de A.
