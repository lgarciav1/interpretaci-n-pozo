/**
 * Almacenamiento del autoguardado (docs/decisiones/0071, punto 1): IndexedDB, base `fiubalog-autoguardado` v1, con dos
 * almacenes: `sesiones` (metadatos chicos, lo único que lee Inicio) y `datos` (el texto del proyecto, varios MB).
 *
 * Esta capa no valida nada: devuelve lo que haya guardado (`unknown`) y la sesión decide qué sirve
 * (`session.ts`). Así, un metadato roto o de otro esquema no tira abajo la lectura de los demás.
 */

export const AUTOSAVE_DB = 'fiubalog-autoguardado';
export const AUTOSAVE_DB_VERSION = 1;
const META_STORE = 'sesiones';
const DATA_STORE = 'datos';

/** Versión del esquema de los metadatos. Un metadato de otro esquema se ignora y se borra. */
export const SESSION_SCHEMA = 1;

export interface SessionMeta {
  schema: typeof SESSION_SCHEMA;
  /** Id de la sesión de trabajo (también es la clave en los dos almacenes). */
  id: string;
  projectName: string;
  /** Nombres de los pozos del proyecto, en orden. */
  wells: string[];
  /** Fecha del guardado (ISO). */
  savedAt: string;
  /** Tamaño del texto guardado, en caracteres (≈ bytes: el proyecto serializado es ASCII). */
  size: number;
  /** Versión del formato del proyecto guardado (6 o 7; null si no se pudo leer). */
  fileVersion: number | null;
}

/** Lo que haya en `sesiones`, sin validar: la clave y el valor tal cual. */
export interface RawSessionEntry {
  key: IDBValidKey;
  value: unknown;
}

export interface AutosaveStorage {
  list(): Promise<RawSessionEntry[]>;
  read(id: string): Promise<string | null>;
  /** Metadatos y texto en una sola transacción: o quedan los dos o ninguno. */
  write(meta: SessionMeta, text: string): Promise<void>;
  /** Borra metadatos y texto de una clave (también claves inválidas, que no son strings). */
  remove(key: IDBValidKey): Promise<void>;
}

// ── IndexedDB ───────────────────────────────────────────────────────────────────────────────────────────────────

const done = (req: IDBRequest) =>
  new Promise<unknown>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Error de IndexedDB.'));
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error de IndexedDB.'));
    tx.onabort = () => reject(tx.error ?? new Error('Se canceló la escritura del autoguardado.'));
  });

class IdbStorage implements AutosaveStorage {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<RawSessionEntry[]> {
    const tx = this.db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
    const ks = Array.isArray(keys) ? (keys as IDBValidKey[]) : [];
    const vs = Array.isArray(values) ? values : [];
    return ks.map((key, i) => ({ key, value: vs[i] }));
  }

  async read(id: string): Promise<string | null> {
    const value = await done(this.db.transaction(DATA_STORE, 'readonly').objectStore(DATA_STORE).get(id));
    return typeof value === 'string' ? value : null;
  }

  async write(meta: SessionMeta, text: string): Promise<void> {
    const tx = this.db.transaction([META_STORE, DATA_STORE], 'readwrite');
    tx.objectStore(DATA_STORE).put(text, meta.id);
    tx.objectStore(META_STORE).put(meta, meta.id);
    await finished(tx);
  }

  async remove(key: IDBValidKey): Promise<void> {
    const tx = this.db.transaction([META_STORE, DATA_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(key);
    tx.objectStore(DATA_STORE).delete(key);
    await finished(tx);
  }
}

/**
 * Abre la base; null si el navegador no tiene IndexedDB o la niega (Firefox en ventana privada, políticas, `file://`
 * en algún navegador). Nunca tira: la app funciona igual sin autoguardado (punto 10).
 */
export async function openStorage(timeoutMs = 5000): Promise<AutosaveStorage | null> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return null;
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(AUTOSAVE_DB, AUTOSAVE_DB_VERSION);
      } catch {
        clearTimeout(timer);
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE);
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        // Otra pestaña con una versión más nueva de la base pide cerrar esta conexión: se libera.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        resolve(null);
      };
    });
    if (!db) return null;
    if (!db.objectStoreNames.contains(META_STORE) || !db.objectStoreNames.contains(DATA_STORE)) {
      db.close();
      return null;
    }
    return new IdbStorage(db);
  } catch {
    return null;
  }
}

// ── En memoria (pruebas) ────────────────────────────────────────────────────────────────────────────────────────

/** Misma interfaz, en memoria. `metas` y `texts` quedan a la vista para que las pruebas siembren datos rotos. */
export class MemoryStorage implements AutosaveStorage {
  readonly metas = new Map<IDBValidKey, unknown>();
  readonly texts = new Map<IDBValidKey, unknown>();
  writes = 0;

  async list(): Promise<RawSessionEntry[]> {
    return [...this.metas].map(([key, value]) => ({ key, value: structuredClone(value) }));
  }
  async read(id: string): Promise<string | null> {
    const v = this.texts.get(id);
    return typeof v === 'string' ? v : null;
  }
  async write(meta: SessionMeta, text: string): Promise<void> {
    this.writes++;
    this.metas.set(meta.id, structuredClone(meta));
    this.texts.set(meta.id, text);
  }
  async remove(key: IDBValidKey): Promise<void> {
    this.metas.delete(key);
    this.texts.delete(key);
  }
}
