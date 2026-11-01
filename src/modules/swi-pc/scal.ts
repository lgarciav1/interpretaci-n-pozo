/**
 * Datos SCAL del TP para el panel «SCAL» (docs/decisiones/0057-mdt-y-scal-del-tp-embebidos.md): lógica pura, sin
 * React. Une las dos tablas de la hoja SCAL por muestra, ajusta la presión de desplazamiento contra √(k/φ) con el
 * motor (`fitDisplacementPressure`), arma las seis curvas Swi–√(k/φ) de la cátedra y resume la tabla `SWI_ZONES` del
 * módulo. «Usar nivel N» escribe el parámetro de nivel global (`levelWrite`).
 *
 * √(k/φ) es siempre la de la planilla de Swi: k de gas en mD y φ en % (la columna `rootKPhi` de la tabla de garganta
 * poral). La columna «RAIZ» de la tabla de desplazamiento usa φ en fracción (10 veces más) y solo se usa para
 * verificar la unión.
 */
import type { Interpretation } from '../../core/interpretation';
import type { TableValue } from '../../core/module';
import { paramStorageKey } from '../../core/params';
import { setParam, type Project } from '../../core/state/project';
import { fitDisplacementPressure, SWI_CATEDRA_LEVELS, SWI_SCAL_ROOT_RANGE, swiPowerLaw, type DisplacementFit, type SwiPreset } from '../../petro/swiPc';
import swiPc, { SWI_PC_ID } from './index';
import { TP_SCAL_DISPLACEMENT, TP_SCAL_THROAT } from './tpScal';

export const SCAL_DOCK_ID = 'scal';
export const TP_SCAL_SOURCE = 'TP_interpretacion_de_Pozo.xlsx · hoja SCAL';

export interface ScalSample {
  sample: string;
  /** k de gas (mD). */
  kGasMd: number;
  /** φ (%). */
  phiPct: number;
  /** √(k/φ%) de la tabla de garganta poral. */
  rootKPhi: number;
  /** Presión de desplazamiento (kg/cm²). */
  displacementKgCm2: number;
  /** Columna «RAIZ» de la tabla de desplazamiento (10 × √(k/φ%)). */
  rootRaw: number;
}

export interface ScalJoin {
  samples: ScalSample[];
  /** Muestras que están en una sola de las dos tablas (vacío con los datos del TP). */
  unmatched: string[];
  /** Mayor diferencia relativa entre «RAIZ»/10 y √(k/φ%) de la misma muestra (control de la unión). */
  maxRootMismatch: number;
}

/** Une las tablas de desplazamiento y de garganta poral por nombre de muestra, en el orden de la de garganta. */
export function joinScalTables(
  throat: readonly { sample: string; kGasMd: number; phiPct: number; rootKPhi: number }[] = TP_SCAL_THROAT,
  displacement: readonly { sample: string; rootRaw: number; displacementKgCm2: number }[] = TP_SCAL_DISPLACEMENT,
): ScalJoin {
  const byName = new Map(displacement.map((d) => [d.sample, d]));
  const samples: ScalSample[] = [];
  let maxRootMismatch = 0;
  for (const t of throat) {
    const d = byName.get(t.sample);
    if (!d) continue;
    samples.push({ sample: t.sample, kGasMd: t.kGasMd, phiPct: t.phiPct, rootKPhi: t.rootKPhi, displacementKgCm2: d.displacementKgCm2, rootRaw: d.rootRaw });
    maxRootMismatch = Math.max(maxRootMismatch, Math.abs(d.rootRaw / 10 - t.rootKPhi) / t.rootKPhi);
  }
  const names = new Set(samples.map((s) => s.sample));
  const unmatched = [...throat.map((t) => t.sample), ...displacement.map((d) => d.sample)].filter((s, i, a) => !names.has(s) && a.indexOf(s) === i);
  return { samples, unmatched, maxRootMismatch };
}

/** Ajuste potencial Pd = c·x^(−d) de las muestras, con x = √(k/φ%). */
export function scalDisplacementFit(samples: readonly ScalSample[]): DisplacementFit | null {
  return fitDisplacementPressure(
    samples.map((s) => s.rootKPhi),
    samples.map((s) => s.displacementKgCm2),
  );
}

/** Curva Swi (v/v) de un nivel en `n` puntos equiespaciados en log entre `min` y `max` de √(k/φ). */
export function swiLevelCurve(level: SwiPreset, min: number, max: number, n = 64): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const a = Math.log10(min);
  const b = Math.log10(max);
  for (let i = 0; i < n; i++) {
    x[i] = 10 ** (a + ((b - a) * i) / (n - 1));
    y[i] = swiPowerLaw(x[i]!, level.A, level.B);
  }
  return { x, y };
}

export const LEVELS = SWI_CATEDRA_LEVELS;
export const SCAL_RANGE = SWI_SCAL_ROOT_RANGE;

// ── parámetro de nivel ──────────────────────────────────────────────────────────────────────────────────────

const LEVEL_SPEC = swiPc.params.level;
/** Clave de almacenamiento del parámetro de nivel (`swi-pc.level`). */
export const LEVEL_STORAGE = paramStorageKey(SWI_PC_ID, 'level', LEVEL_SPEC);
export const DEFAULT_LEVEL = LEVEL_SPEC.default as string;

/** Nivel global vigente (el guardado o el de fábrica). */
export function globalLevel(interp: Pick<Interpretation, 'params'>): string {
  const v = interp.params.global[LEVEL_STORAGE];
  return typeof v === 'string' ? v : DEFAULT_LEVEL;
}

/** Ids de las zonas con un nivel propio (no cambian al escribir el global). */
export function zonesWithOwnLevel(interp: Pick<Interpretation, 'params' | 'zones'>): string[] {
  return interp.zones.filter((z) => typeof interp.params.zones[z.id]?.[LEVEL_STORAGE] === 'string').map((z) => z.id);
}

/** «Usar nivel N»: escribe el nivel global de `swi-pc` (una receta; el panel la manda por `commit`). */
export function levelWrite(project: Project, wellId: string, levelId: string): Project {
  return setParam(project, wellId, LEVEL_STORAGE, levelId, null);
}

// ── resumen de la tabla por zona ────────────────────────────────────────────────────────────────────────────

export interface OutOfRangeSummary {
  /** % de las muestras con Swi del pozo (sumando las zonas) cuyo √(k/φ) cae fuera del rango SCAL. */
  pct: number;
  /** Muestras con Swi que entran en la cuenta. */
  n: number;
  /** Zonas sin el dato (coeficientes manuales): no entran en la cuenta. */
  manualZones: string[];
}

/**
 * Promedio ponderado por muestras de la columna «Fuera del rango SCAL» de `SWI_ZONES`. null si ninguna zona tiene el
 * dato (sin tabla, coeficientes manuales en todas o sin muestras con Swi).
 */
export function outOfRangeSummary(table: TableValue | null | undefined): OutOfRangeSummary | null {
  if (!table) return null;
  let n = 0;
  let out = 0;
  const manualZones: string[] = [];
  for (const r of table.rows) {
    const k = r['nSwi'];
    const pct = r['pctOutRange'];
    if (typeof k !== 'number' || k <= 0) continue;
    if (typeof pct !== 'number' || !Number.isFinite(pct)) {
      manualZones.push(String(r['zone'] ?? ''));
      continue;
    }
    n += k;
    out += (pct / 100) * k;
  }
  return n > 0 ? { pct: (100 * out) / n, n, manualZones } : null;
}
