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

/**
 * Dependencias pesadas solo-worker (docs/arquitectura.md, «Archivos solo-worker»): en el bundle del hilo principal,
 * todo import que RESUELVA a `<x>.worker-only.ts` se reemplaza por `<x>.main-thread.ts` (mismo directorio, misma API).
 * Se compara el archivo resuelto, no el texto del import: da igual si se escribe con o sin extensión o con `.js`.
 * Los plugins de `plugins` no se aplican al bundle del worker en el build (ese usa `worker.plugins`), así que el
 * worker sigue recibiendo el archivo real. Primer uso: el random forest embebido del módulo de facies (~1,4 MB), que
 * solo se ejecuta en el motor del worker. Solo en el build: en desarrollo y en Vitest se usa el archivo real en ambos
 * lados. `tests/worker-only.test.ts` verifica la convención (par de archivos con la misma API, modelo solo detrás de
 * un `*.worker-only.ts`).
 */
const WORKER_ONLY_FILE = /\.worker-only(\.[cm]?[jt]sx?)$/;
function workerOnlyFiles(): Plugin {
  return {
    name: 'worker-only-files',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Filtro barato: solo se resuelven aparte los imports que nombran un archivo solo-worker.
      if (!source.includes('.worker-only')) return null;
      const real = await this.resolve(source, importer, { ...options, skipSelf: true });
      const file = real?.id.split('?')[0];
      if (!real || real.external || !file || !WORKER_ONLY_FILE.test(file)) return real;
      const stubFile = file.replace(WORKER_ONLY_FILE, '.main-thread$1');
      const stub = await this.resolve(stubFile, importer, { ...options, skipSelf: true });
      if (!stub) this.error(`Falta ${stubFile} (sustituto de ${file} en el hilo principal), importado desde ${importer}.`);
      return stub;
    },
  };
}

// El build produce un único dist/index.html autocontenido (se abre con doble clic, sin internet).
// El Web Worker del motor se importa con `?worker&inline`: Vite lo empaqueta aparte y lo incrusta
// como base64 dentro del bundle principal; en tiempo de ejecución se instancia desde un Blob URL.
export default defineConfig({
  base: './',
  plugins: [katexWoff2Only(), workerOnlyFiles(), react(), viteSingleFile()],
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
