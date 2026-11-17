/**
 * Autoguardado (docs/decisiones/0071): ciclo guardar → recuperar con almacenamiento en memoria, metadatos y textos
 * rotos, espera de 3 s, poda a 3 sesiones y cuándo el proyecto está a salvo (aviso al cerrar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import v7fixture from './fixtures/archive/v7.pozo.json?raw';
import { addWell, createProject, setParam, setZones, getWellEntry, type Project } from '../src/core/state/project';
import { createSnapshot } from '../src/core/state/snapshots';
import { addPointSet } from '../src/core/state/pointSets';
import { createPointSet } from '../src/core/pointSets';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createWell } from '../src/core/well';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { ProjectFileClient, type FileWorker } from '../src/app/projectFiles/client';
import { isContentError, ProjectFileContentError, runProjectFileTask, type ProjectFileResult, type ProjectFileTask } from '../src/app/projectFiles/task';
import { AUTOSAVE_DELAY_MS, AutosaveSession, fileVersionOf, MAX_SESSIONS, RETRY_DELAYS_MS, validateMeta, type AutosaveNotice } from '../src/app/autosave/session';
import { MemoryStorage, SESSION_SCHEMA, type SessionMeta } from '../src/app/autosave/storage';
import { DEFAULT_PROJECT_NAME, formatAgo, sessionTitle } from '../src/app/autosave/store';
import { zone } from './helpers';

const bits = (a: Float64Array) => Array.from(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

/** Pozo sintético con otro id: el de demostración no se autoguarda (docs/decisiones/0071, punto 4). */
function realWell(n = 400) {
  const demo = syntheticWell(n);
  return { well: { ...demo.well, id: 'pozo-1', name: 'Pozo 1' }, zones: demo.zones };
}

/** Proyecto con pozo, zonas, parámetros cambiados, un conjunto de puntos (presiones) y un snapshot. */
function richProject(): Project {
  const demo = realWell(400);
  let p = addWell(createProject('TP autoguardado'), demo.well, demo.zones);
  const id = demo.well.id;
  p = setZones(p, id, [...demo.zones.slice(0, 2), zone('extra', demo.zones[2]!.top, demo.zones[2]!.base)]);
  p = setParam(p, id, 'grClean', 22);
  p = setParam(p, id, 'grShale', 135, getWellEntry(p, id).interpretation.zones[0]!.id);
  const top = demo.well.depth.values[10]!;
  p = addPointSet(
    p,
    id,
    createPointSet({
      id: 'mdt1',
      kind: 'pressure',
      name: 'MDT 1',
      source: 'mdt.xlsx',
      depth: Float64Array.of(top, top + 5, top + 10),
      pointIds: ['a', 'b', 'c'],
      columns: { pressure: { label: 'P', unit: 'psi', values: Float64Array.of(3100, 3108, NaN) }, quality: { label: 'Q', values: ['Buena', 'Buena', 'Seca'] } },
    }),
  );
  p = createSnapshot(p, id, 'Caso base', { createdAt: '2026-11-17T00:00:00.000Z', id: 'snap-1' }).project;
  return p;
}

/**
 * La tarea del worker, en proceso. Guardar sin compresión: los streams de compresión avanzan con el reloj real y las
 * pruebas de la espera usan uno falso (el formato es el mismo y se lee igual).
 */
const files = (task: ProjectFileTask): Promise<ProjectFileResult> =>
  task.kind === 'save'
    ? serializeProject(task.project, { codec: 'f64le-b64' }).then((text) => ({ kind: 'save', text }))
    : runProjectFileTask(task).catch((err: Error) => {
        // Como el cliente real: lo que tira la tarea es un error del contenido.
        throw new ProjectFileContentError(err.message);
      });

/** Store mínimo del proyecto: la sesión escucha cambios por referencia, como `useProject.subscribe`. */
function harness(opts: { storage?: MemoryStorage | null; initial?: Project; dragging?: () => boolean; files?: (task: ProjectFileTask) => Promise<ProjectFileResult> } = {}) {
  let project = opts.initial ?? createProject();
  const storage = opts.storage === undefined ? new MemoryStorage() : opts.storage;
  const notices: AutosaveNotice[] = [];
  let ids = 0;
  const session = new AutosaveSession({
    storage,
    files: { run: opts.files ?? files },
    getProject: () => project,
    isDragging: opts.dragging,
    applyRestored: (p) => set(p),
    notify: (n) => notices.push(n),
    newId: () => `sesion-${++ids}`,
  });
  function set(p: Project) {
    if (p === project) return;
    project = p;
    session.projectChanged(p);
  }
  return { session, storage, notices, set, get: () => project };
}

/** Avanza el reloj falso y deja correr las promesas del guardado (serializar comprime con streams reales). */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(0);
}

async function settle(session: AutosaveSession) {
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
  await session.flush();
}

const meta = (id: string, savedAt: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({ schema: SESSION_SCHEMA, id, projectName: id, wells: ['W'], savedAt, size: 10, fileVersion: 6, ...extra });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-17T14:00:00.000Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('autoguardado: guardar y recuperar', () => {
  it('ciclo completo: zonas, parámetros, conjuntos de puntos, snapshots y curvas vuelven iguales', async () => {
    const a = harness();
    const p = richProject();
    a.set(p);
    await settle(a.session);
    expect(a.storage!.writes).toBe(1);
    const [m] = await a.session.refresh();
    expect(m).toMatchObject({ schema: 1, id: 'sesion-1', projectName: 'TP autoguardado', wells: [p.wells[0]!.well.name], savedAt: '2026-11-17T14:00:03.000Z' });
    expect(m!.size).toBe((a.storage!.texts.get('sesion-1') as string).length);

    // «Recargar»: otra sesión sobre la misma base, con el proyecto vacío del arranque.
    const b = harness({ storage: a.storage });
    const [offered] = await b.session.refresh();
    expect(offered!.id).toBe('sesion-1');
    expect(await b.session.restore('sesion-1')).toBe(true);
    const back = b.get();
    expect(back).not.toBe(p);
    expect(back.name).toBe(p.name);
    expect(back.snapshots).toEqual(p.snapshots);
    const [x, y] = [p.wells[0]!, back.wells[0]!];
    expect(y.interpretation.zones).toEqual(x.interpretation.zones);
    expect(y.interpretation.params).toEqual(x.interpretation.params);
    expect(y.interpretation.pointSets).toEqual(x.interpretation.pointSets);
    expect(y.well.pointSets.map((s) => s.id)).toEqual(['mdt1']);
    expect(bits(y.well.pointSets[0]!.depth)).toEqual(bits(x.well.pointSets[0]!.depth));
    expect(y.well.pointSets[0]!.columns).toEqual(x.well.pointSets[0]!.columns);
    expect(bits(y.well.depth.values)).toEqual(bits(x.well.depth.values));
    expect(y.well.curves.map((c) => c.id)).toEqual(x.well.curves.map((c) => c.id));
    for (let i = 0; i < x.well.curves.length; i++) expect(bits(y.well.curves[i]!.data)).toEqual(bits(x.well.curves[i]!.data));

    // Continúa la misma sesión: lo recuperado cuenta como guardado y el próximo cambio reemplaza esa copia.
    expect(b.session.snapshot()).toMatchObject({ status: 'saved', sessionId: 'sesion-1', autoSafe: true });
    expect(b.session.isProjectSafe()).toBe(true);
    b.set(setParam(back, back.wells[0]!.well.id, 'grClean', 30));
    await settle(b.session);
    expect([...b.storage!.metas.keys()]).toEqual(['sesion-1']);
    const again = await deserializeProject(b.storage!.texts.get('sesion-1') as string);
    expect(again.wells[0]!.interpretation.params).toMatchObject({ global: { grClean: 30 } });
  });

  it('no guarda un proyecto sin pozos', async () => {
    const a = harness();
    a.set(createProject('Vacío pero otro objeto'));
    await settle(a.session);
    expect(a.storage!.writes).toBe(0);
    expect(a.session.snapshot().status).toBe('empty');
  });

  it('abrir un archivo empieza otra sesión de trabajo y no pisa la anterior', async () => {
    const a = harness();
    a.set(richProject());
    await settle(a.session);
    const opened = richProject();
    a.session.openedFromFile(opened);
    a.set(opened);
    expect(a.session.snapshot()).toMatchObject({ status: 'saved', fileSafe: true, sessionId: 'sesion-2' });
    await settle(a.session);
    expect([...a.storage!.metas.keys()].sort()).toEqual(['sesion-1', 'sesion-2']);
  });
});

describe('autoguardado: datos rotos no tiran abajo la app', () => {
  it('metadatos rotos, de otro esquema o con clave inválida se ignoran y se borran al listar', async () => {
    const s = new MemoryStorage();
    s.metas.set('ok', meta('ok', '2026-11-17T10:00:00.000Z'));
    s.texts.set('ok', '{}');
    s.metas.set('roto', 'no es un objeto');
    s.texts.set('roto', 'basura');
    s.metas.set('futuro', { ...meta('futuro', '2026-11-17T11:00:00.000Z'), schema: 2 });
    s.metas.set('sinfecha', meta('sinfecha', 'ayer'));
    s.metas.set('otraclave', meta('distinta', '2026-11-17T11:00:00.000Z'));
    s.metas.set(42, meta('42', '2026-11-17T11:00:00.000Z'));
    s.metas.set('nulo', null);
    const a = harness({ storage: s });
    const list = await a.session.refresh();
    expect(list.map((m) => m.id)).toEqual(['ok']);
    expect([...s.metas.keys()]).toEqual(['ok']);
    expect([...s.texts.keys()]).toEqual(['ok']);
    expect(validateMeta({ key: 'x', value: [] })).toBeNull();
  });

  it('un texto que no es JSON avisa con un toast y se borra', async () => {
    const s = new MemoryStorage();
    s.metas.set('x', meta('x', '2026-11-17T10:00:00.000Z'));
    s.texts.set('x', 'esto no es JSON');
    const a = harness({ storage: s });
    await a.session.refresh();
    await expect(a.session.restore('x')).resolves.toBe(false);
    expect(a.notices).toEqual([expect.objectContaining({ tone: 'error', title: 'No se pudo recuperar la sesión' })]);
    expect(s.metas.size).toBe(0);
    expect(a.get().wells).toHaveLength(0);
  });

  it('una sesión sin datos (solo el metadato) avisa y se borra', async () => {
    const s = new MemoryStorage();
    s.metas.set('x', meta('x', '2026-11-17T10:00:00.000Z'));
    const a = harness({ storage: s });
    await a.session.refresh();
    expect(await a.session.restore('x')).toBe(false);
    expect(a.notices[0]!.tone).toBe('error');
    expect(s.metas.size).toBe(0);
  });

  it('un proyecto de una versión más nueva de la app avisa y se conserva', async () => {
    const s = new MemoryStorage();
    s.metas.set('x', meta('x', '2026-11-17T10:00:00.000Z', { fileVersion: 99 }));
    s.texts.set('x', JSON.stringify({ format: 'pozo-proyecto', version: 99, savedAt: '2026-11-17T10:00:00.000Z', project: { wells: [] } }));
    const a = harness({ storage: s });
    await a.session.refresh();
    expect(await a.session.restore('x')).toBe(false);
    expect(a.notices).toEqual([expect.objectContaining({ tone: 'warn', title: 'La sesión es de una versión más nueva de la app' })]);
    expect([...s.metas.keys()]).toEqual(['x']);
    // Se puede descartar a mano.
    await a.session.discard('x');
    expect(s.metas.size).toBe(0);
    expect(s.texts.size).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])('un autoguardado de formato v%i se migra como un archivo viejo', async (version) => {
    const demo = realWell(200);
    const p = addWell(createProject('Viejo'), demo.well, demo.zones);
    const file = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    file.version = version;
    if (version < 3) delete file.project.display;
    for (const w of file.project.wells) {
      if (version < 2) delete w.progress;
      if (version < 4) delete w.interpretation.trends;
      if (version < 5) {
        delete w.interpretation.pointSets;
        delete w.well.pointSets;
      }
    }
    const s = new MemoryStorage();
    s.metas.set('v', meta('v', '2026-11-17T10:00:00.000Z', { fileVersion: version }));
    s.texts.set('v', JSON.stringify(file));
    const a = harness({ storage: s });
    await a.session.refresh();
    expect(await a.session.restore('v')).toBe(true);
    expect(a.get().wells[0]!.interpretation.zones).toEqual(p.wells[0]!.interpretation.zones);
    expect(a.notices.filter((n) => n.tone === 'error')).toEqual([]);
  });

  it('un v7 dañado que no abre entero se recupera en parte, con aviso, y se vuelve a guardar', async () => {
    let p = await deserializeProject(v7fixture);
    const other = structuredClone(getWellEntry(p, 'w').well);
    other.id = 'other';
    p = addWell(p, createWell({ ...other, depth: other.depth.values }));
    const raw = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    const child = Object.keys(raw.project.inputRevisions).find((k) => raw.project.inputRevisions[k].well?.curves?.length && raw.project.inputRevisions[k].parentRevisionId);
    raw.project.inputRevisions[child!].well.curves[0].data = { blobId: 'missing' };
    const s = new MemoryStorage();
    s.metas.set('v7', meta('v7', '2026-11-17T10:00:00.000Z', { fileVersion: 7 }));
    s.texts.set('v7', JSON.stringify(raw));
    const a = harness({ storage: s });
    await a.session.refresh();
    expect(await a.session.restore('v7')).toBe(true);
    expect(a.get().wells.map((e) => e.well.id)).toEqual(['other']);
    expect(a.notices).toEqual([expect.objectContaining({ tone: 'warn', title: 'Sesión recuperada en parte' })]);
    // Lo recuperado no es lo que está guardado: no cuenta como a salvo hasta reescribirse.
    expect(a.session.isProjectSafe()).toBe(false);
    await settle(a.session);
    expect(a.session.isProjectSafe()).toBe(true);
    await expect(deserializeProject(s.texts.get('v7') as string)).resolves.toBeTruthy();
  });

  it('un fallo del almacenamiento al listar no tira', async () => {
    const s = new MemoryStorage();
    s.list = () => Promise.reject(new Error('IndexedDB cerrada'));
    const a = harness({ storage: s });
    await expect(a.session.refresh()).resolves.toEqual([]);
  });
});

describe('autoguardado: cuándo se guarda', () => {
  it('espera 3 s desde el último cambio (cada cambio reinicia la espera)', async () => {
    const a = harness();
    const p = richProject();
    const id = p.wells[0]!.well.id;
    a.set(p);
    await advance(2000);
    a.set(setParam(a.get(), id, 'grClean', 23));
    await advance(2000);
    a.set(setParam(a.get(), id, 'grClean', 24));
    await advance(2900);
    expect(a.storage!.writes).toBe(0);
    expect(a.session.snapshot().status).toBe('dirty');
    await advance(200);
    expect(a.storage!.writes).toBe(1);
    expect(a.session.snapshot().status).toBe('saved');
  });

  it('espera a que termine un arrastre en el visor', async () => {
    let dragging = true;
    const a = harness({ dragging: () => dragging });
    a.set(richProject());
    await advance(AUTOSAVE_DELAY_MS + 2000);
    expect(a.storage!.writes).toBe(0);
    dragging = false;
    await advance(1000);
    expect(a.storage!.writes).toBe(1);
  });

  it('si el proyecto cambia mientras se serializa, programa otra vuelta', async () => {
    const a = harness();
    const p = richProject();
    a.set(p);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    // El guardado empezó (serializando): llega un cambio.
    const changed = setParam(p, p.wells[0]!.well.id, 'grClean', 40);
    a.set(changed);
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(a.storage!.writes).toBe(2);
    expect(a.session.isProjectSafe()).toBe(true);
    const saved = await deserializeProject(a.storage!.texts.get('sesion-1') as string);
    expect(saved.wells[0]!.interpretation.params).toMatchObject({ global: { grClean: 40 } });
  });

  it(`conserva solo las ${MAX_SESSIONS} sesiones más recientes`, async () => {
    const s = new MemoryStorage();
    s.metas.set('vieja', meta('vieja', '2026-11-10T10:00:00.000Z'));
    s.texts.set('vieja', '{}');
    s.metas.set('media', meta('media', '2026-11-12T10:00:00.000Z'));
    s.texts.set('media', '{}');
    s.metas.set('reciente', meta('reciente', '2026-11-16T10:00:00.000Z'));
    s.texts.set('reciente', '{}');
    const a = harness({ storage: s });
    a.set(richProject());
    await settle(a.session);
    const list = await a.session.refresh();
    expect(list.map((m) => m.id)).toEqual(['sesion-1', 'reciente', 'media']);
    expect([...s.metas.keys()].sort()).toEqual(['media', 'reciente', 'sesion-1']);
    expect(s.texts.has('vieja')).toBe(false);
  });
});

describe('autoguardado: proyecto a salvo (aviso al cerrar)', () => {
  it('sin pozos está a salvo', () => {
    const a = harness();
    expect(a.session.isProjectSafe()).toBe(true);
    a.set(createProject('Otro vacío'));
    expect(a.session.isProjectSafe()).toBe(true);
  });

  it('recién autoguardado está a salvo; un cambio pendiente no; deshacer hasta lo guardado vuelve a estarlo', async () => {
    const a = harness();
    const p = richProject();
    a.set(p);
    expect(a.session.isProjectSafe()).toBe(false);
    await settle(a.session);
    expect(a.session.isProjectSafe()).toBe(true);
    const changed = setParam(p, p.wells[0]!.well.id, 'grClean', 50);
    a.set(changed);
    expect(a.session.isProjectSafe()).toBe(false);
    expect(a.session.snapshot().status).toBe('dirty');
    // Deshacer devuelve el mismo objeto guardado (store inmutable).
    a.set(p);
    expect(a.session.isProjectSafe()).toBe(true);
    expect(a.session.snapshot().status).toBe('saved');
  });

  it('recién guardado a archivo está a salvo aunque no haya autoguardado (navegador sin IndexedDB)', () => {
    const a = harness({ storage: null });
    a.session.storageUnavailable();
    const p = richProject();
    a.set(p);
    expect(a.session.isProjectSafe()).toBe(false);
    expect(a.session.snapshot().status).toBe('unavailable');
    a.session.savedToFile(p);
    expect(a.session.isProjectSafe()).toBe(true);
    expect(a.session.snapshot()).toMatchObject({ status: 'unavailable', fileSafe: true });
    a.set(setParam(p, p.wells[0]!.well.id, 'grClean', 50));
    expect(a.session.isProjectSafe()).toBe(false);
  });

  it('el proyecto del arranque (demostración de `?inicio=no`) no pide confirmación', () => {
    const demo = syntheticWell(100);
    const a = harness({ initial: addWell(createProject('Demostración'), demo.well, demo.zones) });
    expect(a.session.isProjectSafe()).toBe(true);
  });
});

describe('formatAgo', () => {
  const t = Date.parse('2026-11-17T14:00:00.000Z');
  it('textos cortos en español', () => {
    expect(formatAgo(t, t + 2000)).toBe('recién');
    expect(formatAgo(t, t + 12_000)).toBe('hace 12 s');
    expect(formatAgo(t, t + 3 * 60_000)).toBe('hace 3 min');
    expect(formatAgo(t, t + 2 * 3_600_000)).toBe('hace 2 h');
    expect(formatAgo(t, t + 26 * 3_600_000)).toBe('ayer');
    expect(formatAgo(t, t + 4 * 86_400_000)).toBe('hace 4 días');
  });
});

describe('worker de archivos: tarea recover', () => {
  it('el cliente valida la respuesta y congela los metadatos del proyecto recuperado', async () => {
    vi.useRealTimers();
    let sent: ProjectFileTask | null = null;
    const port: FileWorker & { reply(d: unknown): void } = {
      onmessage: null,
      onerror: null,
      postMessage(t) { sent = structuredClone(t); },
      terminate() {},
      reply(d) { this.onmessage?.({ data: structuredClone(d) as never }); },
    };
    const client = new ProjectFileClient(() => port);
    const ok = client.run({ kind: 'recover', text: v7fixture });
    port.reply({ ok: true, result: await runProjectFileTask(sent!) });
    const r = await ok;
    if (r.kind !== 'recover') throw new Error('Tipo');
    expect(r.project).not.toBeNull();
    expect(Object.isFrozen(r.project!.inputRevisions)).toBe(true);
    const bad = client.run({ kind: 'recover', text: v7fixture });
    port.reply({ ok: true, result: { kind: 'recover', project: null, issues: [{ where: 1 }] } });
    await expect(bad).rejects.toThrow(/recuperación inválida/);
  });
});

/** Promesa que se resuelve a mano. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Como `ProjectFileClient`: una tarea a la vez; la segunda tira un error de infraestructura. */
function exclusive(run: (task: ProjectFileTask) => Promise<ProjectFileResult>) {
  let busy = false;
  const tasks: ProjectFileTask['kind'][] = [];
  const fn = async (task: ProjectFileTask) => {
    tasks.push(task.kind);
    if (busy) throw new Error('Ya se está guardando o abriendo un proyecto. Esperá a que termine.');
    busy = true;
    try {
      return await run(task);
    } finally {
      busy = false;
    }
  };
  return Object.assign(fn, { tasks });
}

async function savedSession(id: string, project: Project, storage = new MemoryStorage()) {
  const text = await serializeProject(project, { codec: 'f64le-b64' });
  await storage.write(meta(id, '2026-11-17T10:00:00.000Z', { fileVersion: fileVersionOf(text) }), text);
  storage.writes = 0;
  return storage;
}

describe('autoguardado: revisión (escrituras lentas, fallos, infraestructura, demostración)', () => {
  it('con la serialización lenta, un cambio llegado mientras se escribe se guarda después: queda el último', async () => {
    const gates: { promise: Promise<void>; resolve: () => void }[] = [];
    const slow = async (task: ProjectFileTask) => {
      if (task.kind === 'save') {
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
      }
      return files(task);
    };
    const a = harness({ files: slow });
    const p1 = richProject();
    const id = p1.wells[0]!.well.id;
    a.set(p1);
    await advance(AUTOSAVE_DELAY_MS);
    expect(gates).toHaveLength(1);
    expect(a.session.snapshot().status).toBe('saving');
    const p2 = setParam(p1, id, 'grClean', 41);
    a.set(p2);
    gates[0]!.resolve();
    await advance(0);
    expect(a.storage!.writes).toBe(1);
    expect(a.session.isProjectSafe()).toBe(false);
    await advance(AUTOSAVE_DELAY_MS);
    expect(gates).toHaveLength(2);
    gates[1]!.resolve();
    await advance(0);
    expect(a.storage!.writes).toBe(2);
    expect(a.session.isProjectSafe()).toBe(true);
    const saved = await deserializeProject(a.storage!.texts.get('sesion-1') as string);
    expect(saved.wells[0]!.interpretation.params).toMatchObject({ global: { grClean: 41 } });
  });

  it('si la escritura falla: estado de error, un solo aviso, reintentos a 3, 15 y 60 s y pausa hasta el próximo cambio', async () => {
    const s = new MemoryStorage();
    const realWrite = s.write.bind(s);
    let attempts = 0;
    let failing = true;
    s.write = async (m, t) => {
      attempts++;
      if (failing) throw Object.assign(new Error('cupo'), { name: 'QuotaExceededError' });
      return realWrite(m, t);
    };
    const a = harness({ storage: s });
    const p = richProject();
    a.set(p);
    await advance(AUTOSAVE_DELAY_MS);
    expect(attempts).toBe(1);
    expect(a.session.snapshot()).toMatchObject({ status: 'error', error: 'El navegador no tiene más espacio para el autoguardado.' });
    expect(a.notices).toEqual([expect.objectContaining({ tone: 'error', title: 'No se pudo autoguardar' })]);
    await advance(RETRY_DELAYS_MS[0]);
    expect(attempts).toBe(2);
    await advance(RETRY_DELAYS_MS[1] - 1);
    expect(attempts).toBe(2);
    await advance(1);
    expect(attempts).toBe(3);
    await advance(RETRY_DELAYS_MS[2]);
    expect(attempts).toBe(4);
    await advance(10 * 60_000);
    expect(attempts).toBe(4);
    expect(a.notices).toHaveLength(1);
    expect(a.session.isProjectSafe()).toBe(false);
    // El próximo cambio vuelve a intentar; si sale bien, termina la racha.
    failing = false;
    a.set(setParam(p, p.wells[0]!.well.id, 'grClean', 33));
    await advance(AUTOSAVE_DELAY_MS);
    expect(attempts).toBe(5);
    expect(a.session.snapshot()).toMatchObject({ status: 'saved', error: null });
  });

  it('recuperar con una escritura en curso espera a que termine: no descarta la sesión y la recupera', async () => {
    const storage = await savedSession('vieja', richProject());
    const gate = deferred();
    const run = exclusive(async (task) => {
      if (task.kind === 'save') await gate.promise;
      return files(task);
    });
    const a = harness({ storage, files: run });
    await a.session.refresh();
    const other = addWell(createProject('Otra'), { ...syntheticWell(100).well, id: 'pozo-2', name: 'Pozo 2' });
    a.set(other);
    await advance(AUTOSAVE_DELAY_MS);
    expect(run.tasks).toEqual(['save']);
    const restoring = a.session.restore('vieja');
    await advance(0);
    gate.resolve();
    await expect(restoring).resolves.toBe(true);
    expect(run.tasks).toEqual(['save', 'open']);
    expect(a.notices.filter((n) => n.tone === 'error')).toEqual([]);
    expect(storage.metas.has('vieja')).toBe(true);
    expect(a.get().wells[0]!.well.id).toBe('pozo-1');
    expect(a.session.snapshot().sessionId).toBe('vieja');
  });

  it.each([
    ['el worker tarda demasiado', new Error('La operación de archivo tardó demasiado; el proyecto activo no se modificó.')],
    ['el worker no responde bien', new Error('Respuesta de archivo inválida.')],
  ])('un error de infraestructura al abrir (%s) avisa y conserva la sesión', async (_, error) => {
    const storage = await savedSession('s', richProject());
    const a = harness({ storage, files: async (t) => (t.kind === 'open' ? Promise.reject(error) : files(t)) });
    await a.session.refresh();
    expect(await a.session.restore('s')).toBe(false);
    expect(a.notices).toEqual([expect.objectContaining({ tone: 'error', title: 'No se pudo recuperar la sesión' })]);
    expect(a.notices[0]!.description).toMatch(/se conserva/);
    expect(storage.metas.has('s')).toBe(true);
  });

  it('un fallo al leer la base avisa y conserva la sesión', async () => {
    const storage = await savedSession('s', richProject());
    storage.read = () => Promise.reject(new Error('base cerrada'));
    const a = harness({ storage });
    await a.session.refresh();
    expect(await a.session.restore('s')).toBe(false);
    expect(storage.metas.has('s')).toBe(true);
  });

  it('una versión más nueva se detecta antes de abrir (metadatos o cabecera) y no llama al worker', async () => {
    const s = new MemoryStorage();
    const text = JSON.stringify({ format: 'pozo-proyecto', version: 99, savedAt: '2026-11-17T10:00:00.000Z', project: { name: 'Futuro' } });
    s.metas.set('meta', meta('meta', '2026-11-17T10:00:00.000Z', { fileVersion: 99 }));
    s.texts.set('meta', text);
    s.metas.set('cabecera', meta('cabecera', '2026-11-17T09:00:00.000Z', { fileVersion: null }));
    s.texts.set('cabecera', text);
    const run = exclusive(files);
    const a = harness({ storage: s, files: run });
    await a.session.refresh();
    expect(await a.session.restore('meta')).toBe(false);
    expect(await a.session.restore('cabecera')).toBe(false);
    expect(run.tasks).toEqual([]);
    expect(a.notices.map((n) => n.tone)).toEqual(['warn', 'warn']);
    expect([...s.metas.keys()].sort()).toEqual(['cabecera', 'meta']);
  });

  it('un proyecto solo con el pozo de demostración no se guarda ni pide confirmación; con otro pozo, sí', async () => {
    const demo = syntheticWell(200);
    const a = harness();
    const p = addWell(createProject(), demo.well, demo.zones);
    a.set(p);
    const changed = setParam(p, demo.well.id, 'grClean', 12);
    a.set(changed);
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(a.storage!.writes).toBe(0);
    expect(a.session.isProjectSafe()).toBe(true);
    expect(a.session.snapshot().status).toBe('demo');
    const real = realWell(100);
    a.set(addWell(changed, real.well, real.zones));
    expect(a.session.isProjectSafe()).toBe(false);
    await advance(AUTOSAVE_DELAY_MS);
    expect(a.storage!.writes).toBe(1);
  });
});

describe('fileVersionOf', () => {
  it('lee la cabecera, el JSON con otro orden de claves y devuelve null si no es un proyecto', () => {
    expect(fileVersionOf('{"format":"pozo-proyecto","version":7,"savedAt":"x"}')).toBe(7);
    expect(fileVersionOf('{\n  "format": "pozo-proyecto",\n  "version": 6,\n  "x": 1}')).toBe(6);
    const late = JSON.stringify({ savedAt: 'x'.repeat(1000), project: {}, format: 'pozo-proyecto', version: 12 });
    expect(fileVersionOf(late)).toBe(12);
    expect(fileVersionOf('no es JSON')).toBeNull();
    expect(fileVersionOf('{"format":"otro","version":3}')).toBeNull();
  });
});

describe('worker de archivos: errores de contenido e infraestructura', () => {
  it('lo que tira la tarea es de contenido; worker ocupado, tiempo agotado o respuesta rara, de infraestructura', async () => {
    vi.useRealTimers();
    const inProcess = new ProjectFileClient(() => null);
    const content = await inProcess.run({ kind: 'open', text: 'no es JSON' }).catch((e) => e);
    expect(isContentError(content)).toBe(true);
    const port: FileWorker & { reply(d: unknown): void } = {
      onmessage: null,
      onerror: null,
      postMessage() {},
      terminate() {},
      reply(d) { this.onmessage?.({ data: d as never }); },
    };
    const client = new ProjectFileClient(() => port, 50);
    const first = client.run({ kind: 'open', text: '{}' });
    const busy = await client.run({ kind: 'open', text: '{}' }).catch((e) => e);
    expect(isContentError(busy)).toBe(false);
    port.reply({ ok: false, error: 'El archivo no es un proyecto de esta app.' });
    expect(isContentError(await first.catch((e) => e))).toBe(true);
    const workerBusy = client.run({ kind: 'open', text: '{}' });
    port.reply({ ok: false, error: 'Ya se está procesando un archivo.', infra: true });
    expect(isContentError(await workerBusy.catch((e) => e))).toBe(false);
    const odd = client.run({ kind: 'open', text: '{}' });
    port.reply({ ok: true, result: { kind: 'save', text: '' } });
    expect(isContentError(await odd.catch((e) => e))).toBe(false);
    const slow = await client.run({ kind: 'open', text: '{}' }).catch((e) => e);
    expect(isContentError(slow)).toBe(false);
  });
});

describe('sessionTitle', () => {
  it('con el nombre por defecto, el título son los pozos y el detalle no los repite', () => {
    expect(DEFAULT_PROJECT_NAME).toBe(createProject().name);
    expect(sessionTitle({ projectName: 'Proyecto sin nombre', wells: ['Pozo TP'] })).toEqual({ title: 'Pozo TP', wells: null });
    expect(sessionTitle({ projectName: 'Proyecto sin nombre', wells: ['Pozo TP', 'Demo'] })).toEqual({ title: 'Pozo TP y 1 más', wells: null });
    expect(sessionTitle({ projectName: '  ', wells: ['A', 'B', 'C'] })).toEqual({ title: 'A y 2 más', wells: null });
    expect(sessionTitle({ projectName: 'Proyecto sin nombre', wells: [] })).toEqual({ title: 'Proyecto sin nombre', wells: null });
  });
  it('con nombre propio, queda el nombre y los pozos van al detalle', () => {
    expect(sessionTitle({ projectName: 'TP final', wells: ['Pozo TP'] })).toEqual({ title: 'TP final', wells: 'Pozo TP' });
    expect(sessionTitle({ projectName: 'TP final', wells: ['A', 'B'] })).toEqual({ title: 'TP final', wells: 'A y 1 más' });
    expect(sessionTitle({ projectName: 'TP final', wells: [] })).toEqual({ title: 'TP final', wells: 'sin pozos' });
  });
});
