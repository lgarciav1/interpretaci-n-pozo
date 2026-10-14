/**
 * Convención de archivos solo-worker (docs/arquitectura.md, «Archivos solo-worker»; plugin `workerOnlyFiles` de
 * vite.config.ts). En el build, el hilo principal recibe `<x>.main-thread.ts` en lugar de `<x>.worker-only.ts`; acá se
 * verifica lo que el plugin no puede: que cada par exista con la misma API y que el modelo embebido solo se alcance
 * detrás de un `*.worker-only.ts` (si no, entraría entero al bundle del hilo principal).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as faciesReal from '../src/modules/lithology-facies/predict.worker-only';
import * as faciesStub from '../src/modules/lithology-facies/predict.main-thread';

const WORKER_ONLY = import.meta.glob('../src/**/*.worker-only.{ts,tsx}');
const MAIN_THREAD = import.meta.glob('../src/**/*.main-thread.{ts,tsx}');
const SOURCES = import.meta.glob(['../src/**/*.{ts,tsx}', '!../src/ml/model/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Dependencias pesadas (sin extensión) y quién puede importarlas: un archivo solo-worker, o `embedded.ts` para el modelo. */
const HEAVY: Readonly<Record<string, (file: string) => boolean>> = {
  '../src/ml/embedded': (f) => /\.worker-only\.tsx?$/.test(f),
  '../src/ml/model/lithologyModels': (f) => f === '../src/ml/embedded.ts',
};

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Imports relativos de un archivo, resueltos a rutas como las del glob y sin extensión. */
function relativeImports(file: string, src: string): string[] {
  const dir = file.slice(0, file.lastIndexOf('/'));
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(/(?:\bfrom|\bimport\s*\(|^\s*import)\s*['"](\.{1,2}\/[^'"?]+)['"]/gm)) {
    const parts = `${dir}/${m[1]}`.split('/');
    const stack: string[] = [];
    for (const p of parts) {
      if (p === '.' || p === '') continue;
      if (p === '..' && stack.length && stack[stack.length - 1] !== '..') stack.pop();
      else stack.push(p);
    }
    out.push(stack.join('/').replace(/\.[cm]?[jt]sx?$/, ''));
  }
  return out;
}

describe('archivos solo-worker', () => {
  it('cada *.worker-only.ts tiene su *.main-thread.ts con los mismos exports', async () => {
    const files = Object.keys(WORKER_ONLY);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const stubPath = f.replace(/\.worker-only(\.tsx?)$/, '.main-thread$1');
      expect(MAIN_THREAD, `falta ${stubPath}`).toHaveProperty([stubPath]);
      const [real, stub] = await Promise.all([WORKER_ONLY[f]!(), MAIN_THREAD[stubPath]!()]) as Record<string, unknown>[];
      expect(Object.keys(stub!).sort(), stubPath).toEqual(Object.keys(real!).sort());
      for (const k of Object.keys(real!)) expect(typeof stub![k], `${stubPath}: ${k}`).toBe(typeof real![k]);
    }
    expect(Object.keys(MAIN_THREAD).length).toBe(files.length);
  });

  it('el sustituto del módulo de facies tiene el mismo tipo que el real', () => {
    expectTypeOf(faciesStub).toEqualTypeOf<typeof faciesReal>();
  });

  it('el modelo embebido solo se importa desde archivos solo-worker', () => {
    let seen = 0;
    for (const [f, src] of Object.entries(SOURCES)) {
      for (const target of relativeImports(f, src)) {
        const allowed = HEAVY[target];
        if (!allowed) continue;
        seen++;
        expect(allowed(f), `${f} importa ${target}, que solo puede ir al worker`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(2); // el chequeo ve los imports reales (predict.worker-only → embedded → modelo)
  });
});
