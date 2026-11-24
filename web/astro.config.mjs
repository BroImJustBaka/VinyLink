// @ts-check
// Archivo compartido: cambios solo por PR pequeño revisado por A.
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  integrations: [react()],

  // Modo middleware: server.mjs monta el SSR en Express con compresión y
  // caché de archivos estáticos (ver ese archivo).
  adapter: node({
    mode: 'middleware'
  }),

  // Dominios en los que se confía al armar la URL de cada petición. Sin esto,
  // detrás del proxy de Render Astro cree estar en http://localhost y rechaza
  // los formularios POST (login, registro, admin) con "Cross-site POST form
  // submissions are forbidden", porque el Origin del navegador no coincide.
  security: {
    allowedDomains: [
      { hostname: 'vinylink-7f.onrender.com', protocol: 'https' },
      { hostname: 'localhost' },
      { hostname: '127.0.0.1' }
    ]
  },

  build: {
    // El CSS va dentro del HTML: sin hoja de estilos que bloquee el primer
    // pintado (mejora el LCP en móvil). Comprimido pesa ~7 KB.
    inlineStylesheets: 'always'
  }
});
