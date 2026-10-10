/**
 * Presiones MDT: modelo puro del módulo (docs/decisiones/0009-presiones-mdt-y-conjuntos-de-puntos.md).
 *
 * - Ids que se guardan en el proyecto (proveedor de series, superposición, claves de serie): no cambiarlos.
 * - Fluidos y su lectura (gas, petróleo, agua), con los colores de convención (gas rojo, petróleo verde, agua azul).
 * - Reglas de calidad: proponen descartar un punto (prueba seca, tight, sobrecargada, sello perdido, inestable,
 *   movilidad baja, presión de formación ≥ presión del lodo, sin presión). La decisión final es del usuario y va en
 *   la interpretación (`Interpretation.pointSets[conjunto].points[punto].status`).
 * - Contactos: intersección de gradientes de fluidos contiguos (CGP, CAP/FWL, CGA), con su verificación.
 *
 * Sin React ni stores ni `src/plots`: lo importan el proveedor de series, la superposición y el panel.
 */
import { pointNumbers, pointTexts, type PointSet, type PointSetDecisions } from '../../core/pointSets';
import { convert } from '../../core/units';
import { evalTrend, intersectTrends, trendSlopeAt, type TrendCoefficients } from '../../petro/regression';
import type { FluidKind } from '../../petro/pressure';

export const MDT_PROVIDER_ID = 'mdt';
export const MDT_OVERLAY_ID = 'mdt';
export const MDT_POINTS_OVERLAY_ID = 'mdt-points';
export const PRESSURE_KIND = 'pressure';

/** Unidades en que se muestra la pista y el panel (los datos están en psi). */
export const DISPLAY_UNITS = ['psi', 'bar', 'kPa', 'kgf/cm2'] as const;
export type DisplayUnit = (typeof DISPLAY_UNITS)[number];
export const DEFAULT_DISPLAY_UNIT: DisplayUnit = 'psi';

export type Fluid = FluidKind;
export const FLUIDS: readonly Fluid[] = ['gas', 'oil', 'water'];
export const FLUID_LABEL: Readonly<Record<Fluid, string>> = { gas: 'Gas', oil: 'Petróleo', water: 'Agua' };
/** Colores de convención (gas rojo, petróleo verde, agua azul), por tema. La superposición asegura el contraste. */
export const FLUID_COLOR: Readonly<Record<'light' | 'dark', Readonly<Record<Fluid, string>>>> = {
  light: { gas: '#d6336c', oil: '#2b8a3e', water: '#1c6fd1' },
  dark: { gas: '#ff6b8f', oil: '#5fd07a', water: '#5aa9ff' },
};

export const isFluid = (v: unknown): v is Fluid => v === 'gas' || v === 'oil' || v === 'water';

// ── claves de serie: `<conjunto>` (todos los puntos incluidos) o `<conjunto>:<fluido>` (gradiente de ese fluido) ──

export function mdtSeriesKey(setId: string, fluid?: Fluid | null): string {
  return fluid ? `${setId}:${fluid}` : setId;
}

export function parseMdtSeriesKey(key: string): { setId: string; fluid: Fluid | null } {
  const k = key.lastIndexOf(':');
  if (k > 0) {
    const f = key.slice(k + 1);
    if (isFluid(f)) return { setId: key.slice(0, k), fluid: f };
  }
  return { setId: key, fluid: null };
}

export const pressureSets = (sets: readonly PointSet[]): PointSet[] => sets.filter((s) => s.kind === PRESSURE_KIND);

// ── calidad ─────────────────────────────────────────────────────────────────────────────────────────────────

export type QualityReason = 'noPressure' | 'dry' | 'tight' | 'supercharged' | 'lostSeal' | 'unstable' | 'lowMobility' | 'overMud';

export const QUALITY_REASON_LABEL: Readonly<Record<QualityReason, string>> = {
  noPressure: 'sin presión',
  dry: 'prueba seca',
  tight: 'tight (baja permeabilidad)',
  supercharged: 'sobrecargada',
  lostSeal: 'sello perdido',
  unstable: 'presión inestable',
  lowMobility: 'movilidad baja',
  overMud: 'presión ≥ lodo (posible sobrecarga)',
};

/** Movilidad mínima por defecto (mD/cP): por debajo, la presión puede no estar estabilizada o estar sobrecargada. */
export const DEFAULT_MIN_MOBILITY = 1;
export const MIN_MOBILITY_SETTING = 'minMobility';

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Lo que dice el texto de calidad, tipo o comentario de una prueba: un motivo para descartarla, 'good' si dice que
 * es válida, o null si no dice nada reconocible. Español e inglés (planillas de servicio).
 */
export function qualityFromText(text: string | undefined): QualityReason | 'good' | null {
  if (!text) return null;
  const t = strip(text);
  if (/\b(dry|seca|seco|sin flujo|no flow|no ?inflow)\b/.test(t)) return 'dry';
  if (/(super ?charg|sobre ?carg|sobrepresion por invasion)/.test(t)) return 'supercharged';
  if (/(lost seal|no seal|seal fail|sin sello|perdida de sello|sello perdido|perdio sello)/.test(t)) return 'lostSeal';
  if (/\b(tight|apretad[ao]|baja permeabilidad|baja perm)\b/.test(t)) return 'tight';
  if (/(unstab|inestab|no estabiliz|not stabil|sin estabilizar)/.test(t)) return 'unstable';
  if (/\b(good|buena|bueno|valid[ao]?|ok|normal|confiable)\b/.test(t)) return 'good';
  return null;
}

export interface PointQuality {
  /** Motivos para descartar (vacío = la regla no tiene objeciones). */
  reasons: QualityReason[];
  /** La propuesta automática: descartar si hay algún motivo. */
  proposeExclude: boolean;
}

const unitOf = (set: PointSet, key: string): string | undefined => {
  const c = set.columns[key];
  return c && 'unit' in c ? c.unit : undefined;
};

/** Valor convertido de `from` a `to` (sin cambios si falta una unidad o no son convertibles). */
function toUnit(value: number, from: string | undefined, to: string | undefined): number {
  if (!from || !to || from === to) return value;
  try {
    return convert(value, from, to);
  } catch {
    return value;
  }
}

/** Reglas automáticas sobre cada punto de un conjunto de presiones (proponen; decide el usuario). */
export function assessQuality(set: PointSet, minMobility: number = DEFAULT_MIN_MOBILITY): PointQuality[] {
  const n = set.depth.length;
  const p = pointNumbers(set, 'pressure');
  const mob = pointNumbers(set, 'mobility');
  const mudB = pointNumbers(set, 'mudBefore');
  const mudA = pointNumbers(set, 'mudAfter');
  // La presión del lodo se compara en la unidad de la presión de formación (las columnas pueden venir en unidades distintas).
  const pUnit = unitOf(set, 'pressure');
  const mudUnitB = unitOf(set, 'mudBefore');
  const mudUnitA = unitOf(set, 'mudAfter');
  const texts = ['quality', 'testType', 'comment'].map((k) => pointTexts(set, k));
  const out: PointQuality[] = [];
  for (let i = 0; i < n; i++) {
    const reasons: QualityReason[] = [];
    const pi = p ? p[i]! : NaN;
    if (!Number.isFinite(pi)) reasons.push('noPressure');
    for (const col of texts) {
      const q = qualityFromText(col?.[i]);
      if (q && q !== 'good' && !reasons.includes(q)) reasons.push(q);
    }
    const m = mob ? mob[i]! : NaN;
    if (Number.isFinite(m) && Number.isFinite(minMobility) && m < minMobility) reasons.push('lowMobility');
    const mud = mudB && Number.isFinite(mudB[i]!) ? toUnit(mudB[i]!, mudUnitB, pUnit) : mudA ? toUnit(mudA[i]!, mudUnitA, pUnit) : NaN;
    if (Number.isFinite(pi) && Number.isFinite(mud) && pi >= mud) reasons.push('overMud');
    out.push({ reasons, proposeExclude: reasons.length > 0 });
  }
  return out;
}

export interface PointStatus {
  /** Entra en los ajustes (gradientes). */
  included: boolean;
  /** El usuario decidió (si no, manda la propuesta). */
  decided: 'include' | 'exclude' | null;
  quality: PointQuality;
}

const statusCache = new WeakMap<PointSet, WeakMap<object, PointStatus[]>>();
const NO_DECISIONS: PointSetDecisions = { points: {} };

/** Movilidad mínima elegida para un conjunto (o la de fábrica). */
export function minMobilityOf(decisions: PointSetDecisions | undefined): number {
  const v = decisions?.settings?.[MIN_MOBILITY_SETTING];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_MOBILITY;
}

/** Estado efectivo de cada punto: la decisión del usuario o, si no hay, la propuesta. Caché por identidad. */
export function pointStatuses(set: PointSet, decisions: PointSetDecisions | undefined): PointStatus[] {
  const d = decisions ?? NO_DECISIONS;
  let byDec = statusCache.get(set);
  if (!byDec) statusCache.set(set, (byDec = new WeakMap()));
  let out = byDec.get(d);
  if (!out) {
    const q = assessQuality(set, minMobilityOf(d));
    out = set.pointIds.map((id, i) => {
      const decided = d.points[id]?.status ?? null;
      const quality = q[i]!;
      const hasP = !quality.reasons.includes('noPressure');
      return { included: hasP && (decided ? decided === 'include' : !quality.proposeExclude), decided, quality };
    });
    byDec.set(d, out);
  }
  return out;
}

/**
 * Decisión que deja un punto incluido o descartado: si coincide con la propuesta, se borra la decisión (null), así
 * la interpretación guarda solo lo que el usuario cambió.
 */
export function decisionFor(quality: PointQuality, include: boolean): { status: 'include' | 'exclude' } | null {
  return include === !quality.proposeExclude ? null : { status: include ? 'include' : 'exclude' };
}

// ── contactos ───────────────────────────────────────────────────────────────────────────────────────────────

export interface GradientLine {
  id: string;
  name: string;
  fluid: Fluid | null;
  coeffs: TrendCoefficients;
  /** Tramo de profundidad ajustado (m): del primer al último punto usado. */
  span: [number, number];
}

export type ContactKind = 'GOC' | 'OWC' | 'GWC';

export const CONTACT_LABEL: Readonly<Record<ContactKind, { short: string; long: string }>> = {
  GOC: { short: 'CGP', long: 'Contacto gas–petróleo' },
  OWC: { short: 'CAP', long: 'Contacto agua–petróleo (nivel de agua libre)' },
  GWC: { short: 'CGA', long: 'Contacto gas–agua (nivel de agua libre)' },
};

export interface FluidContact {
  kind: ContactKind;
  /** Gradiente del fluido liviano (arriba) y del pesado (abajo). */
  upper: GradientLine;
  lower: GradientLine;
  /** Profundidad (m) y presión (unidad de la serie) del corte; null si no se cortan dentro del rango razonable. */
  depth: number | null;
  pressure: number | null;
  /** Por qué no hay contacto (null si lo hay). */
  problem: string | null;
  /** Hay contacto pero conviene revisarlo (cae entre los puntos de uno de los fluidos). */
  warning: string | null;
}

const ORDER: Record<Fluid, number> = { gas: 0, oil: 1, water: 2 };
/** Margen (m) fuera del tramo de puntos dentro del cual un corte se acepta como contacto. */
export const CONTACT_MARGIN_M = 30;

const m1 = (v: number) => v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function contactKind(a: Fluid, b: Fluid): ContactKind {
  if (a === 'gas' && b === 'oil') return 'GOC';
  if (a === 'gas' && b === 'water') return 'GWC';
  return 'OWC';
}

/**
 * Contactos entre gradientes de fluidos CONTIGUOS: se ordenan los gradientes con fluido por la profundidad media de
 * su tramo y cada par consecutivo de fluidos distintos da un contacto (gas–petróleo → CGP; petróleo–agua → CAP, que
 * por presiones es el nivel de agua libre; gas–agua sin petróleo entre medio → CGA).
 *
 * Rango razonable: desde CONTACT_MARGIN_M por encima del tope del gradiente de arriba hasta CONTACT_MARGIN_M por
 * debajo de la base del de abajo. Fuera de ese rango (o rectas paralelas, o el fluido liviano debajo del pesado) no
 * hay contacto y `problem` lo explica. Si el corte cae dentro de los puntos de uno de los dos fluidos (y no en el
 * hueco entre ambos), hay contacto con `warning`.
 */
export function findContacts(gradients: readonly GradientLine[]): FluidContact[] {
  const list = gradients.filter((g) => g.fluid && Number.isFinite(g.span[0]) && Number.isFinite(g.span[1])).sort((a, b) => a.span[0] + a.span[1] - (b.span[0] + b.span[1]));
  const out: FluidContact[] = [];
  for (let k = 0; k + 1 < list.length; k++) {
    const up = list[k]!;
    const lo = list[k + 1]!;
    const fa = up.fluid!;
    const fb = lo.fluid!;
    if (fa === fb) continue;
    if (ORDER[fa] > ORDER[fb]) {
      out.push({
        kind: contactKind(fb, fa),
        upper: up,
        lower: lo,
        depth: null,
        pressure: null,
        problem: `El gradiente de ${FLUID_LABEL[fa].toLowerCase()} («${up.name}») está por encima del de ${FLUID_LABEL[fb].toLowerCase()} («${lo.name}»): un fluido más denso no puede estar arriba. Revisá el fluido de cada gradiente o sus tramos.`,
        warning: null,
      });
      continue;
    }
    const kind = contactKind(fa, fb);
    const lowLim = up.span[0] - CONTACT_MARGIN_M;
    const highLim = lo.span[1] + CONTACT_MARGIN_M;
    const z = intersectTrends(up.coeffs, lo.coeffs, up.coeffs.model === lo.coeffs.model ? undefined : [lowLim, highLim]);
    const range = `entre ${m1(lowLim)} y ${m1(highLim)} m`;
    if (z === null || !Number.isFinite(z)) {
      const mixed = up.coeffs.model !== lo.coeffs.model;
      out.push({
        kind,
        upper: up,
        lower: lo,
        depth: null,
        pressure: null,
        problem: mixed ? `Los gradientes «${up.name}» y «${lo.name}» no se cortan ${range}.` : `Los gradientes «${up.name}» y «${lo.name}» no se cortan (son paralelos).`,
        warning: null,
      });
      continue;
    }
    if (z < lowLim || z > highLim) {
      out.push({
        kind,
        upper: up,
        lower: lo,
        depth: null,
        pressure: null,
        problem: `Los gradientes «${up.name}» y «${lo.name}» se cortan a ${m1(z)} m, fuera del rango razonable (${range}). Revisá los tramos o los puntos de cada uno.`,
        warning: null,
      });
      continue;
    }
    // El fluido pesado debe tener MAYOR gradiente que el liviano en el corte: si no, las rectas se cruzan pero la
    // columna es físicamente imposible (p. ej. «petróleo» de 0,45 psi/ft sobre «agua» de 0,33).
    const sUp = trendSlopeAt(up.coeffs, z);
    const sLo = trendSlopeAt(lo.coeffs, z);
    if (Number.isFinite(sUp) && Number.isFinite(sLo) && sUp >= sLo) {
      out.push({
        kind,
        upper: up,
        lower: lo,
        depth: null,
        pressure: null,
        problem: `El gradiente de ${FLUID_LABEL[fa].toLowerCase()} («${up.name}») es mayor o igual que el de ${FLUID_LABEL[fb].toLowerCase()} («${lo.name}») en el corte: un fluido más liviano no puede tener más gradiente que el más denso. Revisá el fluido de cada gradiente o los puntos usados.`,
        warning: null,
      });
      continue;
    }
    let warning: string | null = null;
    const pair = `debería quedar entre el último punto de ${FLUID_LABEL[fa].toLowerCase()} y el primero de ${FLUID_LABEL[fb].toLowerCase()}`;
    if (z < up.span[0]) warning = `El contacto cae por encima de todos los puntos de ${FLUID_LABEL[fa].toLowerCase()} (su tope está a ${m1(up.span[0])} m): ${pair}.`;
    else if (z > lo.span[1]) warning = `El contacto cae por debajo de todos los puntos de ${FLUID_LABEL[fb].toLowerCase()} (su base está a ${m1(lo.span[1])} m): ${pair}.`;
    else if (z < up.span[1]) warning = `El contacto cae dentro de los puntos de ${FLUID_LABEL[fa].toLowerCase()} (su base está a ${m1(up.span[1])} m): ${pair}.`;
    else if (z > lo.span[0]) warning = `El contacto cae dentro de los puntos de ${FLUID_LABEL[fb].toLowerCase()} (su tope está a ${m1(lo.span[0])} m): ${pair}.`;
    out.push({ kind, upper: up, lower: lo, depth: z, pressure: evalTrend(up.coeffs, z), problem: null, warning });
  }
  return out;
}
