/**
 * Motor de cálculo incremental. Sin dependencias de navegador ni de React: corre igual en un Web Worker,
 * en el hilo principal, en los tests y en Monte Carlo.
 *
 * Invalidación: cada módulo tiene una firma de entrada = parámetros resueltos + zonas (geometría, nombre y tipo) +
 * versión de cada entrada. Si la firma no cambió desde la corrida anterior, se reusa el resultado; si cambió, se recalcula y
 * sus salidas reciben una versión nueva, lo que cambia la firma de sus dependientes (y solo de ellos).
 */
import type { CurveProvenance } from './context';
import type { Interpretation, SourceRef } from '../interpretation';
import {
  describeInputGroup,
  portOf,
  unmetInputGroup,
  type AnyModule,
  type ComputeContext,
  type InputsSpec,
  type OutputValue,
  type ParamSegment,
  type PortKind,
  type ReadonlyCurve,
  type TableValue,
} from '../module';
import { resolveModuleParams, type ParamsSpec, type ParamValue, type ParamValues } from '../params';
import type { Registry } from '../registry';
import type { RoleId } from '../roles';
import { convertArray, getUnit, unitLabel, type UnitId } from '../units';
import { layoutZones, sampleThickness, zoneGeometryKey, type ZoneLayout, type ZoneSpan } from '../well';
import { feedsOnlyOptional, planGraph, type Diagnostic, type NodeReason, type Plan } from './graph';

/** Curva tal como la ve el motor (subconjunto de `Curve`). */
export interface EngineCurve {
  provenance?: CurveProvenance;
  id: string;
  mnemonic: string;
  role: RoleId | null;
  unit: UnitId;
  data: Float64Array;
}

/** Pozo tal como lo ve el motor (un `Well` cumple esta interfaz vía `toEngineWell`). */
export interface EngineWell {
  id: string;
  depth: Float64Array;
  curves: readonly EngineCurve[];
}

export interface OutputRecord {
  /** `${moduleId}:${port}` — único. */
  key: string;
  moduleId: string;
  port: string;
  kind: PortKind;
  /** true si alimenta la cadena (el módulo es la fuente elegida de ese puerto). */
  active: boolean;
  /** Cambia cada vez que el módulo se recalcula. */
  version: number;
  label: string;
  unit?: UnitId;
  /** Tabla marcada `hidden` en su declaración: no se lista en el panel genérico de Resultados. */
  hidden?: true;
  value: OutputValue;
}

export type NodeRunStatus = 'ok' | 'error' | 'missing-input' | 'cycle' | 'blocked';

export interface NodeReport {
  moduleId: string;
  reason: NodeReason;
  status: NodeRunStatus;
  /** true si se recalculó en esta corrida (false = reusado de caché o no corrió). */
  computed: boolean;
  ms: number;
  /**
   * Solo nodos `ok` (también los reusados de caché): la fuente que recibió cada entrada en ESTA corrida, por clave
   * local, después de soltar las opcionales cuyo módulo falló (`null` = ausente). Es lo usado, no lo planeado (0074).
   */
  inputs?: Record<string, SourceRef | null>;
  /** Solo nodos `ok`: los parámetros resueltos que recibió `compute` (globales y efectivos por zona, clave local). */
  params?: NodeParams;
}

/** Parámetros resueltos de un nodo (lo que vio `compute`): globales y efectivos por zona (globales + overrides). */
export interface NodeParams {
  global: Record<string, ParamValue>;
  byZone: Record<string, Record<string, ParamValue>>;
}

/** Tramo de muestras [start, end) y su zona (null = fuera de las zonas: parámetros globales). */
export interface RunSegment {
  start: number;
  end: number;
  zoneId: string | null;
}

export interface EngineRunResult {
  outputs: OutputRecord[];
  nodes: NodeReport[];
  diagnostics: Diagnostic[];
  /** Fuente elegida por puerto. */
  sources: Record<string, SourceRef>;
  /** Fuentes disponibles por puerto (para el selector de método). */
  candidates: Record<string, SourceRef[]>;
  /** Tramos de zonas que vio el motor (`layoutZones`): qué zona, y qué parámetros, aplicaron a cada muestra (0074). */
  segments: RunSegment[];
  stats: { recomputed: string[]; reused: string[]; ms: number; samples: number };
}

interface NodeCache {
  stamp: string;
  version: number;
  ok: boolean;
  outputs: Map<string, OutputValue>;
  /** Advertencias emitidas por compute, con su zona o profundidad (se re-emiten mientras el resultado siga en caché). */
  warnings: CachedWarning[];
}

interface CachedWarning {
  message: string;
  zoneId?: string;
  depth?: number;
}

/** Diagnóstico `module-warning` de un aviso emitido por `ctx.warn` (copia la zona y la profundidad, 0072). */
function warningDiagnostic(moduleId: string, moduleName: string, w: CachedWarning): Diagnostic {
  return {
    level: 'warning',
    code: 'module-warning',
    moduleId,
    message: `${moduleName}: ${w.message}`,
    ...(w.zoneId !== undefined ? { zoneId: w.zoneId } : {}),
    ...(w.depth !== undefined ? { depth: w.depth } : {}),
  };
}

interface ConvertedCurve {
  source: Float64Array;
  from: UnitId;
  to: UnitId;
  data: Float64Array;
}

export function toEngineWell(well: { id: string; depth: { values: Float64Array }; curves: readonly EngineCurve[] }): EngineWell {
  return { id: well.id, depth: well.depth.values, curves: well.curves };
}

export interface EngineOptions {
  /** Optional task scope: resolve the complete production graph, but execute only these modules and
   * their exact transitive dependencies. Does not change source selection or the interpretation.
   * Omitted means the complete chain (normal application engine).
   */
  targetModuleIds?: readonly string[];
  /**
   * Verifica en cada cálculo que el módulo no haya modificado sus entradas (curvas, profundidad, espesor):
   * las hashea antes y después de `compute` y lanza `InputMutationError` si cambiaron. Cuesta una pasada por
   * entrada; se activa en los tests y en desarrollo.
   */
  checkInputs?: boolean;
}

/** Un módulo escribió en una entrada de solo lectura (la caché del motor quedó corrupta). */
export class InputMutationError extends Error {
  constructor(
    readonly moduleId: string,
    readonly inputs: string[],
    moduleName: string,
  ) {
    super(
      `El módulo '${moduleName}' (${moduleId}) modificó ${inputs.length > 1 ? 'sus entradas' : 'su entrada'} ${inputs.map((i) => `'${i}'`).join(', ')}. ` +
        'Las entradas son de solo lectura: copiá con slice() antes de modificar.',
    );
    this.name = 'InputMutationError';
  }
}

export class Engine {
  private well: EngineWell | null = null;
  private thickness: Float64Array = new Float64Array(0);
  private layout: { key: string; value: ZoneLayout } | null = null;
  private readonly cache = new Map<string, NodeCache>();
  private readonly converted = new Map<string, ConvertedCurve>();
  private readonly revs = new WeakMap<Float64Array, number>();
  private nextRev = 1;
  private nextVersion = 1;

  constructor(
    readonly registry: Registry,
    private readonly options: EngineOptions = {},
  ) {}

  /** Carga un pozo nuevo y descarta toda la caché. */
  setWell(well: EngineWell): void {
    for (const c of well.curves) {
      if (c.data.length !== well.depth.length) {
        throw new Error(`La curva '${c.id}' tiene ${c.data.length} muestras y la profundidad ${well.depth.length}.`);
      }
    }
    this.well = well;
    this.thickness = sampleThickness(well.depth);
    this.layout = null;
    this.cache.clear();
    this.converted.clear();
  }

  /**
   * Reemplaza la lista de curvas manteniendo la profundidad y la caché: las firmas detectan qué cambió
   * (rol, unidad o array de datos nuevo).
   */
  updateCurves(curves: readonly EngineCurve[]): void {
    if (!this.well) throw new Error('No hay pozo cargado en el motor.');
    this.setWellPreservingCache({ ...this.well, curves });
  }

  private setWellPreservingCache(well: EngineWell): void {
    for (const c of well.curves) {
      if (c.data.length !== well.depth.length) throw new Error(`La curva '${c.id}' no está alineada con la profundidad.`);
    }
    this.well = well;
  }

  get hasWell(): boolean {
    return this.well !== null;
  }

  private revOf(data: Float64Array): number {
    let r = this.revs.get(data);
    if (r === undefined) {
      r = this.nextRev++;
      this.revs.set(data, r);
    }
    return r;
  }

  private zoneLayout(interp: Interpretation): ZoneLayout {
    // Geometría + nombres + tipos: viajan en `ctx.zones` (avisos, sumario por tipo de zona), así que también invalidan.
    const key = `${zoneGeometryKey(interp.zones)}#${interp.zones.map((z) => `${z.name}\u0001${z.kind}`).join('\u0000')}`;
    if (!this.layout || this.layout.key !== key) {
      this.layout = { key, value: layoutZones(this.well!.depth, interp.zones) };
    }
    return this.layout.value;
  }

  /** Curva medida convertida a la unidad canónica del rol (cacheada por identidad de datos y unidades). */
  private curveIn(curve: EngineCurve, to: UnitId): Float64Array {
    if (curve.unit === to) return curve.data;
    const prev = this.converted.get(curve.id);
    if (prev && prev.source === curve.data && prev.from === curve.unit && prev.to === to) return prev.data;
    const data = convertArray(curve.data, curve.unit, to);
    this.converted.set(curve.id, { source: curve.data, from: curve.unit, to, data });
    return data;
  }

  /** Corre la cadena para un estado de interpretación. Solo recalcula lo que cambió. */
  run(interp: Interpretation): EngineRunResult {
    const t0 = now();
    const well = this.well;
    if (!well) throw new Error('No hay pozo cargado en el motor.');
    const registry = this.registry;
    const plan: Plan = planGraph(registry, well.curves, interp);
    let executionOrder = plan.order;
    if (this.options.targetModuleIds) {
      const included = new Set<string>();
      const include = (id: string): void => {
        if (included.has(id)) return;
        const node = plan.nodes.get(id);
        if (!node) return;
        included.add(id);
        for (const dependency of node.deps) include(dependency);
      };
      for (const target of this.options.targetModuleIds) include(target);
      executionOrder = plan.order.filter(id => included.has(id));
    }
    const diagnostics: Diagnostic[] = [...plan.diagnostics];
    const layout = this.zoneLayout(interp);
    for (const p of layout.problems) diagnostics.push({ level: 'warning', code: 'zones', message: p });
    const zoneIds = layout.spans.map((s) => s.id);
    const curvesById = new Map(well.curves.map((c) => [c.id, c]));
    const n = well.depth.length;

    const reports: NodeReport[] = [];
    const okNodes = new Set<string>();
    const recomputed: string[] = [];
    const reused: string[] = [];

    for (const id of executionOrder) {
      const node = plan.nodes.get(id)!;
      const m = registry.get(id)!;
      const report: NodeReport = { moduleId: id, reason: node.reason, status: node.status === 'ready' ? 'ok' : node.status, computed: false, ms: 0 };
      reports.push(report);
      if (node.status !== 'ready') continue;
      // Una dependencia que falló bloquea, salvo que solo alimente entradas opcionales (que quedan ausentes).
      const failedDep = node.deps.find((d) => !okNodes.has(d) && !feedsOnlyOptional(m, node, d));
      if (failedDep) {
        report.status = 'blocked';
        diagnostics.push({
          level: 'warning',
          code: 'blocked',
          moduleId: id,
          message: `'${m.name}' no se puede calcular porque '${registry.get(failedDep)?.name ?? failedDep}' falló.`,
        });
        continue;
      }

      // Entradas y su firma
      const inputs: Record<string, ReadonlyCurve | OutputValue | undefined> = {};
      // Fuente usada por entrada (lo que se publica en el reporte; las opcionales soltadas quedan null).
      const used: Record<string, SourceRef | null> = {};
      const inputStamps: string[] = [];
      let inputError: string | null = null;
      for (const [key, spec] of Object.entries(m.inputs)) {
        const src = node.inputs[key] ?? null;
        used[key] = src;
        if (!src) {
          inputs[key] = undefined;
          inputStamps.push('-');
          continue;
        }
        if (src.kind === 'module' && !okNodes.has(src.moduleId)) {
          // Solo llega acá si la entrada es opcional (ver failedDep): corre sin ella.
          inputs[key] = undefined;
          used[key] = null;
          inputStamps.push('-');
          diagnostics.push({
            level: 'warning',
            code: 'blocked',
            moduleId: id,
            port: portOf(spec),
            message: `'${m.name}' se calcula sin ${portOf(spec)} (opcional) porque '${registry.get(src.moduleId)?.name ?? src.moduleId}' falló.`,
          });
          continue;
        }
        if (src.kind === 'curve') {
          const curve = curvesById.get(src.curveId)!;
          const target = spec.kind === 'curve' ? registry.roles.unitOf(spec.role) : curve.unit;
          const unitProblem = checkUnits(curve, target);
          if (unitProblem?.fatal) {
            inputError = unitProblem.message;
            diagnostics.push({ level: 'error', code: 'unit-mismatch', moduleId: id, port: portOf(spec), message: `'${m.name}': ${unitProblem.message}` });
            break;
          }
          if (unitProblem) diagnostics.push({ level: 'warning', code: 'unknown-unit', moduleId: id, port: portOf(spec), message: unitProblem.message });
          inputs[key] = unitProblem ? curve.data : this.curveIn(curve, target);
          inputStamps.push(`c:${curve.id}#${this.revOf(curve.data)}:${curve.unit}`);
        } else {
          const dep = this.cache.get(src.moduleId)!;
          const port = portOf(spec);
          const value = dep.outputs.get(port);
          if (value === undefined || !valueMatchesKind(value, spec.kind)) {
            inputError = `la entrada ${port} no tiene el tipo esperado.`;
            diagnostics.push({ level: 'error', code: 'invalid-output', moduleId: id, port, message: `'${m.name}': ${inputError}` });
            break;
          }
          inputs[key] = value;
          inputStamps.push(`m:${src.moduleId}#${dep.version}`);
        }
      }
      if (inputError) {
        report.status = 'error';
        continue;
      }
      // Grupos «al menos N de» (0032): si las fuentes opcionales que los cumplían fallaron, no corre.
      const unmet = unmetInputGroup(m, (key) => inputs[key] !== undefined);
      if (unmet) {
        report.status = 'blocked';
        diagnostics.push({
          level: 'warning',
          code: 'blocked',
          moduleId: id,
          message: `'${m.name}' no se puede calcular: necesita ${describeInputGroup(m, unmet)} y los módulos que las daban fallaron.`,
        });
        continue;
      }

      const params = resolveModuleParams(id, m.params, interp.params, zoneIds);
      for (const p of params.problems) diagnostics.push({ level: 'warning', code: 'params', moduleId: id, message: `'${m.name}': ${p}` });
      const stamp = JSON.stringify([params.key, layout.spans.map((s) => [s.id, s.name, s.kind, s.start, s.end]), inputStamps]);
      const publish = () => {
        report.inputs = used;
        report.params = { global: params.global, byZone: Object.fromEntries(params.byZone) };
      };

      const cached = this.cache.get(id);
      if (cached && cached.ok && cached.stamp === stamp) {
        for (const w of cached.warnings) diagnostics.push(warningDiagnostic(id, m.name, w));
        okNodes.add(id);
        publish();
        reused.push(id);
        continue;
      }

      const segments: ParamSegment<ParamsSpec>[] = layout.segments.map((s) => ({
        start: s.start,
        end: s.end,
        zoneId: s.zoneId,
        params: (s.zoneId ? params.byZone.get(s.zoneId) : params.global) as ParamValues<ParamsSpec>,
      }));
      const warnings: CachedWarning[] = [];
      const ctx: ComputeContext<InputsSpec, ParamsSpec> = {
        n,
        depth: well.depth,
        thickness: this.thickness,
        inputs: inputs as ComputeContext<InputsSpec, ParamsSpec>['inputs'],
        params: params.global as ParamValues<ParamsSpec>,
        segments,
        zones: layout.spans,
        paramsFor: (zoneId) => {
          if (zoneId === null) return params.global as ParamValues<ParamsSpec>;
          const values = params.byZone.get(zoneId);
          if (!values) throw new Error(`paramsFor: la zona '${zoneId}' no existe (o es inválida y se ignoró).`);
          return values as ParamValues<ParamsSpec>;
        },
        warn: (message, where) => {
          const zoneId = where?.zoneId;
          const depth = where?.depth !== undefined && Number.isFinite(where.depth) ? where.depth : undefined;
          // Mismo texto en otra zona (o en otra profundidad) es otro aviso (0072).
          if (warnings.some((w) => w.message === message && w.zoneId === zoneId && w.depth === depth)) return;
          warnings.push({ message, ...(zoneId !== undefined ? { zoneId } : {}), ...(depth !== undefined ? { depth } : {}) });
        },
      };

      const guarded = this.options.checkInputs ? guardedCurves(inputs, well.depth, this.thickness) : null;
      const t1 = now();
      let produced: Record<string, unknown>;
      try {
        produced = m.compute(ctx) as Record<string, unknown>;
      } catch (err) {
        if (guarded) assertUnchanged(guarded, m);
        report.ms = now() - t1;
        report.status = 'error';
        this.cache.set(id, { stamp, version: this.nextVersion++, ok: false, outputs: new Map(), warnings: [] });
        diagnostics.push({ level: 'error', code: 'compute-error', moduleId: id, message: `Error al calcular '${m.name}': ${errorMessage(err)}` });
        continue;
      }
      report.ms = now() - t1;
      report.computed = true;
      if (guarded) assertUnchanged(guarded, m);

      const outputs = new Map<string, OutputValue>();
      const problem = collectOutputs(m, produced, n, layout.spans, outputs);
      if (problem) {
        report.status = 'error';
        this.cache.set(id, { stamp, version: this.nextVersion++, ok: false, outputs: new Map(), warnings: [] });
        diagnostics.push({ level: 'error', code: 'invalid-output', moduleId: id, message: `'${m.name}' devolvió una salida inválida: ${problem}` });
        continue;
      }
      this.cache.set(id, { stamp, version: this.nextVersion++, ok: true, outputs, warnings });
      for (const w of warnings) diagnostics.push(warningDiagnostic(id, m.name, w));
      okNodes.add(id);
      publish();
      recomputed.push(id);
    }

    const outputs: OutputRecord[] = [];
    for (const id of executionOrder) {
      if (!okNodes.has(id)) continue;
      const m = registry.get(id)!;
      const cached = this.cache.get(id)!;
      for (const spec of Object.values(m.outputs)) {
        const port = portOf(spec);
        const chosen = plan.sources.get(port);
        const unit: UnitId | undefined =
          spec.kind === 'curve' ? registry.roles.unitOf(spec.role) : spec.kind === 'scalar' || spec.kind === 'zoneScalar' ? spec.unit : undefined;
        outputs.push({
          key: `${id}:${port}`,
          moduleId: id,
          port,
          kind: spec.kind,
          active: chosen?.kind === 'module' && chosen.moduleId === id,
          version: cached.version,
          label: spec.label ?? (spec.kind === 'curve' ? registry.roles.get(spec.role)?.label ?? port : port),
          ...(unit !== undefined ? { unit } : {}),
          ...(spec.kind === 'table' && spec.hidden ? { hidden: true as const } : {}),
          value: cached.outputs.get(port)!,
        });
      }
    }

    return {
      outputs,
      nodes: reports,
      diagnostics,
      sources: Object.fromEntries(plan.sources),
      candidates: Object.fromEntries(plan.candidates),
      segments: layout.segments.map((g) => ({ start: g.start, end: g.end, zoneId: g.zoneId })),
      stats: { recomputed, reused, ms: now() - t0, samples: n },
    };
  }
}

/**
 * Salida que alimenta la cadena para un puerto (la del módulo elegido como fuente), o undefined si el puerto no
 * tiene una salida activa (falta, falló, o la fuente es una curva medida). Útil para paneles y para el sumario.
 */
export function activeOutput(outputs: readonly OutputRecord[], port: string): OutputRecord | undefined {
  return outputs.find((o) => o.port === port && o.active);
}

/** Atajo sin caché: corre la cadena completa una vez (útil en tests y Monte Carlo). */
export function computeOnce(registry: Registry, well: EngineWell, interp: Interpretation, options: EngineOptions = {}): EngineRunResult {
  const engine = new Engine(registry, options);
  engine.setWell(well);
  return engine.run(interp);
}

function checkUnits(curve: EngineCurve, target: UnitId): { fatal: boolean; message: string } | null {
  if (curve.unit === target) return null;
  const from = getUnit(curve.unit);
  const to = getUnit(target);
  if (!from) {
    return { fatal: false, message: `La curva '${curve.mnemonic}' tiene una unidad desconocida ('${curve.unit}'); se asume ${unitLabel(target)}.` };
  }
  if (!to || from.dimension !== to.dimension) {
    return { fatal: true, message: `la curva '${curve.mnemonic}' está en ${from.label} y se esperaba una magnitud en ${unitLabel(target)}.` };
  }
  return null;
}

/** true si un valor ya validado por `collectOutputs` es del tipo de puerto pedido. */
function valueMatchesKind(value: OutputValue, kind: PortKind): boolean {
  switch (kind) {
    case 'curve':
      return value instanceof Float64Array;
    case 'scalar':
      return typeof value === 'number';
    case 'table':
      return isTable(value);
    case 'zoneScalar':
      return typeof value === 'object' && !(value instanceof Float64Array) && !isTable(value);
  }
}

function isTable(v: unknown): v is TableValue {
  return !!v && typeof v === 'object' && !(v instanceof Float64Array) && Array.isArray((v as TableValue).rows);
}

/**
 * Valida y guarda las salidas de un módulo. Tablas y valores por zona se congelan (Object.freeze, también cada fila):
 * quedan en caché y los consumidores los reciben como entrada; escribir en ellos lanza un error en vez de corromper
 * la caché en silencio.
 */
function collectOutputs(
  m: AnyModule,
  produced: Record<string, unknown>,
  n: number,
  zones: readonly ZoneSpan[],
  out: Map<string, OutputValue>,
): string | null {
  if (!produced || typeof produced !== 'object') return 'compute no devolvió un objeto.';
  for (const [key, spec] of Object.entries(m.outputs)) {
    const v = produced[key];
    if (spec.kind === 'curve') {
      if (!(v instanceof Float64Array)) return `'${key}' debe ser un Float64Array.`;
      if (v.length !== n) return `'${key}' tiene ${v.length} muestras y el pozo ${n}.`;
    } else if (spec.kind === 'scalar') {
      if (typeof v !== 'number') return `'${key}' debe ser un número.`;
    } else if (spec.kind === 'table') {
      if (!isTable(v)) return `'${key}' debe ser una tabla { rows: [...] }.`;
      for (const row of v.rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return `'${key}' tiene una fila que no es un objeto.`;
        Object.freeze(row);
      }
      Object.freeze(v.rows);
      Object.freeze(v);
    } else {
      const problem = checkZoneScalar(key, v, zones);
      if (problem) return problem;
      Object.freeze(v);
    }
    out.set(portOf(spec), v as OutputValue);
  }
  return null;
}

/** Un valor por zona tiene exactamente una clave numérica por cada zona de `ctx.zones` (NaN = sin dato). */
function checkZoneScalar(key: string, v: unknown, zones: readonly ZoneSpan[]): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v instanceof Float64Array || isTable(v)) {
    return `'${key}' debe ser un objeto { [zona]: número }.`;
  }
  const record = v as Record<string, unknown>;
  const ids = new Set(zones.map((z) => z.id));
  for (const [zoneId, x] of Object.entries(record)) {
    if (!ids.has(zoneId)) return `'${key}' tiene un valor para la zona '${zoneId}', que no existe.`;
    if (typeof x !== 'number') return `'${key}' tiene un valor no numérico en la zona '${zoneId}'.`;
  }
  const missing = zones.find((z) => !Object.prototype.hasOwnProperty.call(record, z.id));
  if (missing) return `'${key}' no tiene valor para la zona '${missing.name}' (usá NaN si no hay dato).`;
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ---------------------------------------------------------------------------------------------------------------
// Verificación de inmutabilidad de entradas (modo checkInputs)

interface GuardedCurve {
  name: string;
  data: Float64Array;
  hash: string;
}

/** Hash de 64 bits (dos carriles FNV-1a sobre los bits de cada float: distingue NaN, -0, etc.). */
function hashCurve(data: Float64Array): string {
  const words = new Uint32Array(data.buffer, data.byteOffset, data.length * 2);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ data.length;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ w, 0x5bd1e995) ^ (h2 >>> 15);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

function guardedCurves(inputs: Record<string, unknown>, depth: Float64Array, thickness: Float64Array): GuardedCurve[] {
  const list: GuardedCurve[] = [
    { name: 'depth', data: depth, hash: '' },
    { name: 'thickness', data: thickness, hash: '' },
  ];
  for (const [name, v] of Object.entries(inputs)) if (v instanceof Float64Array) list.push({ name, data: v, hash: '' });
  for (const g of list) g.hash = hashCurve(g.data);
  return list;
}

function assertUnchanged(guarded: GuardedCurve[], m: AnyModule): void {
  const changed = guarded.filter((g) => hashCurve(g.data) !== g.hash).map((g) => g.name);
  if (changed.length) throw new InputMutationError(m.id, changed, m.name);
}

