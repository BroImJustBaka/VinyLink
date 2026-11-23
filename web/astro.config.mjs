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

  build: {
    // El CSS va dentro del HTML: sin hoja de estilos que bloquee el primer
    // pintado (mejora el LCP en móvil). Comprimido pesa ~7 KB.
    inlineStylesheets: 'always'
  }
});
