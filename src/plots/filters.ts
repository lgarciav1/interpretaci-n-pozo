/**
 * Filtros genéricos de muestras por curva o bandera para los gráficos del dock (histograma, crossplot y
 * distribuciones por zona). Puro y testeado, sin React ni stores.
 *
 * Permite combinar varias reglas (intersección / AND) sobre cualquier curva medida (`m:<id>`), calculada (`r:<ROL>`)
 * o bandera (`r:NET_PAY`, `r:NET_RES`, `r:IND_WASHOUT`, `r:IND_NMR_DEFICIT`, etc.): por ejemplo, histograma de GR
 * filtrado por `VSH ≤ 0,3`, porosidad filtrada por `NET_PAY = Sí` o `No`, Pickett filtrado por `PHIE ≥ 0,08`, o
 * densidad–neutrón sin derrumbe.
 */
import type { PlotCurveKey, PlotFilterOp, PlotFilterRule } from '../core/plots';
import type { HiddenCurve } from '../core/toolString';
import { CUTOFF_PASSES, cutoffParamFor, sharedParamValue } from './cutoffs';
import { hiddenCurveOfKey, plotCurveOptions, resolvePlotCurve, roleOfKey, type CurveOption, type PlotCurve } from './data';
import type { SeriesContext } from './trend/series';

/** Símbolos cortos de cada operador para selectores y etiquetas. */
export const FILTER_OP_LABELS: Readonly<Record<PlotFilterOp, string>> = {
  le: '≤',
  lt: '<',
  ge: '≥',
  gt: '>',
  between: 'entre',
  eq: '=',
  neq: '≠',
};

/** Etiquetas cortas y legibles para banderas conocidas. */
const FLAG_SHORT_NAMES: Readonly<Record<string, string>> = {
  NET_PAY: 'Pay neto',
  NET_RES: 'Reservorio neto',
  IND_WASHOUT: 'Derrumbe',
  IND_NMR_DEFICIT: 'Déficit RMN',
};

/** Atajo de un clic para los filtros petrofísicos más frecuentes. */
export interface FilterPreset {
  id: string;
  label: string;
  title: string;
  curve: PlotCurveKey;
  op: PlotFilterOp;
  value: number;
}

export const FILTER_PRESETS: readonly FilterPreset[] = [
  { id: 'netPay', label: 'Pay neto', title: 'Solo muestras con bandera de pay neto (NET_PAY = 1)', curve: 'r:NET_PAY', op: 'eq', value: 1 },
  { id: 'netRes', label: 'Reservorio neto', title: 'Solo muestras con bandera de reservorio neto (NET_RES = 1)', curve: 'r:NET_RES', op: 'eq', value: 1 },
  { id: 'noWashout', label: 'Sin derrumbe', title: 'Excluir muestras con derrumbe (IND_WASHOUT = 0)', curve: 'r:IND_WASHOUT', op: 'eq', value: 0 },
];

/** true si la clave corresponde a una curva con rol de familia `flag` (bandera 0/1). */
export function isFlagCurve(ctx: Pick<SeriesContext, 'well' | 'catalog'>, key: PlotCurveKey): boolean {
  const role = roleOfKey(ctx, key);
  return !!role && ctx.catalog.get(role)?.family === 'flag';
}

/**
 * Opciones del selector de curva para filtros: todas las curvas graficables (`plotCurveOptions`) más las banderas
 * disponibles (calculadas activas y medidas con rol de bandera) agrupadas bajo «Banderas».
 */
export function filterCurveOptions(ctx: SeriesContext): CurveOption[] {
  const flags: CurveOption[] = [];
  const seen = new Set<string>();
  const depthLen = ctx.well.depth.values.length;

  for (const c of ctx.computed) {
    if (!c.active || c.data.length !== depthLen) continue;
    const def = ctx.catalog.get(c.port);
    if (def?.family !== 'flag') continue;
    const key = `r:${c.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ value: key, label: `${c.port} · ${FLAG_SHORT_NAMES[c.port] ?? def.label}`, group: 'Banderas' });
  }

  for (const c of ctx.well.curves) {
    if (!c.role) continue;
    const def = ctx.catalog.get(c.role);
    if (def?.family !== 'flag') continue;
    const key = `m:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ value: key, label: `${c.mnemonic} · ${FLAG_SHORT_NAMES[c.role] ?? def.label}`, group: 'Banderas' });
  }

  return [...flags, ...plotCurveOptions(ctx)];
}

/** Atajos disponibles en este pozo (solo los cuya bandera existe en el contexto). */
export function availableFilterPresets(ctx: SeriesContext): FilterPreset[] {
  return FILTER_PRESETS.filter((p) => resolvePlotCurve(ctx, p.curve) !== null);
}

/** Genera un identificador único corto para una nueva regla de filtro. */
export function newFilterId(existing: readonly PlotFilterRule[]): string {
  const used = new Set(existing.map((r) => r.id));
  let n = existing.length + 1;
  while (used.has(`f${n}`)) n++;
  return `f${n}`;
}

/** Curva sugerida al agregar un filtro nuevo (prioriza Vsh, φe, Pay neto, Sw, Reservorio neto, GR). */
export function defaultFilterCurve(ctx: SeriesContext, existing: readonly PlotFilterRule[]): PlotCurveKey | null {
  const options = filterCurveOptions(ctx);
  if (options.length === 0) return null;
  const used = new Set(existing.map((r) => r.curve));
  const preferred = ['r:VSH', 'r:PHIE', 'r:NET_PAY', 'r:SW', 'r:NET_RES', 'r:IND_WASHOUT', 'r:GR'];
  for (const key of preferred) {
    if (!used.has(key) && options.some((o) => o.value === key)) return key;
  }
  const unused = options.find((o) => !used.has(o.value));
  return unused?.value ?? options[0]!.value;
}

/** Mediana rápida de los valores finitos de una curva (para sugerir un umbral inicial razonable). */
function finiteMedian(data: ArrayLike<number>): number {
  const vals: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return 0;
  vals.sort((a, b) => a - b);
  const mid = vals.length >> 1;
  const med = vals.length % 2 === 1 ? vals[mid]! : 0.5 * (vals[mid - 1]! + vals[mid]!);
  return Number(med.toPrecision(3));
}

/**
 * Regla inicial inteligente para una curva:
 * - Banderas: `= 1` (Sí), salvo `IND_WASHOUT` y `IND_NMR_DEFICIT` que sugieren `= 0` (No, excluir).
 * - Curvas con cutoff petrofísico (VSH, PHIE, SW, PERM): usa el valor y el sentido del cutoff vigente del pozo.
 * - Cualquier otra curva: `≤ mediana`.
 */
export function defaultFilterRule(ctx: SeriesContext, curveKey: PlotCurveKey, id: string): PlotFilterRule {
  const role = roleOfKey(ctx, curveKey);
  if (isFlagCurve(ctx, curveKey)) {
    const negative = role === 'IND_WASHOUT' || role === 'IND_NMR_DEFICIT';
    return { id, curve: curveKey, op: 'eq', value: negative ? 0 : 1, enabled: true };
  }
  const param = cutoffParamFor(role);
  if (param) {
    const val = sharedParamValue(ctx.interpretation.params, param, null);
    const op: PlotFilterOp = CUTOFF_PASSES[param] === 'below' ? 'le' : 'ge';
    return { id, curve: curveKey, op, value: val, enabled: true };
  }
  const curve = resolvePlotCurve(ctx, curveKey);
  const med = curve ? finiteMedian(curve.data) : 0;
  return { id, curve: curveKey, op: 'le', value: med, enabled: true };
}

/** Evalúa si un valor numérico cumple una regla de filtro. Los `NaN` / no finitos no pasan nunca. */
export function matchesFilterRule(v: number, rule: Pick<PlotFilterRule, 'op' | 'value' | 'max'>): boolean {
  if (!Number.isFinite(v)) return false;
  switch (rule.op) {
    case 'le':
      return v <= rule.value;
    case 'lt':
      return v < rule.value;
    case 'ge':
      return v >= rule.value;
    case 'gt':
      return v > rule.value;
    case 'between': {
      const hiVal = rule.max ?? rule.value;
      const lo = Math.min(rule.value, hiVal);
      const hi = Math.max(rule.value, hiVal);
      return v >= lo && v <= hi;
    }
    case 'eq':
      return Math.abs(v - rule.value) <= 1e-9;
    case 'neq':
      return Math.abs(v - rule.value) > 1e-9;
  }
}

export type FilterRuleStatus = 'ok' | 'hidden' | 'missing';

export interface EvaluatedFilterRule {
  rule: PlotFilterRule;
  curve: PlotCurve | null;
  isFlag: boolean;
  status: FilterRuleStatus;
  hidden: HiddenCurve | null;
  /** Resumen legible de la regla (p. ej. «VSH ≤ 0,3» o «Pay neto = Sí»). */
  summary: string;
}

export interface EvaluatedPlotFilters {
  rules: readonly EvaluatedFilterRule[];
  /** Reglas activas que se pudieron resolver y se están aplicando. */
  activeCount: number;
  /** Total de reglas con `enabled: true`. */
  enabledCount: number;
  /** Reglas activas que no se pudieron aplicar (curva ausente u oculta por la sarta). */
  skippedCount: number;
  /** Cantidad de muestras que pasan el filtro base y todas las reglas activas. */
  passed: number;
  /** Cantidad de muestras que pasan el filtro base (p. ej. zonas) antes de los filtros de curva. */
  baseTotal: number;
  /** Máscara 0/1 sobre todas las muestras del pozo; null si no hay ninguna regla activa aplicable. */
  mask: Uint8Array | null;
  /** Predicado combinado (filtro base + reglas activas). */
  include(i: number): boolean;
  /** Resumen concatenado de las reglas activas aplicadas («VSH ≤ 0,3 · Pay neto = Sí»). */
  summary: string;
}

const defaultFmt = (v: number) => String(Number(v.toPrecision(3)));

/** Formatea una regla de filtro en texto corto para leyendas y resúmenes. */
export function formatFilterRule(rule: PlotFilterRule, curve: PlotCurve | null, isFlag: boolean, fmtNum: (v: number) => string = defaultFmt): string {
  const role = curve?.role ?? (rule.curve.startsWith('r:') ? rule.curve.slice(2) : null);
  const name = isFlag && role && FLAG_SHORT_NAMES[role] ? FLAG_SHORT_NAMES[role]! : (curve?.short ?? rule.curve.slice(2));
  if (isFlag && (rule.op === 'eq' || rule.op === 'neq')) {
    const yes = (rule.op === 'eq' && rule.value === 1) || (rule.op === 'neq' && rule.value === 0);
    return `${name} = ${yes ? 'Sí' : 'No'}`;
  }
  const unit = curve?.unitText ? ` ${curve.unitText}` : '';
  if (rule.op === 'between') {
    const hiVal = rule.max ?? rule.value;
    const lo = Math.min(rule.value, hiVal);
    const hi = Math.max(rule.value, hiVal);
    return `${name} ${fmtNum(lo)}–${fmtNum(hi)}${unit}`;
  }
  return `${name} ${FILTER_OP_LABELS[rule.op]} ${fmtNum(rule.value)}${unit}`;
}

/**
 * Evalúa las reglas de filtro sobre las muestras del pozo, combinándolas por intersección (AND) con `baseInclude`
 * (habitualmente el filtro por zonas). Si una regla activa referencia una curva que falta o está oculta por la sarta,
 * se informa en `rules[k].status` y se omite en vez de vaciar todo el gráfico.
 */
export function evaluatePlotFilters(
  ctx: SeriesContext,
  rules: readonly PlotFilterRule[] | undefined,
  baseInclude?: (i: number) => boolean,
  fmtNum: (v: number) => string = defaultFmt,
): EvaluatedPlotFilters {
  const n = ctx.well.depth.values.length;
  const list = rules ?? [];
  const evaluated: EvaluatedFilterRule[] = [];
  const active: { data: Float64Array; rule: PlotFilterRule }[] = [];
  let enabledCount = 0;
  let skippedCount = 0;

  for (const rule of list) {
    const curve = resolvePlotCurve(ctx, rule.curve);
    const hidden = curve ? null : hiddenCurveOfKey(ctx, rule.curve);
    const status: FilterRuleStatus = curve ? 'ok' : hidden ? 'hidden' : 'missing';
    const flag = isFlagCurve(ctx, rule.curve);
    const summary = formatFilterRule(rule, curve, flag, fmtNum);
    evaluated.push({ rule, curve, isFlag: flag, status, hidden, summary });
    if (rule.enabled) {
      enabledCount++;
      if (curve && curve.data.length === n) active.push({ data: curve.data, rule });
      else skippedCount++;
    }
  }

  let baseTotal = 0;
  if (active.length === 0) {
    if (baseInclude) {
      for (let i = 0; i < n; i++) if (baseInclude(i)) baseTotal++;
    } else {
      baseTotal = n;
    }
    return {
      rules: evaluated,
      activeCount: 0,
      enabledCount,
      skippedCount,
      passed: baseTotal,
      baseTotal,
      mask: null,
      include: baseInclude ?? (() => true),
      summary: '',
    };
  }

  const mask = new Uint8Array(n);
  let passed = 0;
  for (let i = 0; i < n; i++) {
    if (baseInclude && !baseInclude(i)) continue;
    baseTotal++;
    let ok = true;
    for (let r = 0; r < active.length; r++) {
      const a = active[r]!;
      if (!matchesFilterRule(a.data[i]!, a.rule)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      mask[i] = 1;
      passed++;
    }
  }

  const summary = evaluated
    .filter((e) => e.rule.enabled && e.status === 'ok')
    .map((e) => e.summary)
    .join(' · ');

  return {
    rules: evaluated,
    activeCount: active.length,
    enabledCount,
    skippedCount,
    passed,
    baseTotal,
    mask,
    include: (i: number) => mask[i] === 1,
    summary,
  };
}

/**
 * Traduce las claves medidas (`m:<id>`) de las reglas de filtro al contexto de otro pozo (por rol o mnemónico), para
 * aplicar los mismos filtros al comparar pozos en Distribuciones por zona.
 */
export function translatePlotFilters(from: Pick<SeriesContext, 'well'>, rules: readonly PlotFilterRule[] | undefined, to: Pick<SeriesContext, 'well'>): PlotFilterRule[] | undefined {
  if (!rules || rules.length === 0) return undefined;
  return rules.map((r) => {
    if (!r.curve.startsWith('m:')) return r;
    const c = from.well.curves.find((x) => x.id === r.curve.slice(2));
    if (!c) return r;
    if (to.well.curves.some((x) => x.id === c.id && x.mnemonic === c.mnemonic)) return r;
    const match = (c.role && to.well.curves.find((x) => x.role === c.role)) || to.well.curves.find((x) => x.mnemonic.toUpperCase() === c.mnemonic.toUpperCase());
    return match ? { ...r, curve: `m:${match.id}` } : r;
  });
}

// ── codificación compacta para la clave de series de tendencias del crossplot ───────────────────────────────────

type EncodedRule = [string, PlotFilterOp, number] | [string, 'between', number, number];

/** Codifica las reglas activas en una cadena segura (sin `|`) para incluirlas en la clave de una serie de tendencia. */
export function encodePlotFilters(rules: readonly PlotFilterRule[] | undefined): string {
  if (!rules || rules.length === 0) return '';
  const active = rules
    .filter((r) => r.enabled)
    .map((r): EncodedRule => (r.op === 'between' ? [r.curve, 'between', Math.min(r.value, r.max ?? r.value), Math.max(r.value, r.max ?? r.value)] : [r.curve, r.op, r.value]))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2] - b[2]);
  if (active.length === 0) return '';
  return encodeURIComponent(JSON.stringify(active));
}

/** Decodifica la cadena producida por `encodePlotFilters` a reglas activas (vacío si es inválida). */
export function decodePlotFilters(encoded: string | undefined): PlotFilterRule[] {
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    if (!Array.isArray(parsed)) return [];
    const out: PlotFilterRule[] = [];
    parsed.forEach((item, idx) => {
      if (!Array.isArray(item) || item.length < 3) return;
      const [curve, op, value, max] = item as [unknown, unknown, unknown, unknown];
      if (typeof curve !== 'string' || typeof op !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) return;
      if (op === 'between') {
        if (typeof max !== 'number' || !Number.isFinite(max)) return;
        out.push({ id: `k${idx}`, curve, op, value, max, enabled: true });
      } else if (op === 'le' || op === 'lt' || op === 'ge' || op === 'gt' || op === 'eq' || op === 'neq') {
        out.push({ id: `k${idx}`, curve, op, value, enabled: true });
      }
    });
    return out;
  } catch {
    return [];
  }
}
