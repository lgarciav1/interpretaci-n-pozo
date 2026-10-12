/**
 * Vista «Perfil radial» (docs/decisiones/0020, sección 8): lo puro, sin React ni stores. Qué curvas recibe el módulo
 * `invasion-step` (las mismas que le pasa el motor), los parámetros vigentes en la zona de una profundidad, el ajuste
 * de UNA muestra con `invasionProfileAtDepth`, el estado que se muestra (bueno, dudoso, sin invasión, insuficiente,
 * en el borde de la búsqueda) y la geometría del dibujo (ejes, corte, sensibilidad radial de cada curva).
 *
 * Costo: una muestra son ≈ 90 evaluaciones del modelo con 5 curvas (decenas de µs): se calcula en el hilo principal
 * cada vez que el cursor cambia de muestra, nunca sobre todo el pozo.
 */
import { canonicalCurveData } from '../../core/canonical';
import type { SourceRef } from '../../core/interpretation';
import { resolveModuleParams, type ParamState } from '../../core/params';
import type { RoleCatalog } from '../../core/roles';
import { layoutZones, type Curve, type Zone } from '../../core/well';
import {
  ARRAY_INDUCTION_R50_IN,
  RADIAL_STEEPNESS,
  invasionProfileAtDepth,
  radialGeometricFactor,
  stepProfileReading,
  type InvasionFit,
  type InvasionProfileAtDepth,
} from '../../petro/invasion';
import invasionStep from './index';

export const INVASION_MODULE_ID = 'invasion-step';

/** Salida de curva de un módulo, como la ve la app (`src/app/computed.ts`). */
export interface ComputedCurveLike {
  port: string;
  moduleId: string;
  label: string;
  data: ArrayLike<number>;
}

/** Porcentaje con coma decimal (1 decimal por debajo del 10 %). Sin la interfaz: este archivo es puro. */
export function pctText(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const v = x * 100;
  return `${v.toFixed(Math.abs(x) < 0.1 ? 1 : 0).replace('.', ',')} %`;
}

/** Roles de entrada del módulo, de la lectura más somera a la más profunda. */
export const RADIAL_ROLES = ['RA10', 'RA20', 'RA30', 'RM', 'RT'] as const;
export type RadialRole = (typeof RADIAL_ROLES)[number];

/** Nombre de la herramienta por rol cuando la curva no trae mnemónico propio. */
const ROLE_FALLBACK_LABEL: Readonly<Record<RadialRole, string>> = { RA10: 'AT10', RA20: 'AT20', RA30: 'AT30', RM: 'AT60', RT: 'AT90' };

// ── entradas ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface RadialInput {
  role: RadialRole;
  /** Mnemónico de la curva medida (AT10…) o nombre de la salida que la alimenta. */
  label: string;
  /** Profundidad mediana de investigación radial (in). */
  r50: number;
  /** Resistividad (ohm·m) por muestra, alineada con la profundidad del pozo. */
  data: ArrayLike<number>;
}

/**
 * Curvas que el motor le pasa a `invasion-step`, por rol, con la misma regla que el grafo (`sourceFor`): la fuente
 * elegida del puerto, salvo que sea el propio módulo (su `RT` de salida es alternativa de AT90): entonces la siguiente
 * candidata, primero las curvas medidas con ese rol (en el orden del pozo) y después otros módulos. Sin resultado del
 * motor todavía (`sources` null), la curva medida con ese rol. Los datos van en la unidad canónica del rol (ohm·m).
 */
export function resolveInvasionInputs(
  curves: readonly Pick<Curve, 'id' | 'mnemonic' | 'role' | 'unit' | 'data'>[],
  computed: readonly ComputedCurveLike[],
  sources: Readonly<Record<string, SourceRef>> | null,
  catalog: RoleCatalog,
): RadialInput[] {
  const out: RadialInput[] = [];
  for (const role of RADIAL_ROLES) {
    const r50 = ARRAY_INDUCTION_R50_IN[role]!;
    const fromCurve = (c: (typeof curves)[number]): RadialInput => {
      // Una curva con otro rol elegida a propósito (p. ej. AT60 como RT) se convierte a la unidad del puerto.
      const data = c.role === role ? canonicalCurveData(c, catalog).data : canonicalCurveData({ ...c, role }, catalog).data;
      return { role, label: c.mnemonic || ROLE_FALLBACK_LABEL[role], r50, data };
    };
    const fromModule = (c: ComputedCurveLike): RadialInput => ({ role, label: c.label || ROLE_FALLBACK_LABEL[role], r50, data: c.data });
    const chosen = sources?.[role];
    let input: RadialInput | null = null;
    if (chosen?.kind === 'curve') {
      const c = curves.find((x) => x.id === chosen.curveId);
      if (c) input = fromCurve(c);
    } else if (chosen?.kind === 'module' && chosen.moduleId !== INVASION_MODULE_ID) {
      const c = computed.find((x) => x.port === role && x.moduleId === chosen.moduleId);
      if (c) input = fromModule(c);
    }
    if (!input) {
      const measured = curves.find((c) => c.role === role);
      if (measured) input = fromCurve(measured);
      else {
        const other = computed.find((c) => c.port === role && c.moduleId !== INVASION_MODULE_ID);
        if (other) input = fromModule(other);
      }
    }
    if (input) out.push(input);
  }
  return out;
}

/**
 * Curva de trépano (BS, in) que recibe el módulo, con la misma regla que las resistividades; null si no hay. Donde
 * tiene un valor finito > 0 reemplaza al parámetro «Diámetro del trépano» como cota inferior de di.
 */
export function resolveBitSizeCurve(
  curves: readonly Pick<Curve, 'id' | 'mnemonic' | 'role' | 'unit' | 'data'>[],
  sources: Readonly<Record<string, SourceRef>> | null,
  catalog: RoleCatalog,
): ArrayLike<number> | null {
  const chosen = sources?.BS;
  const c = (chosen?.kind === 'curve' ? curves.find((x) => x.id === chosen.curveId) : undefined) ?? curves.find((x) => x.role === 'BS');
  return c ? canonicalCurveData({ ...c, role: 'BS' }, catalog).data : null;
}

// ── profundidad, zona y parámetros ─────────────────────────────────────────────────────────────────────────────

/** Índice de la muestra más cercana a `d` (profundidad creciente); −1 si no hay muestras o `d` no es finita. */
export function nearestSampleIndex(depth: ArrayLike<number>, d: number): number {
  const n = depth.length;
  if (n === 0 || !Number.isFinite(d)) return -1;
  if (d <= depth[0]!) return 0;
  if (d >= depth[n - 1]!) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (depth[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return d - depth[lo]! <= depth[hi]! - d ? lo : hi;
}

/** Zona de cada muestra con la MISMA regla que el motor (`layoutZones`): devuelve la zona de un índice o null. */
export function zoneLookup(depth: ArrayLike<number>, zones: readonly Zone[]): (i: number) => Zone | null {
  const layout = layoutZones(depth, zones);
  const byId = new Map(zones.map((z) => [z.id, z]));
  return (i) => {
    const j = i >= 0 && i < layout.zoneIndex.length ? layout.zoneIndex[i]! : -1;
    return j < 0 ? null : (byId.get(layout.spans[j]!.id) ?? null);
  };
}

export interface InvasionParams {
  minSeparation: number;
  maxMisfit: number;
  bitSize: number;
}

/** Parámetros vigentes del módulo en una zona (o los globales fuera de zona), resueltos como en el motor. */
export function invasionParamsAt(state: ParamState, zoneId: string | null): InvasionParams {
  const r = resolveModuleParams(INVASION_MODULE_ID, invasionStep.params, state, zoneId ? [zoneId] : []);
  const v = (zoneId ? r.byZone.get(zoneId) : undefined) ?? r.global;
  return { minSeparation: v.minSeparation as number, maxMisfit: v.maxMisfit as number, bitSize: v.bitSize as number };
}

// ── la vista a una profundidad ─────────────────────────────────────────────────────────────────────────────────

/**
 * Ajuste tal como lo muestra la vista (`InvasionFit` del motor, ver su docstring). `status`: 'ok', 'no-invasion',
 * 'insufficient', 'unresolved' (motivo en `reason`) o 'poorly-resolved' (con `diLow`–`diHigh`).
 */
export type ViewFit = InvasionFit;

/** Copia defensiva del ajuste del motor (la vista no modifica lo que devuelve el motor). */
export const readFit = (fit: InvasionFit): ViewFit => ({ ...fit });

export interface RadialReading {
  role: RadialRole;
  label: string;
  r50: number;
  /** Lectura (ohm·m); NaN si no hay dato válido en esta muestra. */
  observed: number;
  /** Lectura del modelo directo con el perfil ajustado; NaN sin ajuste. */
  modelled: number;
  /** observada/modelada − 1; NaN sin ajuste. */
  relativeError: number;
}

/**
 * Estado que muestra la vista:
 * - 'ok' ajuste aceptable · 'doubtful' desajuste mayor que el máximo del módulo;
 * - 'poorly-resolved' contraste débil: di (y Rxo) mal determinados, se muestra el intervalo de di (el módulo deja RXO y
 *   DI sin dato);
 * - 'unresolved' el ajuste quedó en un borde (Rxo y di sin dato; Rt = lectura más profunda);
 * - 'no-invasion' las curvas difieren menos que la separación mínima · 'insufficient' menos de 3 lecturas válidas.
 */
export type RadialStatus = 'ok' | 'doubtful' | 'poorly-resolved' | 'unresolved' | 'no-invasion' | 'insufficient';

export interface RadialView {
  index: number;
  depth: number;
  params: InvasionParams;
  /** Todas las curvas de entrada (también las sin dato en esta muestra), de somera a profunda. */
  readings: RadialReading[];
  profile: InvasionProfileAtDepth;
  fit: ViewFit;
  status: RadialStatus;
  /** di en una cota de la búsqueda ('min' = trépano, 'max' = máximo buscado). */
  bound: 'min' | 'max' | null;
  /** Trépano usado como cota inferior de di (in): la curva BS en la muestra o el parámetro del módulo. */
  bitSize: number;
  bitFrom: 'curve' | 'param';
  /** Radio del pozo que se dibuja (in): caliper/2 si hay caliper válido, si no trépano/2. */
  holeRadius: number;
  holeFrom: 'caliper' | 'bit';
  /** Radio de invasión ri = di/2 (in); NaN si el frente no se puede ubicar. */
  invasionRadius: number;
  /** Intervalo del radio de invasión (in) para la banda de incertidumbre; NaN si no hay. */
  invasionRadiusLow: number;
  invasionRadiusHigh: number;
}

/** ¿El estado tiene un frente de invasión que dibujar (di con valor)? */
const hasFront = (s: RadialStatus) => s === 'ok' || s === 'doubtful' || s === 'poorly-resolved';

export function viewStatus(f: ViewFit, maxMisfit: number): RadialStatus {
  return f.status === 'ok' ? (f.misfit > maxMisfit ? 'doubtful' : 'ok') : f.status;
}

const validIn = (x: number | undefined): x is number => typeof x === 'number' && x > 0 && x < 60;

/**
 * Ajuste de UNA muestra con los parámetros de su zona, como el módulo: trépano = curva BS en la muestra si tiene
 * dato (`bitIn`), si no el parámetro. `caliperIn`: diámetro del pozo medido (in), solo para dibujar el pozo.
 */
export function radialViewAt(
  inputs: readonly RadialInput[],
  index: number,
  depth: number,
  params: InvasionParams,
  extra: { caliperIn?: number; bitIn?: number } = {},
): RadialView {
  const bitFrom = validIn(extra.bitIn) ? 'curve' : 'param';
  const bitSize = bitFrom === 'curve' ? extra.bitIn! : params.bitSize;
  const raw = inputs.map((c) => {
    const v = c.data[index];
    return { c, v: typeof v === 'number' && v > 0 && v < Infinity ? v : NaN };
  });
  const profile = invasionProfileAtDepth(
    raw.map(({ c, v }) => ({ label: c.label, r50: c.r50, resistivity: v })),
    { bitSize, minSeparation: params.minSeparation },
  );
  const fit = readFit(profile.fit);
  const status = viewStatus(fit, params.maxMisfit);
  // Lecturas modeladas: las del motor (mismo perfil interno), emparejadas por profundidad de investigación.
  const modelledByR50 = new Map(profile.readings.map((r) => [r.r50, r.modelled]));
  const readings: RadialReading[] = raw
    .map(({ c, v }) => {
      const m = Number.isFinite(v) ? (modelledByR50.get(c.r50) ?? NaN) : NaN;
      const modelled = Number.isFinite(m) && m > 0 ? m : NaN;
      return { role: c.role, label: c.label, r50: c.r50, observed: v, modelled, relativeError: Number.isFinite(modelled) ? v / modelled - 1 : NaN };
    })
    .sort((a, b) => a.r50 - b.r50);
  const caliperOk = validIn(extra.caliperIn);
  const front = hasFront(status) && Number.isFinite(fit.di);
  const lo = Number.isFinite(fit.diLow) ? fit.diLow / 2 : NaN;
  const hi = Number.isFinite(fit.diHigh) ? fit.diHigh / 2 : NaN;
  return {
    index,
    depth,
    params,
    readings,
    profile,
    fit,
    status,
    bound: hasFront(status) ? fit.atBound : null,
    bitSize,
    bitFrom,
    holeRadius: caliperOk ? extra.caliperIn! / 2 : profile.holeRadius,
    holeFrom: caliperOk ? 'caliper' : 'bit',
    invasionRadius: front ? fit.di / 2 : NaN,
    invasionRadiusLow: front && hi > lo ? lo : NaN,
    invasionRadiusHigh: front && hi > lo ? hi : NaN,
  };
}

export interface StatusText {
  tone: 'ok' | 'warn' | 'info' | 'neutral';
  title: string;
  detail: string;
}

const REASON_TEXT: Readonly<Record<string, string>> = {
  deep: 'queda más allá del máximo buscado, fuera de lo que resuelve la curva más profunda',
  shallow: 'queda pegado a la pared del pozo (la invasión es más somera de lo que resuelve la herramienta)',
  sigma: 'la resistividad de la formación quedó en el límite de la búsqueda',
};

/** Textos del estado (sin ecuaciones). */
export function statusText(v: Pick<RadialView, 'status' | 'bound' | 'params' | 'fit'>): StatusText {
  const pct = pctText;
  const f = v.fit;
  switch (v.status) {
    case 'insufficient':
      return {
        tone: 'warn',
        title: 'Datos insuficientes',
        detail: `Hay ${f.nCurves} lectura${f.nCurves === 1 ? '' : 's'} válida${f.nCurves === 1 ? '' : 's'} a esta profundidad y se necesitan al menos 3 para ajustar Rxo, di y Rt.`,
      };
    case 'no-invasion':
      return {
        tone: 'info',
        title: 'Sin invasión visible',
        detail: `Las curvas difieren ${pct(f.separation)}, menos que la separación mínima (${pct(v.params.minSeparation)}): el diámetro de invasión no se puede estimar y Rt es la lectura más profunda.`,
      };
    case 'unresolved': {
      const why = (f.reason && REASON_TEXT[f.reason]) ?? 'el ajuste quedó en un borde de la búsqueda';
      return { tone: 'warn', title: 'Invasión no resuelta', detail: `No se pudo ubicar el frente de invasión: ${why}. Rxo y di quedan sin dato y Rt es la lectura más profunda.` };
    }
    case 'poorly-resolved':
      return {
        tone: 'warn',
        title: 'di mal determinado',
        detail: 'El contraste entre las curvas es débil: varios diámetros de invasión reproducen las lecturas casi igual. La banda muestra el intervalo plausible; el módulo deja Rxo y di sin dato en esta muestra y Rt es la más confiable.',
      };
    case 'doubtful':
      return {
        tone: 'warn',
        title: 'Ajuste dudoso',
        detail: `El perfil escalonado se aparta ${pct(f.misfit)} de las lecturas (máximo aceptable ${pct(v.params.maxMisfit)}): alguna curva puede tener un pico o no ser coherente con una invasión escalonada. Rxo, di y Rt de esta muestra no son confiables.`,
      };
    default:
      if (f.rxoAtBound) {
        return { tone: 'warn', title: 'Rxo fuera de rango', detail: 'La resistividad de la zona lavada quedó en el límite de la búsqueda: queda sin dato. El diámetro de invasión y Rt sí son válidos.' };
      }
      if (v.bound === 'min') {
        return { tone: 'warn', title: 'di en el trépano', detail: 'La invasión es más somera de lo que resuelve la herramienta: el diámetro quedó en el mínimo (el trépano) y Rxo está poco determinada.' };
      }
      if (v.bound === 'max') {
        return { tone: 'warn', title: 'di en el máximo', detail: 'El ajuste pide una invasión más profunda que el máximo buscado: la Rt de esta muestra está poco determinada.' };
      }
      return { tone: 'ok', title: 'Ajuste bueno', detail: `El perfil escalonado reproduce las lecturas con un desajuste de ${pct(f.misfit)}.` };
  }
}

// ── geometría del dibujo ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Rango del eje radial (in): distancia al eje del pozo, logarítmico de 2 a 200 in. Fijo (no salta al mover el cursor):
 * contiene el pozo (≈ 4 in de radio), las cinco medianas (10–90 in) y el máximo radio de invasión buscado (150 in).
 */
export const RADIAL_RANGE = { min: 2, max: 200 } as const;
type RRange = { readonly min: number; readonly max: number };

/**
 * Sensibilidad radial relativa de una curva: dJ/d(ln r) normalizada a 1 en su mediana. Con J logística en ln r es
 * 4·J·(1 − J): una campana simétrica en escala log centrada en r50. El área bajo la campana (en ln r) entre dos radios
 * es la fracción de la señal que viene de ese anillo.
 */
export function radialSensitivity(r: number, r50: number, steepness: number = RADIAL_STEEPNESS): number {
  const j = radialGeometricFactor(r, r50, steepness);
  return Number.isFinite(j) ? 4 * j * (1 - j) : NaN;
}

/** Muestras de la campana en una grilla logarítmica del eje radial. */
export function sensitivityCurve(r50: number, axis: RRange = RADIAL_RANGE, n = 96): { r: Float64Array; s: Float64Array } {
  const r = new Float64Array(n);
  const s = new Float64Array(n);
  const l0 = Math.log(axis.min);
  const dl = (Math.log(axis.max) - l0) / (n - 1);
  for (let i = 0; i < n; i++) {
    r[i] = Math.exp(l0 + i * dl);
    s[i] = radialSensitivity(r[i]!, r50);
  }
  return { r, s };
}

/**
 * Perfil escalonado como polilínea (x en in, y en ohm·m): Rxo desde la pared del pozo hasta ri, salto y Rt hasta el
 * borde del eje. Rxo sin dato (en la cota): solo el tramo de Rt desde el frente. Sin frente (sin invasión visible, no
 * resuelta): Rt desde la pared. Sin Rt: vacía. `dashed`: Rt sin frente (indeterminado), se dibuja rayado.
 */
export function stepPolyline(v: Pick<RadialView, 'fit' | 'holeRadius' | 'invasionRadius'>, axis: RRange = RADIAL_RANGE): { x: number[]; y: number[]; dashed: boolean } {
  const { fit } = v;
  const wall = v.holeRadius;
  if (!Number.isFinite(fit.rt) || !(fit.rt > 0)) return { x: [], y: [], dashed: false };
  if (Number.isFinite(v.invasionRadius)) {
    const ri = Math.max(v.invasionRadius, wall);
    if (Number.isFinite(fit.rxo) && fit.rxo > 0) return { x: [wall, ri, ri, axis.max], y: [fit.rxo, fit.rxo, fit.rt, fit.rt], dashed: false };
    return { x: [ri, axis.max], y: [fit.rt, fit.rt], dashed: false };
  }
  return { x: [wall, axis.max], y: [fit.rt, fit.rt], dashed: true };
}

/**
 * Lectura que daría una curva según su profundidad mediana de investigación sobre el perfil ajustado (línea de guía
 * por donde pasan las lecturas modeladas). Vacía si falta Rxo, di o Rt.
 */
export function apparentCurve(v: Pick<RadialView, 'fit' | 'invasionRadius'>, axis: RRange = RADIAL_RANGE, n = 64): { x: Float64Array; y: Float64Array } {
  const { fit } = v;
  if (![fit.rxo, fit.rt, v.invasionRadius].every((x) => Number.isFinite(x) && x > 0)) return { x: new Float64Array(0), y: new Float64Array(0) };
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const l0 = Math.log(axis.min);
  const dl = (Math.log(axis.max) - l0) / (n - 1);
  for (let i = 0; i < n; i++) {
    x[i] = Math.exp(l0 + i * dl);
    y[i] = stepProfileReading(2 * v.invasionRadius, fit.rxo, fit.rt, x[i]!);
  }
  return { x, y };
}

export interface CorteBand {
  kind: 'borehole' | 'flushed' | 'virgin';
  /** Radios (in), recortados al eje radial. */
  from: number;
  to: number;
}

/**
 * Bandas del corte esquemático: pozo (hasta la pared), zona lavada (hasta ri) y formación virgen (hasta el borde),
 * recortadas al eje. Sin ajuste: pozo y formación (no se sabe dónde está el frente). Una banda de ancho nulo no va.
 */
export function corteBands(v: Pick<RadialView, 'holeRadius' | 'invasionRadius'>, axis: RRange = RADIAL_RANGE): CorteBand[] {
  const clip = (r: number) => Math.min(axis.max, Math.max(axis.min, r));
  const wall = clip(v.holeRadius);
  const out: CorteBand[] = [{ kind: 'borehole', from: axis.min, to: wall }];
  if (Number.isFinite(v.invasionRadius) && v.invasionRadius > v.holeRadius) {
    const ri = clip(v.invasionRadius);
    out.push({ kind: 'flushed', from: wall, to: ri });
    out.push({ kind: 'virgin', from: ri, to: axis.max });
  } else out.push({ kind: 'virgin', from: wall, to: axis.max });
  return out.filter((b) => b.to > b.from);
}

