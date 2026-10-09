/**
 * Motor de cálculo incremental. Sin dependencias de navegador ni de React: corre igual en un Web Worker,
 * en el hilo principal, en los tests y en Monte Carlo.
 *
 * Invalidación: cada módulo tiene una firma de entrada = parámetros resueltos + zonas (geometría y nombre) + versión de
 * cada entrada. Si la firma no cambió desde la corrida anterior, se reusa el resultado; si cambió, se recalcula y
 * sus salidas reciben una versión nueva, lo que cambia la firma de sus dependientes (y solo de ellos).
 */
import type { Interpretation, SourceRef } from '../interpretation';
import {
  portOf,
  type AnyModule,
  type ComputeContext,
  type InputsSpec,
  type OutputValue,
  type ParamSegment,
  type TableValue,
} from '../module';
import { resolveModuleParams, type ParamsSpec, type ParamValues } from '../params';
import type { Registry, PortKind } from '../registry';
import type { RoleId } from '../roles';
import { convertArray, getUnit, unitLabel, type UnitId } from '../units';
import { layoutZones, sampleThickness, zoneGeometryKey, type ZoneLayout } from '../well';
import { planGraph, type Diagnostic, type NodeReason, type Plan } from './graph';

/** Curva tal como la ve el motor (subconjunto de `Curve`). */
export interface EngineCurve {
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
}

export interface EngineRunResult {
  outputs: OutputRecord[];
  nodes: NodeReport[];
  diagnostics: Diagnostic[];
  /** Fuente elegida por puerto. */
  sources: Record<string, SourceRef>;
  /** Fuentes disponibles por puerto (para el selector de método). */
  candidates: Record<string, SourceRef[]>;
  stats: { recomputed: string[]; reused: string[]; ms: number; samples: number };
}

interface NodeCache {
  stamp: string;
  version: number;
  ok: boolean;
  outputs: Map<string, OutputValue>;
  /** Advertencias emitidas por compute (se re-emiten mientras el resultado siga en caché). */
  warnings: string[];
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

export class Engine {
  private well: EngineWell | null = null;
  private thickness: Float64Array = new Float64Array(0);
  private layout: { key: string; value: ZoneLayout } | null = null;
  private readonly cache = new Map<string, NodeCache>();
  private readonly converted = new Map<string, ConvertedCurve>();
  private readonly revs = new WeakMap<Float64Array, number>();
  private nextRev = 1;
  private nextVersion = 1;

  constructor(readonly registry: Registry) {}

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
    // Geometría + nombres: los nombres viajan en `ctx.zones` y en los avisos, así que también invalidan.
    const key = `${zoneGeometryKey(interp.zones)}#${interp.zones.map((z) => z.name).join('\u0000')}`;
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

    for (const id of plan.order) {
      const node = plan.nodes.get(id)!;
      const m = registry.get(id)!;
      const report: NodeReport = { moduleId: id, reason: node.reason, status: node.status === 'ready' ? 'ok' : node.status, computed: false, ms: 0 };
      reports.push(report);
      if (node.status !== 'ready') continue;
      const failedDep = node.deps.find((d) => !okNodes.has(d));
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
      const inputs: Record<string, Readonly<Float64Array> | number | undefined> = {};
      const inputStamps: string[] = [];
      let inputError: string | null = null;
      for (const [key, spec] of Object.entries(m.inputs)) {
        const src = node.inputs[key] ?? null;
        if (!src) {
          inputs[key] = undefined;
          inputStamps.push('-');
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
          if (spec.kind === 'curve' ? !(value instanceof Float64Array) : typeof value !== 'number') {
            inputError = `la entrada ${port} no tiene el tipo esperado.`;
            diagnostics.push({ level: 'error', code: 'invalid-output', moduleId: id, port, message: `'${m.name}': ${inputError}` });
            break;
          }
          inputs[key] = value as Float64Array | number;
          inputStamps.push(`m:${src.moduleId}#${dep.version}`);
        }
      }
      if (inputError) {
        report.status = 'error';
        continue;
      }

      const params = resolveModuleParams(id, m.params, interp.params, zoneIds);
      for (const p of params.problems) diagnostics.push({ level: 'warning', code: 'params', moduleId: id, message: `'${m.name}': ${p}` });
      const stamp = JSON.stringify([params.key, layout.spans.map((s) => [s.id, s.name, s.start, s.end]), inputStamps]);

      const cached = this.cache.get(id);
      if (cached && cached.ok && cached.stamp === stamp) {
        for (const w of cached.warnings) diagnostics.push({ level: 'warning', code: 'module-warning', moduleId: id, message: `${m.name}: ${w}` });
        okNodes.add(id);
        reused.push(id);
        continue;
      }

      const segments: ParamSegment<ParamsSpec>[] = layout.segments.map((s) => ({
        start: s.start,
        end: s.end,
        zoneId: s.zoneId,
        params: (s.zoneId ? params.byZone.get(s.zoneId) : params.global) as ParamValues<ParamsSpec>,
      }));
      const warnings: string[] = [];
      const ctx: ComputeContext<InputsSpec, ParamsSpec> = {
        n,
        depth: well.depth,
        thickness: this.thickness,
        inputs: inputs as ComputeContext<InputsSpec, ParamsSpec>['inputs'],
        params: params.global as ParamValues<ParamsSpec>,
        segments,
        zones: layout.spans,
        warn: (message) => {
          if (!warnings.includes(message)) warnings.push(message);
        },
      };

      const t1 = now();
      let produced: Record<string, unknown>;
      try {
        produced = m.compute(ctx) as Record<string, unknown>;
      } catch (err) {
        report.ms = now() - t1;
        report.status = 'error';
        this.cache.set(id, { stamp, version: this.nextVersion++, ok: false, outputs: new Map(), warnings: [] });
        diagnostics.push({ level: 'error', code: 'compute-error', moduleId: id, message: `Error al calcular '${m.name}': ${errorMessage(err)}` });
        continue;
      }
      report.ms = now() - t1;
      report.computed = true;

      const outputs = new Map<string, OutputValue>();
      const problem = collectOutputs(m, produced, n, outputs);
      if (problem) {
        report.status = 'error';
        this.cache.set(id, { stamp, version: this.nextVersion++, ok: false, outputs: new Map(), warnings: [] });
        diagnostics.push({ level: 'error', code: 'invalid-output', moduleId: id, message: `'${m.name}' devolvió una salida inválida: ${problem}` });
        continue;
      }
      this.cache.set(id, { stamp, version: this.nextVersion++, ok: true, outputs, warnings });
      for (const w of warnings) diagnostics.push({ level: 'warning', code: 'module-warning', moduleId: id, message: `${m.name}: ${w}` });
      okNodes.add(id);
      recomputed.push(id);
    }

    const outputs: OutputRecord[] = [];
    for (const id of plan.order) {
      if (!okNodes.has(id)) continue;
      const m = registry.get(id)!;
      const cached = this.cache.get(id)!;
      for (const spec of Object.values(m.outputs)) {
        const port = portOf(spec);
        const chosen = plan.sources.get(port);
        const unit: UnitId | undefined =
          spec.kind === 'curve' ? registry.roles.unitOf(spec.role) : spec.kind === 'scalar' ? spec.unit : undefined;
        outputs.push({
          key: `${id}:${port}`,
          moduleId: id,
          port,
          kind: spec.kind,
          active: chosen?.kind === 'module' && chosen.moduleId === id,
          version: cached.version,
          label: spec.label ?? (spec.kind === 'curve' ? registry.roles.get(spec.role)?.label ?? port : port),
          ...(unit !== undefined ? { unit } : {}),
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
      stats: { recomputed, reused, ms: now() - t0, samples: n },
    };
  }
}

/** Atajo sin caché: corre la cadena completa una vez (útil en tests y Monte Carlo). */
export function computeOnce(registry: Registry, well: EngineWell, interp: Interpretation): EngineRunResult {
  const engine = new Engine(registry);
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

function collectOutputs(m: AnyModule, produced: Record<string, unknown>, n: number, out: Map<string, OutputValue>): string | null {
  if (!produced || typeof produced !== 'object') return 'compute no devolvió un objeto.';
  for (const [key, spec] of Object.entries(m.outputs)) {
    const v = produced[key];
    if (spec.kind === 'curve') {
      if (!(v instanceof Float64Array)) return `'${key}' debe ser un Float64Array.`;
      if (v.length !== n) return `'${key}' tiene ${v.length} muestras y el pozo ${n}.`;
    } else if (spec.kind === 'scalar') {
      if (typeof v !== 'number') return `'${key}' debe ser un número.`;
    } else if (!v || typeof v !== 'object' || !Array.isArray((v as TableValue).rows)) {
      return `'${key}' debe ser una tabla { rows: [...] }.`;
    }
    out.set(portOf(spec), v as OutputValue);
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
