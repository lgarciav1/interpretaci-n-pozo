/**
 * Snapshots con nombre del estado de interpretación y comparación entre dos estados.
 * Un snapshot guarda la interpretación completa de un pozo (zonas, parámetros, fuentes elegidas, comparaciones,
 * módulos desactivados, sarta de perfilaje). En modo legado no conserva datos históricos; en el modo optativo
 * de revisiones fija inputRevisionId. Los resultados siempre se recalculan.
 */
import { sourceRefEquals, type Interpretation, type SourceRef } from '../interpretation';
import type { ParamValue } from '../params';
import type { Registry } from '../registry';
import { toolStringOf, type ToolStringMode } from '../toolString';
import type { Zone } from '../well';
import { getWellEntry, makeId, updateInterpretation, type Project, type Snapshot } from './project';
import { projectInputState, resolveSnapshotInputs } from './inputRevisions';

function cloneInterpretation(i: Interpretation): Interpretation {
  return structuredClone(i);
}

export function createSnapshot(
  project: Project,
  wellId: string,
  name: string,
  opts: { id?: string; createdAt?: string } = {},
): { project: Project; snapshot: Snapshot } {
  const entry = getWellEntry(project, wellId);
  const inputs = projectInputState(project);
  const snapshot: Snapshot = {
    id: opts.id ?? makeId('snap'),
    name: name.trim() || `Snapshot ${project.snapshots.length + 1}`,
    wellId,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    interpretation: cloneInterpretation(entry.interpretation),
    ...(inputs ? { inputRevisionId: entry.inputRevisionId!, inputBinding: 'pinned' as const } : {}),
  };
  if (inputs && project.snapshots.some((s) => s.id === snapshot.id)) throw new Error('El id del snapshot ya existe.');
  return { project: { ...project, snapshots: [...project.snapshots, snapshot] }, snapshot };
}

export function listSnapshots(project: Project, wellId?: string): Snapshot[] {
  return project.snapshots.filter((s) => wellId === undefined || s.wellId === wellId);
}

/** Restaura interpretación y, si está fijada, su revisión de entradas; conserva progreso/display y snapshots. */
export function restoreSnapshot(project: Project, snapshotId: string): Project {
  const snap = project.snapshots.find((s) => s.id === snapshotId);
  if (!snap) throw new Error(`No existe el snapshot '${snapshotId}'.`);
  const inputs = resolveSnapshotInputs(project, snap);
  if (inputs.inputRevisionId !== null) {
    const wells = project.wells.map((e) => e.well.id === snap.wellId ? { ...e, well: inputs.well, inputRevisionId: inputs.inputRevisionId!, interpretation: cloneInterpretation(snap.interpretation) } : e);
    return { ...project, wells };
  }
  return updateInterpretation(project, snap.wellId, () => cloneInterpretation(snap.interpretation));
}

export function deleteSnapshot(project: Project, snapshotId: string): Project {
  return { ...project, snapshots: project.snapshots.filter((s) => s.id !== snapshotId) };
}

export function renameSnapshot(project: Project, snapshotId: string, name: string): Project {
  return { ...project, snapshots: project.snapshots.map((s) => (s.id === snapshotId ? { ...s, name } : s)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Diferencias

export type DiffEntry =
  | { kind: 'preparation' }
  | { kind: 'param'; key: string; zoneId: string | null; before: ParamValue | undefined; after: ParamValue | undefined }
  | { kind: 'source'; port: string; before: SourceRef | undefined; after: SourceRef | undefined }
  | { kind: 'zone'; zoneId: string; change: 'added' | 'removed' | 'modified'; fields: (keyof Zone)[]; before?: Zone; after?: Zone }
  | { kind: 'compare' | 'disabled'; moduleId: string; change: 'added' | 'removed' }
  /** Sarta (0032): modo, herramienta apagada (added = se apagó) o agregada/quitada de la sarta planificada. */
  | { kind: 'tool-mode'; before: ToolStringMode; after: ToolStringMode }
  | { kind: 'tool-off' | 'tool-plan' | 'tool-plan-off'; toolId: string; change: 'added' | 'removed' };

/**
 * Diferencias de `a` a `b`. Si se pasa el registro, los parámetros se comparan por valor efectivo
 * (un valor explícito igual al default no cuenta como cambio).
 */
export function diffInterpretations(a: Interpretation, b: Interpretation, registry?: Registry): DiffEntry[] {
  const out: DiffEntry[] = [];
  if (JSON.stringify(a.preparation ?? null) !== JSON.stringify(b.preparation ?? null)) out.push({ kind: 'preparation' });
  const defaultOf = (key: string): ParamValue | undefined => registry?.paramSpecs.get(key)?.spec.default;

  // Parámetros globales
  const globalKeys = new Set([...Object.keys(a.params.global), ...Object.keys(b.params.global)]);
  for (const key of [...globalKeys].sort()) {
    const before = a.params.global[key] ?? defaultOf(key);
    const after = b.params.global[key] ?? defaultOf(key);
    if (before !== after) out.push({ kind: 'param', key, zoneId: null, before, after });
  }
  // Overrides por zona: se comparan los valores efectivos en cada zona presente en ambos estados.
  const zoneIds = new Set([...Object.keys(a.params.zones), ...Object.keys(b.params.zones)]);
  for (const zoneId of [...zoneIds].sort()) {
    const za = a.params.zones[zoneId] ?? {};
    const zb = b.params.zones[zoneId] ?? {};
    for (const key of [...new Set([...Object.keys(za), ...Object.keys(zb)])].sort()) {
      const before = za[key] ?? a.params.global[key] ?? defaultOf(key);
      const after = zb[key] ?? b.params.global[key] ?? defaultOf(key);
      if (before !== after) out.push({ kind: 'param', key, zoneId, before, after });
    }
  }
  // Fuentes elegidas (métodos)
  const ports = new Set([...Object.keys(a.sources), ...Object.keys(b.sources)]);
  for (const port of [...ports].sort()) {
    if (!sourceRefEquals(a.sources[port], b.sources[port])) {
      out.push({ kind: 'source', port, before: a.sources[port], after: b.sources[port] });
    }
  }
  // Zonas
  const zonesA = new Map(a.zones.map((z) => [z.id, z]));
  const zonesB = new Map(b.zones.map((z) => [z.id, z]));
  for (const [id, za] of zonesA) {
    const zb = zonesB.get(id);
    if (!zb) {
      out.push({ kind: 'zone', zoneId: id, change: 'removed', fields: [], before: za });
      continue;
    }
    const fields = (Object.keys({ ...za, ...zb }) as (keyof Zone)[]).filter((f) => za[f] !== zb[f]);
    if (fields.length) out.push({ kind: 'zone', zoneId: id, change: 'modified', fields, before: za, after: zb });
  }
  for (const [id, zb] of zonesB) if (!zonesA.has(id)) out.push({ kind: 'zone', zoneId: id, change: 'added', fields: [], after: zb });
  // Comparaciones y desactivados
  for (const kind of ['compare', 'disabled'] as const) {
    const sa = new Set(a[kind]);
    const sb = new Set(b[kind]);
    for (const id of sb) if (!sa.has(id)) out.push({ kind, moduleId: id, change: 'added' });
    for (const id of sa) if (!sb.has(id)) out.push({ kind, moduleId: id, change: 'removed' });
  }
  // Sarta de perfilaje (cambia qué curvas entran al cálculo)
  const ta = toolStringOf(a);
  const tb = toolStringOf(b);
  if (ta.mode !== tb.mode) out.push({ kind: 'tool-mode', before: ta.mode, after: tb.mode });
  const lists = [['tool-off', ta.off, tb.off], ['tool-plan', ta.plan, tb.plan], ['tool-plan-off', ta.planOff, tb.planOff]] as const;
  for (const [kind, la, lb] of lists) {
    for (const id of lb) if (!la.includes(id)) out.push({ kind, toolId: id, change: 'added' });
    for (const id of la) if (!lb.includes(id)) out.push({ kind, toolId: id, change: 'removed' });
  }
  return out;
}

/** Texto en español de una diferencia (para la interfaz). */
export function describeDiff(entry: DiffEntry, ctx: { registry?: Registry; zones?: readonly Zone[] } = {}): string {
  const zoneName = (id: string | null) => (id === null ? 'global' : ctx.zones?.find((z) => z.id === id)?.name ?? id);
  // Coma decimal, como el resto de la interfaz (sin depender de src/ui).
  const fmt = (v: unknown) => (v === undefined ? '—' : typeof v === 'number' ? String(+v.toPrecision(6)).replace('.', ',') : String(v));
  const src = (s: SourceRef | undefined) =>
    !s ? 'por defecto' : s.kind === 'curve' ? `curva ${s.curveId}` : ctx.registry?.get(s.moduleId)?.name ?? s.moduleId;
  switch (entry.kind) {
    case 'preparation': return 'Cambió la preparación de datos (exclusiones o restauraciones).';
    case 'param': {
      const label = ctx.registry?.paramSpecs.get(entry.key)?.spec.label ?? entry.key;
      return `${label} (${zoneName(entry.zoneId)}): ${fmt(entry.before)} → ${fmt(entry.after)}`;
    }
    case 'source':
      return `Fuente de ${entry.port}: ${src(entry.before)} → ${src(entry.after)}`;
    case 'zone': {
      const name = entry.after?.name ?? entry.before?.name ?? entry.zoneId;
      if (entry.change === 'added') return `Zona ${name} agregada`;
      if (entry.change === 'removed') return `Zona ${name} eliminada`;
      return `Zona ${name}: cambió ${entry.fields.join(', ')}`;
    }
    case 'compare':
      return `${entry.change === 'added' ? 'Se compara' : 'Se deja de comparar'} ${ctx.registry?.get(entry.moduleId)?.name ?? entry.moduleId}`;
    case 'disabled':
      return `${entry.change === 'added' ? 'Se desactiva' : 'Se activa'} ${ctx.registry?.get(entry.moduleId)?.name ?? entry.moduleId}`;
    case 'tool-mode':
      return `Sarta: modo ${entry.before === 'data' ? 'datos' : 'planificación'} → ${entry.after === 'data' ? 'datos' : 'planificación'}`;
    case 'tool-off':
      return `${entry.change === 'added' ? 'Se apaga' : 'Se prende'} ${ctx.registry?.tools.get(entry.toolId)?.name ?? entry.toolId} en la sarta`;
    case 'tool-plan-off':
      return `${entry.change === 'added' ? 'Se apaga' : 'Se prende'} ${ctx.registry?.tools.get(entry.toolId)?.name ?? entry.toolId} en la sarta planificada`;
    case 'tool-plan':
      return `${ctx.registry?.tools.get(entry.toolId)?.name ?? entry.toolId} ${entry.change === 'added' ? 'se agrega a' : 'se quita de'} la sarta planificada`;
  }
}

