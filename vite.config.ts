/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// El build produce un único dist/index.html autocontenido (se abre con doble clic, sin internet).
// El Web Worker del motor se importa con `?worker&inline`: Vite lo empaqueta aparte y lo incrusta
// como base64 dentro del bundle principal; en tiempo de ejecución se instancia desde un Blob URL.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
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
