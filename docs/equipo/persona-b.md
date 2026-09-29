# Persona B: Carrito, checkout y pedidos

Eres dueño de todo lo que pasa desde "Agregar al carrito" hasta el pedido confirmado.

## Tus archivos

- `web/src/pages/carrito.astro`, `web/src/pages/checkout.astro`, `web/src/pages/pedido/[id].astro`
- `web/src/components/carrito/` (CartBadge y lo que migres)
- `web/src/stores/cart.js`
- `web/src/lib/queries/pedidos.js`
- `back/src/modules/pedidos/`

## Tareas (Fase 1)

- [ ] `carrito.astro`: migrar `front/src/views/CartView.jsx` como isla React (`client:only="react"`, porque el carrito vive en el navegador).
- [ ] `checkout.astro`: migrar `CheckoutView.jsx`. Al confirmar, redirigir a `/pedido/[id]` y vaciar el carrito.
- [ ] `pedido/[id].astro`: página de confirmación (reemplaza el aviso verde que hoy está en `front/src/App.jsx`).
- [ ] Backend: que carrito y pedidos usen `context.user` en vez de recibir `usuarioId` por argumento.
      Usa `requireUser(context)` de `back/src/modules/auth/context.js`.
- [ ] Backend: agregar `misPedidos` (pedidos del usuario logueado) para que C los muestre en `/perfil`.
- [ ] Carrito: sincronizarlo con la DB cuando hay sesión y fusionar el carrito de invitado al iniciar sesión.

## Mantén el contrato

`useCartStore` ya lo usa A en `ProductModal`. Puedes cambiar cómo funciona por
dentro, pero no los nombres ni los parámetros de `agregarProducto`,
`cambiarCantidad`, `quitarProducto`, `vaciarCarrito`, `total` y `cantidadTotal`.

## Probar sin esperar a C

Mientras C termina la auth, pon esto en `back/.env`:

```
AUTH_USUARIO_FALSO=1
```

Así todas las peticiones llegan con `context.user` = usuario 1. Quítalo cuando C entregue la auth.

## Integración (Fase 2)

- Con C: `crearPedido` exige sesión y usa `context.user`; `/checkout` redirige a `/login` sin sesión.
- Con C: `misPedidos` se muestra en `/perfil`.
- QA de la parte de C.
