/**
 * «¿De dónde sale este número?» (docs/decisiones/0074): la cadena de cálculo de una salida en una muestra.
 *
 * Puro y genérico (sin React, sin código por módulo). NO recalcula nada: lee lo que publicó la última corrida del motor
 * —salidas, `nodes[].inputs` (la fuente que recibió cada entrada), `nodes[].params` (los parámetros resueltos) y
 * `segments` (qué zona tiene cada muestra)— y lo recorre hacia arriba desde el módulo de la salida elegida. Los valores
 * de cada eslabón son las salidas publicadas leídas en el índice de la muestra: coinciden por construcción con el visor.
 *
 * La traza es el grafo, no un árbol: un módulo que alimenta a varios (Vsh entra en φ y en Sw) aparece una sola vez,
 * en el orden del motor (de las curvas medidas hacia la salida), y los demás eslabones lo citan por referencia.
 */
import { sourceRefEquals, type SourceRef } from '../interpretation';
import { portOf, type InputSpec, type OutputValue, type PortKind, type TableValue } from '../module';
import { paramScope, type ParamValue } from '../params';
import type { Registry } from '../registry';
import type { RoleId } from '../roles';
import { convert, getUnit, type UnitId } from '../units';
import type { EngineRunResult, NodeReport, OutputRecord } from './engine';

/** Lo que la traza necesita de una corrida (un `EngineRunResult` o un `ClientResult` lo cumplen). */
export type TraceRunResult = Pick<EngineRunResult, 'outputs' | 'nodes' | 'sources' | 'candidates' | 'segments'>;

/** Curva medida (o preparada) tal como la recibió el motor en esa corrida. */
export interface TraceCurve {
  id: string;
  mnemonic: string;
  role: RoleId | null;
  unit: UnitId;
  data: ArrayLike<number>;
  provenance?: { origin: 'original' | 'prepared' };
}

/** Salida de un eslabón en la muestra. */
export interface TraceOutput {
  key: string;
  port: string;
  label: string;
  kind: PortKind;
  unit?: UnitId;
  /** Valor en la muestra (NaN = sin dato; null en tablas). Un valor por zona da el de la zona de la muestra. */
  value: number | null;
  /** Filas, si es una tabla. */
  rows?: number;
  /** Alimenta la cadena del pozo (el módulo es la fuente elegida de ese puerto). */
  active: boolean;
  /** Sigue la cadena de ESTA traza: es la salida pedida o la recibe otro eslabón. */
  inChain: boolean;
}

/** De dónde vino una entrada en la corrida. */
export type TraceSource =
  | { kind: 'module'; moduleId: string; name: string; /** índice del eslabón en `links` */ link: number }
  | {
      kind: 'curve';
      curveId: string;
      mnemonic: string;
      role: RoleId | null;
      /** Unidad de la curva en el pozo (el valor está en la unidad canónica del rol, salvo `unknownUnit`). */
      unit: UnitId;
      prepared: boolean;
      /** Curva con otro rol elegida a mano para este puerto (p. ej. AT60 como RT). */
      crossRole: boolean;
      /** Unidad desconocida: el motor usó el valor crudo (y avisó). */
      unknownUnit: boolean;
    }
  | { kind: 'absent'; /** módulo que la daba y no se pudo calcular, si lo hay */ failed?: { moduleId: string; name: string } };

export interface TraceCandidate {
  kind: 'curve' | 'module';
  id: string;
  label: string;
  /** Módulo calculado para comparar (corrió, no alimenta la cadena). */
  alternative: boolean;
}

export interface TraceInput {
  key: string;
  port: string;
  label: string;
  kind: PortKind;
  optional: boolean;
  source: TraceSource;
  /** Valor en la muestra en la unidad que recibió el módulo (NaN = sin dato; null = tabla o ausente). */
  value: number | null;
  unit?: UnitId;
  rows?: number;
  /** La fuente elegida para el puerto es este mismo módulo: usa la siguiente candidata (`source`). */
  chosenIsSelf: boolean;
  /** Otras candidatas del puerto (sin valores). */
  others: TraceCandidate[];
  /** Esta entrada medida es donde aparece el hueco de la cadena. */
  gap: boolean;
}

export interface TraceParam {
  key: string;
  label: string;
  type: 'number' | 'enum' | 'boolean';
  value: ParamValue;
  /** Texto de una opción (enum). */
  optionLabel?: string;
  unit?: UnitId;
  /** Se puede ajustar por zona. */
  zoneScoped: boolean;
  /** El valor de la zona de la muestra difiere del global (override propio de la zona). */
  fromZone: boolean;
}

export interface TraceLink {
  moduleId: string;
  name: string;
  category: string;
  categoryLabel: string;
  outputs: TraceOutput[];
  inputs: TraceInput[];
  params: TraceParam[];
  /** Acá aparece el hueco: todas sus entradas tienen valor y su salida de la cadena no. */
  gap: boolean;
}

export interface Trace {
  status: 'ok';
  outputKey: string;
  index: number;
  /** Zona de la muestra en esa corrida (null = fuera de las zonas: parámetros globales). */
  zoneId: string | null;
  /** Módulo de la salida pedida (último eslabón). */
  moduleId: string;
  target: TraceOutput;
  /** La salida pedida es una alternativa (módulo en comparación): no alimenta la cadena. */
  alternative: boolean;
  /** Eslabones en el orden del motor; el último es el de la salida pedida. */
  links: TraceLink[];
  /** Dónde se corta la cadena por un dato faltante (null si la salida tiene valor o no se encontró el origen). */
  gap: { moduleId: string; inputKey?: string } | null;
}

export type TraceOutcome =
  | Trace
  /** La salida no está en esta corrida (módulo apagado, falló o la clave no existe). */
  | { status: 'no-output'; outputKey: string; index: number }
  /** El índice no es una muestra del pozo. */
  | { status: 'out-of-range'; outputKey: string; index: number }
  /** El motor no publicó entradas para ese nodo (no corrió bien en esta corrida). */
  | { status: 'not-run'; outputKey: string; index: number };

/** Zona de una muestra según los tramos de la corrida. */
export function zoneAt(segments: TraceRunResult['segments'], index: number): string | null {
  for (const s of segments) if (index >= s.start && index < s.end) return s.zoneId;
  return null;
}

/** Valor de una salida en una muestra (NaN = sin dato; null = tabla). */
export function outputValueAt(value: OutputValue, index: number, zoneId: string | null): { value: number | null; rows?: number } {
  if (value instanceof Float64Array) return { value: index >= 0 && index < value.length ? value[index]! : NaN };
  if (typeof value === 'number') return { value };
  if (value && typeof value === 'object' && Array.isArray((value as TableValue).rows)) return { value: null, rows: (value as TableValue).rows.length };
  const record = value as Record<string, number>;
  return { value: zoneId !== null && typeof record[zoneId] === 'number' ? record[zoneId]! : NaN };
}

const isNaNValue = (v: number | null) => typeof v === 'number' && Number.isNaN(v);

/**
 * Traza de la salida `outputKey` (`<moduleId>:<puerto>`, como `OutputRecord.key`) en la muestra `index`.
 * `curves`: las curvas que vio el motor en la corrida (las del pozo y, si hay preparación, las preparadas).
 */
export function traceSample(result: TraceRunResult, registry: Registry, curves: readonly TraceCurve[], index: number, outputKey: string): TraceOutcome {
  const target = result.outputs.find((o) => o.key === outputKey);
  if (!target) return { status: 'no-output', outputKey, index };
  const n = result.segments.length ? result.segments[result.segments.length - 1]!.end : target.value instanceof Float64Array ? target.value.length : 0;
  if (!Number.isInteger(index) || index < 0 || index >= n) return { status: 'out-of-range', outputKey, index };

  const reports = new Map(result.nodes.map((r) => [r.moduleId, r]));
  const okReport = (id: string): NodeReport | undefined => {
    const r = reports.get(id);
    return r && r.status === 'ok' && r.inputs ? r : undefined;
  };
  if (!okReport(target.moduleId)) return { status: 'not-run', outputKey, index };

  // 1. Módulos de la cadena: hacia arriba por las fuentes usadas (cada uno una vez).
  const members = new Set<string>([target.moduleId]);
  const stack = [target.moduleId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const src of Object.values(okReport(id)?.inputs ?? {})) {
      if (src?.kind === 'module' && !members.has(src.moduleId) && okReport(src.moduleId)) {
        members.add(src.moduleId);
        stack.push(src.moduleId);
      }
    }
  }
  // Orden del motor (topológico): de las curvas medidas hacia la salida.
  const order = result.nodes.filter((r) => members.has(r.moduleId)).map((r) => r.moduleId);
  const linkOf = new Map(order.map((id, i) => [id, i]));

  // Puertos que consume algún eslabón, por módulo productor.
  const consumed = new Map<string, Set<string>>();
  for (const id of order) {
    const m = registry.get(id);
    for (const [key, src] of Object.entries(okReport(id)!.inputs!)) {
      const spec = m?.inputs[key];
      if (src?.kind !== 'module' || !spec) continue;
      const set = consumed.get(src.moduleId) ?? new Set<string>();
      set.add(portOf(spec));
      consumed.set(src.moduleId, set);
    }
  }

  const zoneId = zoneAt(result.segments, index);
  const outputsByKey = new Map<string, OutputRecord>(result.outputs.map((o) => [o.key, o]));
  const curvesById = new Map(curves.map((c) => [c.id, c]));
  const nameOf = (id: string) => registry.get(id)?.name ?? id;

  const traceInput = (id: string, key: string, spec: InputSpec, src: SourceRef | null): TraceInput => {
    const pinned = spec.kind === 'curve' && spec.curveId !== undefined;
    const port = pinned ? spec.label ?? portOf(spec) : portOf(spec);
    const label = spec.label ?? (spec.kind === 'curve' ? registry.roles.get(spec.role)?.label ?? port : port);
    const chosen = pinned ? undefined : result.sources[port];
    const chosenIsSelf = chosen?.kind === 'module' && chosen.moduleId === id;
    const others: TraceCandidate[] = (pinned ? [] : result.candidates[port] ?? [])
      .filter((c) => !sourceRefEquals(c, src ?? undefined) && !(c.kind === 'module' && c.moduleId === id))
      .map((c) =>
        c.kind === 'curve'
          ? { kind: 'curve' as const, id: c.curveId, label: curvesById.get(c.curveId)?.mnemonic ?? c.curveId, alternative: false }
          : {
              kind: 'module' as const,
              id: c.moduleId,
              label: nameOf(c.moduleId),
              alternative: result.outputs.some((o) => o.moduleId === c.moduleId && o.port === port && !o.active),
            },
      );
    const base = { key, port, label, kind: spec.kind, optional: !!spec.optional, chosenIsSelf: chosenIsSelf && !!src, others, gap: false };

    if (!src) {
      // ¿Quién la daba? La fuente elegida (o, si es este módulo, la siguiente candidata módulo) que no corrió bien.
      const feeder = chosen && !chosenIsSelf ? chosen : (result.candidates[port] ?? []).find((c) => c.kind === 'module' && c.moduleId !== id);
      const failed = feeder?.kind === 'module' && !okReport(feeder.moduleId) ? { moduleId: feeder.moduleId, name: nameOf(feeder.moduleId) } : undefined;
      return { ...base, source: { kind: 'absent', ...(failed ? { failed } : {}) }, value: null };
    }
    if (src.kind === 'module') {
      const out = outputsByKey.get(`${src.moduleId}:${port}`);
      const v = out ? outputValueAt(out.value, index, zoneId) : { value: NaN };
      return {
        ...base,
        source: { kind: 'module', moduleId: src.moduleId, name: nameOf(src.moduleId), link: linkOf.get(src.moduleId) ?? -1 },
        ...v,
        ...(out?.unit !== undefined ? { unit: out.unit } : {}),
      };
    }
    const curve = curvesById.get(src.curveId);
    if (!curve) {
      return {
        ...base,
        source: { kind: 'curve', curveId: src.curveId, mnemonic: src.curveId, role: null, unit: 'unitless', prepared: false, crossRole: false, unknownUnit: true },
        value: NaN,
      };
    }
    // Igual que `Engine.curveIn`: la curva llega en la unidad canónica del rol del puerto.
    const raw = index < curve.data.length ? curve.data[index]! : NaN;
    const to = spec.kind === 'curve' && !pinned ? registry.roles.unitOf(spec.role) : curve.unit;
    let value = raw;
    let unknownUnit = false;
    if (curve.unit !== to) {
      if (!getUnit(curve.unit) || !getUnit(to)) unknownUnit = true;
      else {
        try {
          value = convert(raw, curve.unit, to);
        } catch {
          unknownUnit = true;
        }
      }
    }
    return {
      ...base,
      source: {
        kind: 'curve',
        curveId: curve.id,
        mnemonic: curve.mnemonic,
        role: curve.role,
        unit: curve.unit,
        prepared: curve.provenance?.origin === 'prepared',
        crossRole: spec.kind === 'curve' && !pinned && curve.role !== spec.role,
        unknownUnit,
      },
      value,
      unit: unknownUnit ? curve.unit : to,
    };
  };

  const links: TraceLink[] = order.map((id) => {
    const m = registry.get(id);
    const report = okReport(id)!;
    const outputs: TraceOutput[] = result.outputs
      .filter((o) => o.moduleId === id)
      .map((o) => ({
        key: o.key,
        port: o.port,
        label: o.label,
        kind: o.kind,
        ...(o.unit !== undefined ? { unit: o.unit } : {}),
        ...outputValueAt(o.value, index, zoneId),
        active: o.active,
        inChain: o.key === outputKey || !!consumed.get(id)?.has(o.port),
      }));

    const inputs: TraceInput[] = Object.entries(m?.inputs ?? {}).map(([key, spec]) => traceInput(id, key, spec, report.inputs![key] ?? null));

    const params: TraceParam[] = [];
    const resolved = report.params;
    if (m && resolved) {
      const values = zoneId !== null && resolved.byZone[zoneId] ? resolved.byZone[zoneId]! : resolved.global;
      for (const [key, spec] of Object.entries(m.params)) {
        const value = values[key] ?? resolved.global[key] ?? spec.default;
        const zoneScoped = paramScope(spec) === 'zone';
        params.push({
          key,
          label: spec.label,
          type: spec.type,
          value,
          ...(spec.type === 'enum' ? { optionLabel: spec.options.find((o) => o.value === value)?.label ?? String(value) } : {}),
          ...(spec.type === 'number' && spec.unit !== undefined ? { unit: spec.unit } : {}),
          zoneScoped,
          fromZone: zoneScoped && zoneId !== null && value !== resolved.global[key],
        });
      }
    }
    return {
      moduleId: id,
      name: m?.name ?? id,
      category: m?.category ?? 'other',
      categoryLabel: m ? registry.categoryLabel(m.category) : '',
      outputs,
      inputs,
      params,
      gap: false,
    };
  });

  // 2. Dónde se corta la cadena: el primer eslabón cuyas entradas tienen todas valor y cuya salida de la cadena no.
  let gap: Trace['gap'] = null;
  for (const link of links) {
    const inputsOk = link.inputs.every((i) => i.source.kind === 'absent' || !isNaNValue(i.value));
    if (inputsOk && link.outputs.some((o) => o.inChain && isNaNValue(o.value))) {
      link.gap = true;
      gap = { moduleId: link.moduleId };
      break;
    }
  }
  const targetOut = links[links.length - 1]!.outputs.find((o) => o.key === outputKey)!;
  if (!gap && isNaNValue(targetOut.value)) {
    // El hueco viene de un dato medido: la primera entrada medida sin dato.
    for (const link of links) {
      const input = link.inputs.find((i) => i.source.kind === 'curve' && isNaNValue(i.value));
      if (input) {
        input.gap = true;
        gap = { moduleId: link.moduleId, inputKey: input.key };
        break;
      }
    }
  }

  return {
    status: 'ok',
    outputKey,
    index,
    zoneId,
    moduleId: target.moduleId,
    target: targetOut,
    alternative: !target.active,
    links,
    gap,
  };
}
