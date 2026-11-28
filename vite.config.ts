/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { buildStandaloneManualHtml, collectManualImageRefs, stripExternalLinks } from './src/app/manual/inlineManual.ts';

interface NodeFs {
  existsSync(p: string): boolean;
  statSync(p: string): { isFile(): boolean };
  readFileSync(p: string, encoding: 'utf8'): string;
  readFileSync(p: string): { toString(encoding: 'base64'): string };
  createReadStream(p: string): {
    on(event: string, listener: () => void): unknown;
    pipe(dest: unknown): void;
  };
}
interface NodePath {
  sep: string;
  dirname(p: string): string;
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  extname(p: string): string;
}
interface NodeUrl {
  fileURLToPath(u: string): string;
}

const VIRTUAL_MANUAL_ID = 'virtual:manual-html';
const RESOLVED_VIRTUAL_MANUAL_ID = `\0${VIRTUAL_MANUAL_ID}`;

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const nodeMod = <T,>(id: string) => import(/* @vite-ignore */ id) as Promise<T>;

/**
 * Expone el manual HTML como módulo virtual:
 * - En Vitest devuelve HTML liviano sin incrustar imágenes base64.
 * - En `vite dev` sirve `docs/manual/img/` en `/__manual__/img/`.
 * - En `vite build` valida e incrusta cada imagen WebP una sola vez para 100 % soporte offline en `dist/index.html`.
 */
function manualHtmlPlugin(): Plugin {
  let isBuild = false;
  let apisPromise: Promise<{ fs: NodeFs; path: NodePath; htmlPath: string; imgDir: string }> | null = null;
  const getApis = () => {
    if (!apisPromise) {
      apisPromise = Promise.all([nodeMod<NodeFs>('node:fs'), nodeMod<NodePath>('node:path'), nodeMod<NodeUrl>('node:url')]).then(
        ([fs, path, url]) => {
          const root = path.dirname(url.fileURLToPath(import.meta.url));
          return {
            fs,
            path,
            htmlPath: path.join(root, 'docs', 'manual', 'index.html'),
            imgDir: path.join(root, 'docs', 'manual', 'img'),
          };
        },
      );
    }
    return apisPromise;
  };

  return {
    name: 'manual-html-inline',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    resolveId(id) {
      return id === VIRTUAL_MANUAL_ID ? RESOLVED_VIRTUAL_MANUAL_ID : null;
    },
    async configureServer(server) {
      const { fs, path, imgDir } = await getApis();
      const safeRoot = imgDir.endsWith(path.sep) ? imgDir : `${imgDir}${path.sep}`;
      server.middlewares.use('/__manual__/img', (req, res, next) => {
        const rawPath = ((req as { url?: string }).url ?? '').split('?')[0] ?? '';
        let decoded: string;
        try {
          decoded = decodeURIComponent(rawPath);
        } catch {
          next();
          return;
        }
        const rel = decoded.replace(/^\/+/, '');
        if (!rel || rel.includes('..') || rel.includes('/') || rel.includes('\\')) {
          next();
          return;
        }
        const ext = path.extname(rel).toLowerCase();
        if (!Object.hasOwn(MIME_BY_EXT, ext)) {
          next();
          return;
        }
        const filePath = path.resolve(imgDir, rel);
        if (!filePath.startsWith(safeRoot)) {
          next();
          return;
        }
        try {
          if (!fs.statSync(filePath).isFile()) {
            next();
            return;
          }
        } catch {
          next();
          return;
        }
        const httpRes = res as {
          statusCode?: number;
          headersSent?: boolean;
          setHeader?(k: string, v: string): void;
          end?(): void;
        };
        httpRes.setHeader?.('Content-Type', MIME_BY_EXT[ext]!);
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => {
          if (!httpRes.headersSent) httpRes.statusCode = 404;
          httpRes.end?.();
        });
        stream.pipe(res);
      });
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MANUAL_ID) return null;
      const { fs, path, htmlPath, imgDir } = await getApis();
      this.addWatchFile(htmlPath);
      const raw = fs.readFileSync(htmlPath, 'utf8');
      const isVitest = Boolean((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST);
      if (isVitest) {
        return `export const MANUAL_HTML = ${JSON.stringify(buildStandaloneManualHtml(stripExternalLinks(raw), {}))};`;
      }
      const refs = collectManualImageRefs(raw);
      const imageMap: Record<string, string> = {};
      for (const ref of refs) {
        const fileName = ref.replace(/^img\//, '');
        const abs = path.join(imgDir, fileName);
        if (!fs.existsSync(abs)) {
          this.error(`Falta la imagen '${ref}' referenciada por docs/manual/index.html (${abs}).`);
        }
        if (isBuild) {
          const mime = MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
          const b64 = fs.readFileSync(abs).toString('base64');
          imageMap[ref] = `data:${mime};base64,${b64}`;
        } else {
          imageMap[ref] = `/__manual__/img/${encodeURIComponent(fileName)}`;
        }
      }
      const standalone = buildStandaloneManualHtml(raw, imageMap);
      return `export const MANUAL_HTML = ${JSON.stringify(standalone)};`;
    },
  };
}

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
  plugins: [katexWoff2Only(), workerOnlyFiles(), manualHtmlPlugin(), react(), viteSingleFile()],
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
