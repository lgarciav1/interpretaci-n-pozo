/**
 * Lógica del autoguardado (docs/decisiones/0071), sin React ni stores: todo lo de afuera entra por `AutosaveDeps`
 * (almacenamiento, worker de archivos, proyecto actual, reloj y temporizadores), así se prueba con un reloj falso y
 * un almacenamiento en memoria.
 *
 * - Sesión de trabajo: empieza al abrir un proyecto o con el primer cambio sobre el proyecto del arranque, y continúa
 *   al recuperarla. Cada guardado reemplaza la copia de su sesión; quedan las 3 más recientes.
 * - «A salvo» se decide por referencia (el store es inmutable): el proyecto actual es el último que se escribió en el
 *   navegador, el último `.pozo.json` guardado o el que se abrió. Deshacer hasta ahí vuelve a contar como guardado.
 */
import type { Project } from '../../core/state/project';
import type { ArchiveIssue } from '../../core/state/archive/projectV7';
import { PROJECT_VERSION, REVISION_PROJECT_VERSION } from '../../core/state/serialize';
import { isContentError, type ProjectFileResult, type ProjectFileTask } from '../projectFiles/task';
import { DEMO_WELL_ID } from '../demo/ids';
import { SESSION_SCHEMA, type AutosaveStorage, type RawSessionEntry, type SessionMeta } from './storage';

/** Espera desde el último cambio (punto 4). */
export const AUTOSAVE_DELAY_MS = 3000;
/** Reintento mientras hay un arrastre en el visor. */
export const DRAG_RETRY_MS = 400;
/** Sesiones de trabajo que se conservan (punto 5). */
export const MAX_SESSIONS = 3;
/**
 * Reintentos tras un guardado fallido (cupo lleno, base cerrada…): 3 s, 15 s y 60 s; después se espera al próximo
 * cambio del proyecto. Sin esto, un error persistente reintentaría cada 3 s para siempre.
 */
export const RETRY_DELAYS_MS = [3000, 15000, 60000] as const;
/** Versión de formato más nueva que esta app sabe abrir. */
export const NEWEST_FILE_VERSION = Math.max(PROJECT_VERSION, REVISION_PROJECT_VERSION);

/**
 * `empty`: nada que salvar (sin pozos); `demo`: solo el pozo de demostración, que no se autoguarda; `error`: el último
 * autoguardado falló (con reintentos espaciados).
 */
export type AutosaveStatus = 'empty' | 'demo' | 'saved' | 'saving' | 'dirty' | 'error' | 'unavailable';

export interface AutosaveSnapshot {
  status: AutosaveStatus;
  /** El navegador dio IndexedDB. */
  available: boolean;
  /** Último guardado en el navegador de esta sesión (ms). */
  autoSavedAt: number | null;
  /** El proyecto actual es el del último `.pozo.json` (guardado o abierto) o el del arranque. */
  fileSafe: boolean;
  /** De dónde viene la referencia de archivo: el arranque (nada que salvar), «Guardar proyecto» o «Abrir proyecto». */
  fileOrigin: 'boot' | 'saved' | 'opened';
  /** El proyecto actual es el último que se escribió en el navegador. */
  autoSafe: boolean;
  /** Sesiones guardadas, la más reciente primero. */
  sessions: SessionMeta[];
  sessionId: string | null;
  /** Hay una recuperación en curso. */
  restoring: boolean;
  /** Motivo del último autoguardado fallido (null si el último salió bien). */
  error: string | null;
}

export interface AutosaveNotice {
  title: string;
  description?: string;
  tone: 'ok' | 'warn' | 'error' | 'info';
}

export interface AutosaveDeps {
  storage: AutosaveStorage | null;
  /** Worker de archivos con cliente propio (tareas `save`, `open`, `recover`). */
  files: { run(task: ProjectFileTask): Promise<ProjectFileResult> };
  getProject(): Project;
  /** Hay un arrastre en curso en el visor: se espera a que termine. */
  isDragging?(): boolean;
  /** Publica el proyecto recuperado (reemplaza el del store y reinicia la interfaz). */
  applyRestored?(project: Project): void;
  notify?(notice: AutosaveNotice): void;
  onChange?(snapshot: AutosaveSnapshot): void;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  newId?(): string;
}

const hasWells = (p: Project) => p.wells.length > 0;
/** Proyecto cuyos pozos son todos el de demostración: se rehace en un clic y no ocupa una de las 3 sesiones. */
export const isDemoOnly = (p: Project) => hasWells(p) && p.wells.every((w) => w.well.id === DEMO_WELL_ID);
/** Hay algo que el autoguardado tenga que salvar. */
const worthSaving = (p: Project) => hasWells(p) && !isDemoOnly(p);

function defaultId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Versión del formato. Primero la cabecera (`{"format":"pozo-proyecto","version":N`, como la escribe
 * `serializeProject`), sin parsear los MB del proyecto; si no está así, el texto completo. null si no es un proyecto.
 */
export function fileVersionOf(text: string): number | null {
  const m = /^\s*\{\s*"format"\s*:\s*"pozo-proyecto"\s*,\s*"version"\s*:\s*(\d+)\s*[,}]/.exec(text.slice(0, 200));
  if (m) return Number(m[1]);
  try {
    const raw = JSON.parse(text) as { format?: unknown; version?: unknown } | null;
    return raw && typeof raw === 'object' && raw.format === 'pozo-proyecto' && Number.isInteger(raw.version) ? (raw.version as number) : null;
  } catch {
    return null;
  }
}

/** Metadato válido del esquema actual, o null (se ignora y se borra). */
export function validateMeta(entry: RawSessionEntry): SessionMeta | null {
  const v = entry.value as Partial<SessionMeta> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.schema !== SESSION_SCHEMA) return null;
  if (typeof v.id !== 'string' || !v.id || v.id !== entry.key) return null;
  if (typeof v.projectName !== 'string') return null;
  if (!Array.isArray(v.wells) || !v.wells.every((w) => typeof w === 'string')) return null;
  if (typeof v.savedAt !== 'string' || !Number.isFinite(Date.parse(v.savedAt))) return null;
  if (typeof v.size !== 'number' || !Number.isFinite(v.size) || v.size < 0) return null;
  const fileVersion = typeof v.fileVersion === 'number' && Number.isInteger(v.fileVersion) ? v.fileVersion : null;
  return { schema: SESSION_SCHEMA, id: v.id, projectName: v.projectName, wells: [...v.wells], savedAt: v.savedAt, size: v.size, fileVersion };
}

/** Motivo legible de un error de guardado (el cupo lleno de IndexedDB tiene nombre propio). */
function describeError(err: unknown): string {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'QuotaExceededError') return 'El navegador no tiene más espacio para el autoguardado.';
  const message = err instanceof Error ? err.message : String(err);
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

const byRecent = (a: SessionMeta, b: SessionMeta) => Date.parse(b.savedAt) - Date.parse(a.savedAt);

export class AutosaveSession {
  private storage: AutosaveStorage | null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly newId: () => string;

  private sessionId: string | null = null;
  /** Proyecto del último `.pozo.json` guardado o abierto (o el del arranque, que no hay que salvar). */
  private fileRef: Project | null;
  private fileOrigin: AutosaveSnapshot['fileOrigin'] = 'boot';
  /** Último proyecto escrito en el navegador en esta sesión de trabajo. */
  private autoRef: Project | null = null;
  private autoSavedAt: number | null = null;
  private timer: unknown = null;
  private writing: Promise<void> | null = null;
  private restoring = false;
  private sessions: SessionMeta[] = [];
  private disposed = false;
  /** Guardados fallidos seguidos (racha); 0 tras uno bueno. */
  private failures = 0;
  private lastError: string | null = null;
  /** Ya se sabe si hay base (mientras se abre, no se dice «Sin autoguardado»). */
  private storageKnown: boolean;

  constructor(private readonly deps: AutosaveDeps) {
    this.storage = deps.storage;
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.newId = deps.newId ?? defaultId;
    // El proyecto del arranque (vacío, o la demostración de `?inicio=no`) se rehace solo: no hay nada que salvar.
    this.fileRef = deps.getProject();
    this.storageKnown = deps.storage !== null;
  }

  get available(): boolean {
    return this.storage !== null;
  }

  /** El navegador no dio IndexedDB (punto 10): la barra dice «Sin autoguardado». */
  storageUnavailable(): void {
    this.storageKnown = true;
    this.publish();
  }

  /**
   * La base se abre después del arranque (no lo demora): al llegar, se leen las sesiones y, si el proyecto ya cambió,
   * se programa el guardado.
   */
  async attachStorage(storage: AutosaveStorage): Promise<void> {
    if (this.disposed || this.storage) return;
    this.storage = storage;
    this.storageKnown = true;
    await this.prune();
    const p = this.deps.getProject();
    if (p !== this.fileRef) this.projectChanged(p);
  }

  // ── Estado ────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * El proyecto actual no se pierde al cerrar: no tiene pozos, es solo la demostración, o es el del archivo o el del
   * autoguardado.
   */
  isProjectSafe(): boolean {
    const p = this.deps.getProject();
    if (!worthSaving(p)) return true;
    return p === this.fileRef || p === this.autoRef;
  }

  snapshot(): AutosaveSnapshot {
    const p = this.deps.getProject();
    const fileSafe = p === this.fileRef;
    const autoSafe = p === this.autoRef;
    let status: AutosaveStatus;
    const missing = !this.storage && this.storageKnown;
    if (!hasWells(p)) status = missing ? 'unavailable' : 'empty';
    else if (isDemoOnly(p)) status = 'demo';
    else if (missing) status = 'unavailable';
    else if (this.writing && !autoSafe) status = 'saving';
    else if (fileSafe || autoSafe) status = 'saved';
    else status = this.failures > 0 ? 'error' : 'dirty';
    return {
      status,
      available: !!this.storage,
      autoSavedAt: this.autoSavedAt,
      fileSafe,
      fileOrigin: this.fileOrigin,
      autoSafe,
      sessions: this.sessions,
      sessionId: this.sessionId,
      restoring: this.restoring,
      error: this.failures > 0 ? this.lastError : null,
    };
  }

  private publish(): void {
    if (!this.disposed) this.deps.onChange?.(this.snapshot());
  }

  // ── Eventos de la app ─────────────────────────────────────────────────────────────────────────────────────────

  /** El proyecto del store cambió (otro objeto). */
  projectChanged(project: Project): void {
    if (this.disposed) return;
    if (this.sessionId === null && project !== this.fileRef) this.sessionId = this.newId();
    // Cada cambio reinicia la espera, también tras una racha de fallos (la pausa termina con el próximo cambio).
    if (project !== this.autoRef && worthSaving(project) && this.storage) this.schedule(AUTOSAVE_DELAY_MS);
    this.publish();
  }

  /** «Guardar proyecto» terminó: ese objeto quedó en un `.pozo.json`. */
  savedToFile(project: Project): void {
    this.fileRef = project;
    this.fileOrigin = 'saved';
    this.publish();
  }

  /**
   * Se va a abrir un proyecto desde un archivo: sesión de trabajo nueva, y el proyecto abierto cuenta como guardado en
   * archivo. Se llama ANTES de publicarlo en el store, para que el cambio no se guarde en la sesión anterior.
   */
  openedFromFile(project: Project): void {
    this.sessionId = this.newId();
    this.fileRef = project;
    this.fileOrigin = 'opened';
    this.autoRef = null;
    this.autoSavedAt = null;
    this.cancelTimer();
  }

  // ── Escritura ─────────────────────────────────────────────────────────────────────────────────────────────────

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  /** Guarda ya (si hace falta). Devuelve cuando terminó la escritura en curso o esta. */
  async flush(): Promise<void> {
    if (this.disposed || !this.storage) return;
    if (this.writing) {
      // Otro guardado en curso: al terminar, se reprograma si el proyecto siguió cambiando.
      await this.writing;
      return;
    }
    if (this.restoring) {
      // Recuperar usa el mismo worker: se guarda después (si el proyecto no fue reemplazado).
      this.schedule(AUTOSAVE_DELAY_MS);
      return;
    }
    if (this.deps.isDragging?.()) {
      this.schedule(DRAG_RETRY_MS);
      return;
    }
    const project = this.deps.getProject();
    if (!worthSaving(project) || project === this.autoRef) return;
    if (this.sessionId === null) this.sessionId = this.newId();
    const writing = this.write(project, this.sessionId);
    this.writing = writing.then(() => undefined);
    this.publish();
    let ok = false;
    try {
      ok = await writing;
    } finally {
      this.writing = null;
      this.publish();
    }
    if (this.disposed) return;
    const current = this.deps.getProject();
    if (current === this.autoRef || !worthSaving(current)) return;
    if (ok) {
      // Cambió mientras se serializaba: otra vuelta (con la espera completa, como cualquier cambio).
      if (this.timer === null) this.schedule(AUTOSAVE_DELAY_MS);
      return;
    }
    // Falló: reintentos espaciados y, agotados, pausa hasta el próximo cambio (que reprograma en `projectChanged`).
    // Un cambio llegado durante la escritura ya dejó su propio temporizador: no se pisa.
    const delay = RETRY_DELAYS_MS[this.failures - 1];
    if (delay !== undefined && this.timer === null) this.schedule(delay);
  }

  /** Serializa y escribe; devuelve si salió bien. Nunca tira. */
  private async write(project: Project, sessionId: string): Promise<boolean> {
    const storage = this.storage!;
    try {
      const result = await this.deps.files.run({ kind: 'save', project });
      if (result.kind !== 'save') throw new Error('Respuesta de guardado inválida.');
      const savedAt = this.now();
      const meta: SessionMeta = {
        schema: SESSION_SCHEMA,
        id: sessionId,
        projectName: project.name,
        wells: project.wells.map((w) => w.well.name),
        savedAt: new Date(savedAt).toISOString(),
        size: result.text.length,
        fileVersion: fileVersionOf(result.text),
      };
      await storage.write(meta, result.text);
      // Si mientras tanto se abrió o recuperó otro proyecto, esta copia ya no es la de la sesión actual.
      if (this.sessionId === sessionId) {
        this.autoRef = project;
        this.autoSavedAt = savedAt;
      }
      this.failures = 0;
      this.lastError = null;
      await this.prune();
      return true;
    } catch (err) {
      // Un autoguardado fallido no interrumpe el trabajo: la barra pasa a «Autoguardado falló» y se avisa una vez
      // por racha (los reintentos siguientes no repiten el toast).
      console.warn('Autoguardado: no se pudo guardar', err);
      this.failures++;
      this.lastError = describeError(err);
      if (this.failures === 1) {
        this.deps.notify?.({ title: 'No se pudo autoguardar', description: `${this.lastError} Se reintenta en unos segundos; mientras tanto, guardá el proyecto en un archivo.`, tone: 'error' });
      }
      return false;
    }
  }

  // ── Sesiones ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Lee los metadatos válidos (borra los inválidos) y deja solo las 3 más recientes. Nunca tira. */
  async refresh(): Promise<SessionMeta[]> {
    await this.prune();
    return this.sessions;
  }

  private async prune(): Promise<void> {
    if (!this.storage) return;
    try {
      const raw = await this.storage.list();
      const valid: SessionMeta[] = [];
      for (const entry of raw) {
        const meta = validateMeta(entry);
        if (meta) valid.push(meta);
        else await this.storage.remove(entry.key).catch(() => undefined);
      }
      valid.sort(byRecent);
      for (const old of valid.slice(MAX_SESSIONS)) await this.storage.remove(old.id).catch(() => undefined);
      this.sessions = valid.slice(0, MAX_SESSIONS);
    } catch (err) {
      console.warn('Autoguardado: no se pudo leer la lista de sesiones', err);
      this.sessions = [];
    }
    this.publish();
  }

  /** Descarta una sesión a mano. */
  async discard(id: string): Promise<void> {
    if (!this.storage) return;
    await this.storage.remove(id).catch((err) => console.warn('Autoguardado: no se pudo descartar', err));
    if (id === this.sessionId) {
      // La sesión actual sigue: su próximo guardado la vuelve a crear.
      this.autoRef = null;
      this.autoSavedAt = null;
    }
    await this.prune();
  }

  /**
   * Recupera una sesión (punto 6). Antes de abrir mira la versión: una de una app más nueva se avisa y se conserva sin
   * tocar el worker. Abre el texto con el worker; si no abre y es v7, intenta la recuperación con aviso. Solo un error
   * del contenido (no es JSON, no es un proyecto, v7 dañado sin nada recuperable, datos ausentes) borra la sesión; un
   * error de infraestructura (worker ocupado o caído, tiempo agotado, base que no responde) avisa y la conserva
   * (punto 7). Devuelve si se recuperó.
   */
  async restore(id: string): Promise<boolean> {
    if (!this.storage || this.restoring) return false;
    const notify = (n: AutosaveNotice) => this.deps.notify?.(n);
    const meta = this.sessions.find((s) => s.id === id);
    const name = meta?.projectName || 'la sesión';
    const keep = (detail: string) => {
      notify({ title: 'No se pudo recuperar la sesión', description: `${name}: ${detail} La sesión se conserva: probá de nuevo en un momento.`, tone: 'error' });
      return false;
    };
    const drop = async (detail: string) => {
      notify({ title: 'No se pudo recuperar la sesión', description: `${name}: ${detail} Se descarta.`, tone: 'error' });
      await this.discard(id);
      return false;
    };
    const newer = (version: number) => {
      notify({ title: 'La sesión es de una versión más nueva de la app', description: `${name} (formato v${version}): actualizá la app para seguir. La sesión se conserva (podés descartarla).`, tone: 'warn' });
      return false;
    };
    this.restoring = true;
    // El worker del autoguardado hace una tarea a la vez: se espera la escritura en curso y no se empieza otra.
    this.cancelTimer();
    this.publish();
    try {
      if (this.writing) await this.writing;
      if (meta?.fileVersion != null && meta.fileVersion > NEWEST_FILE_VERSION) return newer(meta.fileVersion);
      let text: string | null;
      try {
        text = await this.storage.read(id);
      } catch (err) {
        console.warn('Autoguardado: no se pudo leer la sesión', err);
        return keep('el navegador no devolvió los datos guardados.');
      }
      if (text === null) return await drop('no quedaron datos guardados.');
      const version = fileVersionOf(text);
      if (version !== null && version > NEWEST_FILE_VERSION) return newer(version);
      let project: Project | null = null;
      let warnings: string[] = [];
      let recovered = false;
      try {
        const r = await this.deps.files.run({ kind: 'open', text });
        if (r.kind !== 'open') throw new Error('Respuesta de apertura inválida.');
        project = r.project;
        warnings = r.warnings;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('Autoguardado: la sesión no abre', err);
        if (!isContentError(err)) return keep(message);
        // Respaldo: la versión no estaba en la cabecera ni en los metadatos, pero el lector la rechazó por nueva.
        if (/versión más nueva/i.test(message)) return newer(version ?? NaN);
        if (version === REVISION_PROJECT_VERSION) {
          try {
            const r = await this.deps.files.run({ kind: 'recover', text });
            if (r.kind !== 'recover') throw new Error('Respuesta de recuperación inválida.');
            if (r.project) {
              project = r.project;
              recovered = true;
              warnings = r.issues.map((i: ArchiveIssue) => `${i.where}: ${i.message}`);
            }
          } catch (e) {
            console.warn('Autoguardado: la recuperación falló', e);
            if (!isContentError(e)) return keep(e instanceof Error ? e.message : String(e));
          }
        }
        if (!project) return await drop(message);
      }
      // Continúa la misma sesión de trabajo. Lo recuperado parcialmente no es lo que está guardado: se reescribe.
      this.cancelTimer();
      this.sessionId = id;
      this.autoRef = recovered ? null : project;
      this.autoSavedAt = recovered ? null : meta ? Date.parse(meta.savedAt) : this.now();
      this.failures = 0;
      this.lastError = null;
      this.deps.applyRestored?.(project);
      if (recovered) notify({ title: 'Sesión recuperada en parte', description: `${warnings.length === 1 ? warnings[0] : `${warnings.length} partes no se pudieron leer`} (detalle en la consola).`, tone: 'warn' });
      else if (warnings.length) notify({ title: 'Avisos al recuperar la sesión', description: warnings.length === 1 ? warnings[0]! : `${warnings[0]} (y ${warnings.length - 1} más; detalle en la consola)`, tone: 'warn' });
      if (warnings.length) console.warn(warnings.join('\n'));
      return true;
    } finally {
      this.restoring = false;
      this.publish();
      // Si el proyecto no se reemplazó y quedó algo sin guardar (el temporizador se canceló al empezar), se programa.
      const current = this.deps.getProject();
      if (!this.disposed && this.storage && this.timer === null && current !== this.autoRef && worthSaving(current)) this.schedule(AUTOSAVE_DELAY_MS);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }
}
