/**
 * Método sónico–resistividad de Passey (motor puro, unidades canónicas).
 * Passey, Creaney, Kulla, Moretti y Stroud (1990), A Practical Model for Organic
 * Richness from Porosity and Resistivity Logs, AAPG Bulletin 74(12), pp. 1777–1794.
 * Ec. (1): ΔlogR=log10(R/Rbase)+0,02·(DT−DTbase), con DT en µs/ft.
 * Ec. (3): TOC(wt%)=ΔlogR·10^(2,297−0,1688·LOM).
 * Ec. (1) y escala: p. 1780. SIN VERIFICAR: página puntual/numeración de
 * la relación TOC (ec. 3, atribuida a p. 1781, no cotejada directamente).
 * La línea base debe representar roca arcillosa sin enriquecimiento orgánico
 * de la misma formación. Gas, hidrocarburos de reservorio, cambios de litología
 * y madurez mal elegida pueden producir separación sin materia orgánica.
 * Conserva ΔlogR negativo; solo TOC se limita a cero. Sin extrapolación ni
 * sustitución de muestras ausentes. LOM es un parámetro de madurez, no Ro.
 */

export const SONIC_PER_CYCLE = 50; // Passey et al. (1990), p. 1780, escala sónico–resistividad y ec. (1).
export const PASSEY_REFERENCE = 'Passey et al. (1990), AAPG Bulletin 74(12), 1777–1794, ecuaciones (1) y (3).';

export interface PasseyBaseline { resistance: number; sonic: number; samples: number }
export interface PasseyParams { resistanceBase: number; sonicBase: number; lom: number; separationThreshold: number; grThreshold: number }
export interface PasseySample { resistance: number; sonic: number; gr?: number }
export interface PasseyResult { deltaLogR: number; toc: number; sourceFlag: number; resistanceOverlay: number; sonicOverlay: number }

const missing = (): PasseyResult => ({ deltaLogR: NaN, toc: NaN, sourceFlag: NaN, resistanceOverlay: NaN, sonicOverlay: NaN });

/** Respuesta por muestra: TOC en porcentaje en peso, distinto de un volumen v/v. */
export function passeySample(sample: PasseySample, params: PasseyParams): PasseyResult {
  const { resistance, sonic, gr } = sample;
  const { resistanceBase, sonicBase, lom, separationThreshold, grThreshold } = params;
  if (![resistance, sonic, resistanceBase, sonicBase, lom].every(Number.isFinite) || resistance <= 0 || resistanceBase <= 0 || sonic <= 0 || sonicBase <= 0 || lom < 0) return missing();
  const resistanceOverlay = Math.log10(resistance / resistanceBase);
  const sonicOverlay = (sonicBase - sonic) / SONIC_PER_CYCLE;
  const deltaLogR = resistanceOverlay - sonicOverlay;
  // Coeficientes empíricos: Passey et al. (1990), ec. (3); página puntual SIN VERIFICAR.
  const toc = Math.max(0, deltaLogR) * Math.pow(10, 2.297 - 0.1688 * lom);
  if (![deltaLogR, toc, resistanceOverlay, sonicOverlay].every(Number.isFinite)) return missing();
  const flagValid = Number.isFinite(gr) && gr! >= 0 && Number.isFinite(separationThreshold) && separationThreshold >= 0 && Number.isFinite(grThreshold) && grThreshold >= 0;
  return { deltaLogR, toc, sourceFlag: flagValid ? Number(deltaLogR > separationThreshold && gr! >= grThreshold) : NaN, resistanceOverlay, sonicOverlay };
}

function median(values: number[]): number {
  values.sort((a,b) => a-b);
  const mid = Math.floor(values.length/2);
  return values.length % 2 ? values[mid]! : (values[mid-1]!+values[mid]!)/2;
}

/**
 * Medianas de las DOS herramientas sobre las mismas muestras válidas del intervalo.
 * Es un estimador práctico de alineación, SIN VERIFICAR como procedimiento de Passey.
 * No identifica por sí mismo roca no generadora: la selección es del intérprete.
 * Exige que el intervalo esté completamente dentro del dominio registrado.
 */
export function pairedMedianBaseline(depth: ArrayLike<number>, resistance: ArrayLike<number>, sonic: ArrayLike<number>, top: number, base: number): PasseyBaseline | null {
  if (!depth.length || depth.length !== resistance.length || depth.length !== sonic.length || !Number.isFinite(top) || !Number.isFinite(base) || base <= top) return null;
  let minDepth = Infinity, maxDepth = -Infinity;
  for (let i=0; i<depth.length; i++) if (Number.isFinite(depth[i])) { minDepth=Math.min(minDepth,depth[i]!); maxDepth=Math.max(maxDepth,depth[i]!); }
  if (top < minDepth || base > maxDepth) return null;
  const r: number[] = [], dt: number[] = [];
  for (let i=0; i<depth.length; i++) {
    const z=depth[i]!, ri=resistance[i]!, dti=sonic[i]!;
    if (z >= top && z <= base && Number.isFinite(ri) && ri>0 && Number.isFinite(dti) && dti>0) { r.push(ri); dt.push(dti); }
  }
  return r.length ? { resistance: median(r), sonic: median(dt), samples: r.length } : null;
}
