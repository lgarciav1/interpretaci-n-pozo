/** Identidad fuera de las recetas puras: entropía y reloj sustituibles para pruebas y file://. */
import { inputRevisionIdFromBytes, type InputRevision, type RevisionStamp } from './revisions';

export interface RevisionIdentityOptions {
  /** null fuerza el fallback offline. undefined usa crypto si está disponible. */
  entropy?: ((bytes: Uint8Array<ArrayBuffer>) => void) | null;
  random?: () => number;
  now?: () => Date;
}

export function newInputRevisionStamp(existing: Readonly<Record<string, InputRevision>>, options: RevisionIdentityOptions = {}): RevisionStamp {
  const entropy = options.entropy === undefined
    ? typeof globalThis.crypto?.getRandomValues === 'function' ? (bytes: Uint8Array<ArrayBuffer>) => { globalThis.crypto.getRandomValues(bytes); } : null
    : options.entropy;
  const random = options.random ?? Math.random;
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = new Uint8Array(16);
    let filled = false;
    if (entropy) {
      try { entropy(bytes); filled = true; } catch { /* API no disponible: fallback sin red. */ }
    }
    if (!filled) for (let i = 0; i < bytes.length; i++) {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('La fuente de identidad devolvió un valor inválido.');
      bytes[i] = Math.floor(value * 256);
    }
    const id = inputRevisionIdFromBytes(bytes);
    if (!Object.hasOwn(existing, id)) return { id, createdAt: (options.now ?? (() => new Date()))().toISOString() };
  }
  throw new Error('No se pudo generar un id de revisión único tras ocho intentos.');
}
