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
import { pointNumbers, pointTexts, shiftedDepth, type PointSet, type PointSetDecisions } from '../../core/pointSets';
import { conversionCoefficients, convert } from '../../core/units';
import { evalTrend, fitTrend, intersectTrends, trendSlopeAt, type TrendCoefficients } from '../../petro/regression';
import {
  EMW_UNITS,
  HYDROSTATIC_NORMAL_DENSITY,
  densityFromPsiPerM,
  densityToLbPerGal,
  equivalentMudWeight,
  excessPressure,
  isCompartmentalizedDensity,
  pressureFromEmw,
  pressureFromExcess,
  psiPerMFromDensity,
  type EmwUnit,
  type ExcessPressureRef,
  type FluidKind,
} from '../../petro/pressure';

export const MDT_PROVIDER_ID = 'mdt';
export const MDT_OVERLAY_ID = 'mdt';
export const MDT_POINTS_OVERLAY_ID = 'mdt-points';
export const PRESSURE_KIND = 'pressure';

/** Unidades en que se muestra la pista y el panel (los datos están en psi). */
export const DISPLAY_UNITS = ['psi', 'bar', 'kPa', 'kgf/cm2'] as const;
export type DisplayUnit = (typeof DISPLAY_UNITS)[number];
export const DEFAULT_DISPLAY_UNIT: DisplayUnit = 'psi';

/** Modos del eje X de la pista y panel MDT (docs/decisiones/0089). */
export const MDT_AXIS_MODES = ['pressure', 'excess', 'emw'] as const;
export type MdtAxisMode = (typeof MDT_AXIS_MODES)[number];
export const DEFAULT_AXIS_MODE: MdtAxisMode = 'pressure';
export const DEFAULT_EMW_UNIT: EmwUnit = 'lb/gal';
export const EXCESS_RHO_MIN = 0;
export const EXCESS_RHO_MAX = 3;
export type ExcessRhoSource = 'manual' | 'water';
export type ExcessAnchor = 'first' | 'zero';

export interface MdtAxisSettings {
  axisMode: MdtAxisMode;
  unit: DisplayUnit;
  emwUnit: EmwUnit;
  /** Densidad de referencia manual ρ_ref (g/cm³). */
  excessRhoRef: number;
  /** 'manual' = usa `excessRhoRef`; 'water' = sigue el gradiente de agua activo (respaldo: `excessRhoRef`). */
  excessRhoSource: ExcessRhoSource;
  /** Profundidad de referencia z₀ (m), o null para tomar el tope automático de las pruebas incluidas. */
  excessZ0: number | null;
  /** 'first' = ancla P₀ a la presión de la primera prueba incluida (centra en 0); 'zero' = P₀ = 0. */
  excessAnchor: ExcessAnchor;
}

export function asDisplayUnit(unit: unknown): DisplayUnit {
  return (DISPLAY_UNITS as readonly unknown[]).includes(unit) ? (unit as DisplayUnit) : DEFAULT_DISPLAY_UNIT;
}

export function asEmwUnit(unit: unknown): EmwUnit {
  return (EMW_UNITS as readonly unknown[]).includes(unit) ? (unit as EmwUnit) : DEFAULT_EMW_UNIT;
}

/** Lee y sanea los ajustes de visualización del eje X MDT guardados en `project.display.overlays.mdt`. */
export function parseMdtAxisSettings(settings: Readonly<Record<string, unknown>> | undefined): MdtAxisSettings {
  const modeRaw = settings?.['axisMode'];
  const axisMode: MdtAxisMode = (MDT_AXIS_MODES as readonly unknown[]).includes(modeRaw) ? (modeRaw as MdtAxisMode) : DEFAULT_AXIS_MODE;
  const unit = asDisplayUnit(settings?.['unit']);
  const emwUnit = asEmwUnit(settings?.['emwUnit']);
  const rhoRaw = settings?.['excessRhoRef'];
  const excessRhoRef =
    typeof rhoRaw === 'number' && Number.isFinite(rhoRaw) && rhoRaw >= EXCESS_RHO_MIN && rhoRaw <= EXCESS_RHO_MAX
      ? rhoRaw
      : HYDROSTATIC_NORMAL_DENSITY;
  const excessRhoSource: ExcessRhoSource = settings?.['excessRhoSource'] === 'water' ? 'water' : 'manual';
  const z0Raw = settings?.['excessZ0'];
  const excessZ0 = typeof z0Raw === 'number' && Number.isFinite(z0Raw) ? z0Raw : null;
  const excessAnchor: ExcessAnchor = settings?.['excessAnchor'] === 'zero' ? 'zero' : 'first';
  return { axisMode, unit, emwUnit, excessRhoRef, excessRhoSource, excessZ0, excessAnchor };
}

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
  /** Unidad de presión de los coeficientes (por defecto 'psi'). */
  pressureUnit?: string;
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
  /** Unidad de `pressure` (por defecto 'psi'). */
  pressureUnit?: string;
  /** Por qué no hay contacto (null si lo hay). */
  problem: string | null;
  /** Hay contacto pero conviene revisarlo (cae entre los puntos de uno de los fluidos). */
  warning: string | null;
}

/** Presión de un contacto convertida a psi (NaN si el contacto no tiene presión válida). */
export function contactPressurePsi(contact: Pick<FluidContact, 'pressure' | 'pressureUnit'>): number {
  if (contact.pressure === null || !Number.isFinite(contact.pressure)) return NaN;
  return toUnit(contact.pressure, contact.pressureUnit ?? 'psi', 'psi');
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
    const pressureUnit = up.pressureUnit ?? lo.pressureUnit;
    out.push({
      kind,
      upper: up,
      lower: lo,
      depth: z,
      pressure: evalTrend(up.coeffs, z),
      ...(pressureUnit ? { pressureUnit } : {}),
      problem: null,
      warning,
    });
  }
  return out;
}

// ── exceso de presión, EMW y diagnóstico zonal (docs/decisiones/0089) ────────────────────────────────────────

export interface ResolvedExcessReference {
  /** Parámetros exactos usados en `excessPressure` (presión siempre en psi, profundidad en m, ρ_ref en g/cm³). */
  ref: ExcessPressureRef;
  /** Profundidad de la prueba incluida más somera (m), o null si no hay pruebas válidas. */
  z0Auto: number | null;
  /** Presión de la prueba incluida más somera (psi), o null si no hay pruebas válidas. */
  p0First: number | null;
  /** Fuente efectiva de ρ_ref ('water' si siguió un gradiente de agua activo válido; 'manual' en otro caso). */
  rhoSource: ExcessRhoSource;
  /** Densidad del gradiente de agua activo (g/cm³), si existe y es positiva. */
  waterDensity: number | null;
  /** true si el usuario pidió seguir el gradiente de agua pero actualmente no hay ninguno válido activo. */
  hasActiveWaterFallback: boolean;
}

function pressureInPsi(set: PointSet, rawValue: number): number {
  return toUnit(rawValue, unitOf(set, 'pressure'), 'psi');
}

/**
 * Resuelve la referencia efectiva (ρ_ref, z₀, P₀) para exceso de presión a partir de las pruebas MDT, decisiones del
 * usuario, ajustes de visualización y densidad opcional del gradiente de agua activo. Puro.
 */
export function resolveExcessRef(
  sets: readonly PointSet[],
  pointDecisions: Readonly<Record<string, PointSetDecisions>> | undefined,
  settings: MdtAxisSettings,
  activeWaterDensity?: number | null,
): ResolvedExcessReference {
  let zInc = Infinity;
  let pInc = NaN;
  let zFallback = Infinity;
  let pFallback = NaN;
  let zAny = Infinity;
  let pAny = NaN;
  for (const set of sets) {
    const p = pointNumbers(set, 'pressure');
    if (!p) continue;
    const dec = pointDecisions?.[set.id];
    const st = pointStatuses(set, dec);
    const z = shiftedDepth(set, dec);
    for (let i = 0; i < p.length; i++) {
      const zi = z[i]!;
      const pi = pressureInPsi(set, p[i]!);
      if (!Number.isFinite(zi) || !Number.isFinite(pi)) continue;
      if (zi < zAny) {
        zAny = zi;
        pAny = pi;
      }
      const bad = st[i]!.quality.reasons.some((r) => r === 'dry' || r === 'lostSeal' || r === 'unstable');
      if (!bad && zi < zFallback) {
        zFallback = zi;
        pFallback = pi;
      }
      if (st[i]!.included && zi < zInc) {
        zInc = zi;
        pInc = pi;
      }
    }
  }
  const hasInc = Number.isFinite(zInc) && Number.isFinite(pInc);
  const hasFallback = Number.isFinite(zFallback) && Number.isFinite(pFallback);
  const hasAny = Number.isFinite(zAny) && Number.isFinite(pAny);
  const z0Auto = hasInc ? zInc : hasFallback ? zFallback : hasAny ? zAny : null;
  const p0First = hasInc ? pInc : hasFallback ? pFallback : hasAny ? pAny : null;

  const validWater = typeof activeWaterDensity === 'number' && Number.isFinite(activeWaterDensity) && activeWaterDensity > 0;
  const useWater = settings.excessRhoSource === 'water' && validWater;
  const rhoRef = useWater ? activeWaterDensity : settings.excessRhoRef;
  // Con anclaje 'first', la referencia siempre pasa por (z0Auto, p0First) para garantizar P_ex(z0Auto) = 0;
  // si además llega un excessZ0 distinto en settings, se proyecta P₀ sobre esa columna en z₀.
  const z0 = settings.excessAnchor === 'first' && settings.excessZ0 === null ? (z0Auto ?? 0) : (settings.excessZ0 ?? z0Auto ?? 0);
  const p0 =
    settings.excessAnchor === 'first'
      ? p0First !== null && z0Auto !== null
        ? p0First + psiPerMFromDensity(rhoRef) * (z0 - z0Auto)
        : 0
      : 0;

  return {
    ref: { rhoRef, z0, p0, pressureUnit: 'psi' },
    z0Auto,
    p0First,
    rhoSource: useWater ? 'water' : 'manual',
    waterDensity: validWater ? activeWaterDensity : null,
    hasActiveWaterFallback: settings.excessRhoSource === 'water' && !validWater,
  };
}

/** Proyecta una presión absoluta (psi) a la profundidad z (m) al eje X activo de la pista MDT. */
export function mdtAxisValue(pressurePsi: number, depthM: number, settings: MdtAxisSettings, excessRef: ExcessPressureRef): number {
  if (!Number.isFinite(pressurePsi)) return NaN;
  if (settings.axisMode === 'pressure') {
    const [a, b] = conversionCoefficients('psi', settings.unit);
    return pressurePsi * a + b;
  }
  if (settings.axisMode === 'excess') {
    const exPsi = excessPressure(pressurePsi, depthM, excessRef);
    if (!Number.isFinite(exPsi)) return NaN;
    const [a, b] = conversionCoefficients('psi', settings.unit);
    return exPsi * a + b;
  }
  return equivalentMudWeight(pressurePsi, depthM, { pressureUnit: 'psi', densityUnit: settings.emwUnit });
}

/** Inversa de `mdtAxisValue`: recupera la presión absoluta (psi) a partir de un valor del eje X activo y z (m). */
export function mdtPressureFromAxisValue(axisValue: number, depthM: number, settings: MdtAxisSettings, excessRef: ExcessPressureRef): number {
  if (!Number.isFinite(axisValue)) return NaN;
  if (settings.axisMode === 'pressure') {
    const [a, b] = conversionCoefficients('psi', settings.unit);
    return (axisValue - b) / a;
  }
  if (settings.axisMode === 'excess') {
    const [a, b] = conversionCoefficients('psi', settings.unit);
    const exPsi = (axisValue - b) / a;
    return pressureFromExcess(exPsi, depthM, excessRef);
  }
  return pressureFromEmw(axisValue, depthM, { pressureUnit: 'psi', densityUnit: settings.emwUnit });
}

export interface MdtExcessJump {
  topDepth: number;
  baseDepth: number;
  topId: string;
  baseId: string;
  /** Salto ΔP_ex en psi entre pruebas consecutivas respecto de ρ_ref. */
  deltaExcessPsi: number;
  /** Densidad aparente local entre ambas pruebas (g/cm³); NaN si están a la misma profundidad. */
  localDensityGCm3: number;
}

export interface MdtZoneSummary {
  key: string;
  name: string;
  source: 'interpreted' | 'origin' | 'all';
  top: number;
  base: number;
  n: number;
  emwMeanGCm3: number;
  emwMinGCm3: number;
  emwMaxGCm3: number;
  emwMeanLbGal: number;
  emwMinLbGal: number;
  emwMaxLbGal: number;
  /** Densidad aparente (g/cm³) de la regresión lineal zonal (NaN si n < 2 o profundidad constante). */
  apparentDensityGCm3: number;
  /** Gradiente zonal (psi/ft); NaN si n < 2. */
  gradientPsiPerFt: number;
  /** R² de la regresión lineal zonal; NaN si n < 2. */
  r2: number;
  /** true si ρ_ap > 1,25 g/cm³ (sugiere compartimentalización o sobrepresión escalonada). */
  compartmentAlert: boolean;
  /** true si ρ_ap ≤ 0 g/cm³ (gradiente nulo o invertido). */
  invertedAlert: boolean;
  /** Mayor salto consecutivo |ΔP_ex| dentro de la zona; null si n < 2. */
  maxJump: MdtExcessJump | null;
}

export interface MdtZonesReport {
  overall: {
    n: number;
    emwMeanGCm3: number;
    emwMinGCm3: number;
    emwMaxGCm3: number;
    emwMeanLbGal: number;
    emwMinLbGal: number;
    emwMaxLbGal: number;
    overpressured: boolean;
  };
  zones: MdtZoneSummary[];
  hasCompartmentAlert: boolean;
}

interface MdtPointSample {
  id: string;
  z: number;
  pPsi: number;
  originZone: string | null;
}

const FT_M = 0.3048;

function summarizeSampleGroup(
  key: string,
  name: string,
  source: MdtZoneSummary['source'],
  samples: readonly MdtPointSample[],
  rhoRef: number,
  bounds?: { top: number; base: number },
): MdtZoneSummary {
  const sorted = [...samples].sort((a, b) => a.z - b.z);
  const n = sorted.length;
  let emwSum = 0;
  let emwCount = 0;
  let emwMin = Infinity;
  let emwMax = -Infinity;
  for (const s of sorted) {
    const e = equivalentMudWeight(s.pPsi, s.z, { pressureUnit: 'psi', densityUnit: 'g/cm3' });
    if (Number.isFinite(e)) {
      emwSum += e;
      emwCount++;
      if (e < emwMin) emwMin = e;
      if (e > emwMax) emwMax = e;
    }
  }
  const emwMeanGCm3 = emwCount > 0 ? emwSum / emwCount : NaN;
  const emwMinGCm3 = emwCount > 0 ? emwMin : NaN;
  const emwMaxGCm3 = emwCount > 0 ? emwMax : NaN;

  let apparentDensityGCm3 = NaN;
  let gradientPsiPerFt = NaN;
  let r2 = NaN;
  if (n >= 2) {
    const zs = Float64Array.from(sorted, (s) => s.z);
    const ps = Float64Array.from(sorted, (s) => s.pPsi);
    const fit = fitTrend(zs, ps, 'linear');
    if (fit) {
      apparentDensityGCm3 = densityFromPsiPerM(fit.b);
      gradientPsiPerFt = fit.b * FT_M;
      r2 = fit.r2;
    }
  }

  let maxJump: MdtExcessJump | null = null;
  const refGradPsiM = psiPerMFromDensity(Number.isFinite(rhoRef) && rhoRef >= 0 ? rhoRef : HYDROSTATIC_NORMAL_DENSITY);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const dz = b.z - a.z;
    const dp = b.pPsi - a.pPsi;
    const deltaExcessPsi = dp - refGradPsiM * dz;
    const localDensityGCm3 = dz > 1e-6 ? densityFromPsiPerM(dp / dz) : NaN;
    if (!maxJump || Math.abs(deltaExcessPsi) > Math.abs(maxJump.deltaExcessPsi)) {
      maxJump = {
        topDepth: a.z,
        baseDepth: b.z,
        topId: a.id,
        baseId: b.id,
        deltaExcessPsi,
        localDensityGCm3,
      };
    }
  }

  return {
    key,
    name,
    source,
    top: bounds?.top ?? (n > 0 ? sorted[0]!.z : NaN),
    base: bounds?.base ?? (n > 0 ? sorted[n - 1]!.z : NaN),
    n,
    emwMeanGCm3,
    emwMinGCm3,
    emwMaxGCm3,
    emwMeanLbGal: densityToLbPerGal(emwMeanGCm3),
    emwMinLbGal: densityToLbPerGal(emwMinGCm3),
    emwMaxLbGal: densityToLbPerGal(emwMaxGCm3),
    apparentDensityGCm3,
    gradientPsiPerFt,
    r2,
    compartmentAlert: isCompartmentalizedDensity(apparentDensityGCm3),
    invertedAlert: Number.isFinite(apparentDensityGCm3) && apparentDensityGCm3 <= 0,
    maxJump,
  };
}

/**
 * Resume EMW medio, regresión lineal aparente y mayor salto consecutivo en exceso de presión por zona sobre las
 * pruebas incluidas de un conjunto MDT. Señala compartimentalización cuando ρ_ap > 1,25 g/cm³. Puro.
 */
export function summarizeMdtZones(
  set: PointSet,
  decisions: PointSetDecisions | undefined,
  zones: readonly { id: string; name: string; top: number; base: number }[],
  opts: { rhoRef?: number; originZoneColumn?: string } = {},
): MdtZonesReport {
  const rhoRef = opts.rhoRef ?? HYDROSTATIC_NORMAL_DENSITY;
  const originCol = pointTexts(set, opts.originZoneColumn ?? 'zone');
  const p = pointNumbers(set, 'pressure');
  const samples: MdtPointSample[] = [];
  if (p) {
    const st = pointStatuses(set, decisions);
    const z = shiftedDepth(set, decisions);
    for (let i = 0; i < p.length; i++) {
      if (!st[i]!.included) continue;
      const zi = z[i]!;
      const pi = pressureInPsi(set, p[i]!);
      if (!Number.isFinite(zi) || !Number.isFinite(pi)) continue;
      samples.push({ id: set.pointIds[i]!, z: zi, pPsi: pi, originZone: originCol?.[i]?.trim() || null });
    }
  }

  const allSummary = summarizeSampleGroup('all', 'Conjunto', 'all', samples, rhoRef);
  const overall = {
    n: allSummary.n,
    emwMeanGCm3: allSummary.emwMeanGCm3,
    emwMinGCm3: allSummary.emwMinGCm3,
    emwMaxGCm3: allSummary.emwMaxGCm3,
    emwMeanLbGal: allSummary.emwMeanLbGal,
    emwMinLbGal: allSummary.emwMinLbGal,
    emwMaxLbGal: allSummary.emwMaxLbGal,
    overpressured: Number.isFinite(allSummary.emwMeanGCm3) && allSummary.emwMeanGCm3 > 1.2,
  };

  const out: MdtZoneSummary[] = [];
  if (samples.length > 0) {
    if (zones.length > 0) {
      const matched = new Set<MdtPointSample>();
      const sortedZones = [...zones].sort((a, b) => a.top - b.top);
      for (const zDef of sortedZones) {
        const group = samples.filter((s) => s.z >= zDef.top && s.z <= zDef.base);
        if (group.length === 0) continue;
        for (const s of group) matched.add(s);
        out.push(summarizeSampleGroup(`interpreted:${zDef.id}`, zDef.name, 'interpreted', group, rhoRef, { top: zDef.top, base: zDef.base }));
      }
      const rest = samples.filter((s) => !matched.has(s));
      if (out.length > 0 && rest.length > 0) {
        out.push(summarizeSampleGroup('unassigned', 'Fuera de zonas', 'all', rest, rhoRef));
      }
    }
    if (out.length === 0) {
      const byOrigin = new Map<string, MdtPointSample[]>();
      for (const s of samples) {
        if (!s.originZone) continue;
        const list = byOrigin.get(s.originZone) ?? [];
        list.push(s);
        byOrigin.set(s.originZone, list);
      }
      if (byOrigin.size > 0) {
        const entries = [...byOrigin.entries()].sort((a, b) => Math.min(...a[1].map((s) => s.z)) - Math.min(...b[1].map((s) => s.z)));
        for (const [zName, group] of entries) {
          out.push(summarizeSampleGroup(`origin:${zName}`, zName, 'origin', group, rhoRef));
        }
      } else {
        out.push(allSummary);
      }
    }
  }

  return { overall, zones: out, hasCompartmentAlert: out.some((z) => z.compartmentAlert) };
}
