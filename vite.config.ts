/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * KaTeX declara cada fuente en woff2, woff y ttf. En el HTML único se incrustarían las tres (≈ 1,6 MB en base64) y el
 * navegador solo usa la primera que entiende: todos los navegadores actuales leen woff2, así que se dejan solo esas.
 * docs/decisiones/0025-pantalla-ecuaciones.md.
 */
function katexWoff2Only(): Plugin {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id.split('?')[0]!)) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)|,\s*url\([^)]*\.ttf\)\s*format\(["']truetype["']\)/g, ''), map: null };
    },
  };
}

// El build produce un único dist/index.html autocontenido (se abre con doble clic, sin internet).
// El Web Worker del motor se importa con `?worker&inline`: Vite lo empaqueta aparte y lo incrusta
// como base64 dentro del bundle principal; en tiempo de ejecución se instancia desde un Blob URL.
export default defineConfig({
  base: './',
  plugins: [katexWoff2Only(), react(), viteSingleFile()],
  worker: {
    // Worker clásico (IIFE): no depende de soporte de module workers ni de fetch de chunks.
    format: 'iife',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
