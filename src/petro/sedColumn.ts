/** Columna inferida desde perfiles, no descripción de testigo. Motor puro de Geo-5. */
export type SedLithology = 'sandstone' | 'siltstone' | 'shale' | 'limestone' | 'dolomite' | 'anhydrite' | 'coal' | 'unknown';
export type SedGrain = 'clay' | 'silt' | 'veryFine' | 'fine' | 'medium' | 'coarse' | 'gravel' | 'unknown';
export type SedSource = 'minerals' | 'vsh' | 'gr' | 'coal' | 'shale' | 'unknown' | 'mixed';
export const SED_GRAIN_ORDER: readonly SedGrain[] = ['clay', 'silt', 'veryFine', 'fine', 'medium', 'coarse', 'gravel'];
export const SED_LITHOLOGY_LABELS: Readonly<Record<SedLithology, string>> = {
  sandstone: 'Arenisca', siltstone: 'Limolita', shale: 'Lutita', limestone: 'Caliza', dolomite: 'Dolomía', anhydrite: 'Anhidrita', coal: 'Carbón', unknown: 'Sin clasificación',
};
export const SED_GRAIN_LABELS: Readonly<Record<SedGrain, string>> = {
  clay: 'Arcilla', silt: 'Limo', veryFine: 'Arena muy fina', fine: 'Arena fina', medium: 'Arena media', coarse: 'Arena gruesa', gravel: 'Grava', unknown: 'Sin estimación',
};
export interface SedColumnParams {
  sedClayThreshold: number; sedSiltThreshold: number; sedMinThickness: number;
  sedGrainScale: number; sedGrClean: number; sedGrShale: number;
}
// SIN VERIFICAR: cortes y escala son hipótesis operativas ajustables, no constantes bibliográficas.
export const SED_COLUMN_DEFAULTS: Readonly<SedColumnParams> = {
  sedClayThreshold: .45, sedSiltThreshold: .2, sedMinThickness: .5, sedGrainScale: 1, sedGrClean: 25, sedGrShale: 125,
};
export interface SedColumnInput {
  depth: ArrayLike<number>; gr?: ArrayLike<number>; vsh?: ArrayLike<number>;
  quartz?: ArrayLike<number>; calcite?: ArrayLike<number>; dolomite?: ArrayLike<number>; clay?: ArrayLike<number>; phi?: ArrayLike<number>;
  coal?: ArrayLike<number>; shale?: ArrayLike<number>;
  /** Zonas asignadas por muestra; no se mezclan al bloquear. */
  zoneIds?: readonly (string | null)[];
}
export interface SedSample {
  lithology: SedLithology; source: SedSource; vsh: number | null;
}
export interface SedLayer {
  top: number; base: number; thickness: number; lithology: SedLithology; grain: SedGrain; width: number;
  zoneId: string | null; source: SedSource; belowMinimum: boolean;
  quartz: number | null; calcite: number | null; dolomite: number | null; clay: number | null; phi: number | null; vsh: number | null;
}
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const fraction = (v: number | undefined): number | null => v !== undefined && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
function resolvedParams(params: Partial<SedColumnParams>): SedColumnParams {
  const p = { ...SED_COLUMN_DEFAULTS, ...params };
  for (const key of Object.keys(p) as (keyof SedColumnParams)[]) if (!Number.isFinite(p[key])) throw new Error('Parámetro de columna sedimentológica inválido.');
  if (p.sedMinThickness < 0 || p.sedGrainScale <= 0 || p.sedGrShale <= p.sedGrClean || p.sedSiltThreshold < 0 || p.sedClayThreshold > 1 || p.sedClayThreshold <= p.sedSiltThreshold) throw new Error('Revisá los extremos de GR, los cortes de arcilla y limo y el espesor mínimo.');
  return p;
}
/** Carbón preservado; arcilla estrictamente por encima del corte; carbonatos no pasan a limolita por Vsh. */
export function classifySedSample(input: Omit<SedColumnInput, 'depth' | 'zoneIds'>, i: number, params: Partial<SedColumnParams> = {}): SedSample {
  const p = resolvedParams(params);
  const measuredVsh = fraction(input.vsh?.[i]);
  const gr = input.gr?.[i];
  const vsh = measuredVsh ?? (gr !== undefined && Number.isFinite(gr) && gr >= 0 ? clamp((gr - p.sedGrClean) / (p.sedGrShale - p.sedGrClean)) : null);
  if (input.coal?.[i] === 1) return { lithology: 'coal', source: 'coal', vsh };
  const q = fraction(input.quartz?.[i]), c = fraction(input.calcite?.[i]), d = fraction(input.dolomite?.[i]), a = fraction(input.clay?.[i]);
  if (q !== null && c !== null && d !== null && a !== null && (a > p.sedClayThreshold || q + c + d > 0)) {
    if (a > p.sedClayThreshold) return { lithology: 'shale', source: 'minerals', vsh };
    // SIN VERIFICAR: dominancia simple y desempate estable cuarzo/calcita/dolomita, sin umbral de pureza.
    const lithology: SedLithology = q >= c && q >= d ? (vsh !== null && vsh >= p.sedSiltThreshold && vsh <= p.sedClayThreshold ? 'siltstone' : 'sandstone') : c >= d ? 'limestone' : 'dolomite';
    return { lithology, source: 'minerals', vsh };
  }
  if (vsh !== null) return { lithology: vsh > p.sedClayThreshold ? 'shale' : vsh >= p.sedSiltThreshold ? 'siltstone' : 'sandstone', source: measuredVsh !== null ? 'vsh' : 'gr', vsh };
  if (input.shale?.[i] === 1) return { lithology: 'shale', source: 'shale', vsh };
  return { lithology: 'unknown', source: 'unknown', vsh: null };
}
export interface CoreGrainObservation { depth: number; diameterMm: number }
/** Firma preparada para corona: las observaciones todavía no intervienen en la estimación. */
export function estimateSedGrain(vsh: number | null, scale = 1, _coreGrain?: readonly CoreGrainObservation[]): { grain: SedGrain; width: number } {
  if (vsh === null || !Number.isFinite(vsh) || vsh < 0 || vsh > 1 || !Number.isFinite(scale) || scale <= 0) return { grain: 'unknown', width: .12 };
  // SIN VERIFICAR: interpolación logarítmica desde 1/512 mm a 1 mm según limpieza; no modelo de granulometría calibrado.
  const logSize = clamp(-9 + 9 * (1 - vsh) * scale, -9, 2);
  // Wentworth (1922), Journal of Geology 30(5), 377–392: arcilla <1/256, limo <1/16,
  // arenas muy fina <1/8, fina <1/4, media <1/2, gruesa hasta 2 mm; aquí gruesa incluye muy gruesa.
  const grain: SedGrain = logSize < -8 ? 'clay' : logSize < -4 ? 'silt' : logSize < -3 ? 'veryFine' : logSize < -2 ? 'fine' : logSize < -1 ? 'medium' : logSize < 1 ? 'coarse' : 'gravel';
  // La grava comienza a 2 mm (log2=1); ancho ordinal para coincidir con siete marcas del encabezado.
  return { grain, width: SED_GRAIN_ORDER.indexOf(grain) / 6 };
}
interface Cell { top: number; base: number; index: number; zoneId: string | null; sample: SedSample; lithology: SedLithology; grain: SedGrain }
interface Run { cells: Cell[]; lithology: SedLithology; grain: SedGrain }
function runThickness(run: Run) { return run.cells.at(-1)!.base - run.cells[0]!.top; }
function runs(cells: readonly Cell[], axis: 'lithology' | 'grain' = 'lithology'): Run[] {
  const out: Run[] = [];
  for (const cell of cells) {
    if (out.at(-1)?.[axis] === cell[axis]) out.at(-1)!.cells.push(cell);
    else out.push({ cells: [cell], lithology: cell.lithology, grain: cell.grain });
  }
  return out;
}
function blocked(cells: Cell[], min: number, axis: 'lithology' | 'grain' = 'lithology'): Run[] {
  // SIN VERIFICAR: moda móvil ponderada por espesor, ventana de mínimo/2 a cada lado.
  // Los tramos no contienen carbón ni desconocidos: ambos delimitan bloques infranqueables.
  const smoothed = cells.map((cell, i) => {
    const count = new Map<string, number>();
    const center = (cell.top + cell.base) / 2;
    for (let j = i; j >= 0 && cells[j]!.base > center - min / 2; j--) {
      const c = cells[j]!; count.set(c[axis], (count.get(c[axis]) ?? 0) + Math.max(0, Math.min(c.base, center + min / 2) - Math.max(c.top, center - min / 2)));
    }
    for (let j = i + 1; j < cells.length && cells[j]!.top < center + min / 2; j++) {
      const c = cells[j]!; count.set(c[axis], (count.get(c[axis]) ?? 0) + Math.max(0, Math.min(c.base, center + min / 2) - Math.max(c.top, center - min / 2)));
    }
    let winner: string = cell[axis], best = count.get(winner) ?? 0;
    for (const [key, h] of count) if (h > best + 1e-12) { winner = key; best = h; }
    return axis === 'lithology' ? { ...cell, lithology: winner as SedLithology } : { ...cell, grain: winner as SedGrain };
  });
  let out = runs(smoothed, axis);
  // Fusionar la capa corta de menor espesor con el vecino más grueso (empate: arriba).
  // Cada fusión reduce el número de capas; nunca cruza zonas, huecos, carbón o sin clasificación.
  while (out.length > 1) {
    let shortest = -1;
    for (let i = 0; i < out.length; i++) if (runThickness(out[i]!) + 1e-9 < min && (shortest < 0 || runThickness(out[i]!) < runThickness(out[shortest]!))) shortest = i;
    if (shortest < 0) break;
    const neighbor = shortest === 0 ? 1 : shortest === out.length - 1 ? shortest - 1 : runThickness(out[shortest - 1]!) >= runThickness(out[shortest + 1]!) ? shortest - 1 : shortest + 1;
    const key = out[neighbor]![axis];
    const merged = out.flatMap((run, i) => run.cells.map(c => axis === 'lithology' ? { ...c, lithology: (i === shortest ? key : run.lithology) as SedLithology } : { ...c, grain: (i === shortest ? key : run.grain) as SedGrain }));
    out = runs(merged, axis);
  }
  return out;
}
/**
 * Celdas entre puntos medios, extremos extendidos medio paso (convención sampleThickness del repo).
 * SIN VERIFICAR: salto >3 veces la mediana del paso se considera hueco de cobertura; no se extrapola a través.
 * El bloqueo respeta esos huecos y las asignaciones de zona del motor. Un bloque aislado <mínimo
 * se conserva y marca belowMinimum: satisfacer el mínimo ahí exigiría inventar roca o borrar carbón/datos faltantes.
 */
export function buildSedColumn(input: SedColumnInput, params: Partial<SedColumnParams> = {}): SedLayer[] {
  const p = resolvedParams(params), n = input.depth.length;
  if (!n) return [];
  const steps: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(input.depth[i]) || i > 0 && input.depth[i]! <= input.depth[i - 1]!) throw new Error('Profundidad de la columna inválida.');
    if (i > 0) steps.push(input.depth[i]! - input.depth[i - 1]!);
  }
  steps.sort((a, b) => a - b);
  const typical = steps.length ? steps[Math.floor((steps.length - 1) / 2)]! : 0;
  const cells: Cell[] = Array.from({ length: n }, (_, i) => {
    const z = input.depth[i]!;
    const prev = i > 0 ? z - input.depth[i - 1]! : n > 1 ? input.depth[1]! - z : 0;
    const next = i < n - 1 ? input.depth[i + 1]! - z : n > 1 ? z - input.depth[i - 1]! : 0;
    const left = prev > 3 * typical ? typical : prev, right = next > 3 * typical ? typical : next;
    const sample = classifySedSample(input, i, p);
    return { top: z - left / 2, base: z + right / 2, index: i, zoneId: input.zoneIds?.[i] ?? null, sample, lithology: sample.lithology, grain: estimateSedGrain(sample.vsh, p.sedGrainScale).grain };
  }).filter(c => c.base > c.top);
  const groups: Cell[][] = [];
  for (const c of cells) {
    const group = groups.at(-1), last = group?.at(-1);
    const special = (l: SedLithology) => l === 'coal' || l === 'unknown';
    if (last && last.zoneId === c.zoneId && Math.abs(last.base - c.top) < 1e-8 && (special(last.lithology) || special(c.lithology) ? last.lithology === c.lithology : true)) group!.push(c);
    else groups.push([c]);
  }
  // Segunda pasada por grano dentro de cada litología bloqueada: conserva variación del contorno en
  // carbonatos y paquetes homogéneos, sin crear capas menores al mínimo ni cambiar litología.
  return groups.flatMap(g => g[0]!.lithology === 'coal' || g[0]!.lithology === 'unknown' ? runs(g) : blocked(g, p.sedMinThickness).flatMap(run => blocked(run.cells, p.sedMinThickness, 'grain'))).map(run => {
    const top = run.cells[0]!.top, base = run.cells.at(-1)!.base;
    const average = (key: 'quartz' | 'calcite' | 'dolomite' | 'clay' | 'phi' | 'vsh') => {
      let sum = 0, weight = 0;
      for (const c of run.cells) {
        const value = key === 'vsh' ? c.sample.vsh : fraction(input[key]?.[c.index]);
        if (value !== null) { const h = c.base - c.top; sum += h * value; weight += h; }
      }
      return weight ? sum / weight : null;
    };
    const sources = new Set(run.cells.map(c => c.sample.source)), vsh = average('vsh');
    const grainEstimate = run.lithology === 'coal' || run.lithology === 'unknown' ? estimateSedGrain(vsh, p.sedGrainScale) : { grain: run.grain, width: run.grain === 'unknown' ? .12 : SED_GRAIN_ORDER.indexOf(run.grain) / 6 };
    return { top, base, thickness: base - top, lithology: run.lithology, ...grainEstimate, zoneId: run.cells[0]!.zoneId,
      source: sources.size === 1 ? [...sources][0]! : 'mixed', belowMinimum: base - top + 1e-9 < p.sedMinThickness,
      quartz: average('quartz'), calcite: average('calcite'), dolomite: average('dolomite'), clay: average('clay'), phi: average('phi'), vsh };
  });
}
