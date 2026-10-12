/** Calibraciones independientes por arcilla: cambiar el mineral conserva las calibraciones de los demás. */
import { param, type ParamValue } from '../../core/params';
import { MINERALS, type MineralOptions } from '../../petro/mineralogy';

export const CLAY_IDS = ['illite', 'kaolinite', 'chlorite', 'smectite'] as const;
export type CalibrationClay = (typeof CLAY_IDS)[number];
export function clayParamKeys(id: CalibrationClay) {
  // Se conserva la clave GR de illita del PR original para proyectos guardados.
  return { rho: `${id}Rho`, pe: `${id}Pe`, nphi: `${id}Nphi`, gr: id === 'illite' ? 'clayGr' : `${id}Gr` };
}
export const CLAY_PARAMS = Object.fromEntries(CLAY_IDS.flatMap(id => {
  const m = MINERALS.find(m => m.id === id)!;
  const keys = clayParamKeys(id);
  // Defaults: SLB Log Interpretation Charts, 2013, Appendix B p.280, filas de arcillas.
  return [
    [keys.rho, param.number({ label: `Densidad de arcilla · ${m.label}`, default: m.rho, min: 1.5, max: 3.5, step: 0.01, unit: 'g/cm3', scope: 'zone', group: 'Arcilla seleccionada' })],
    [keys.pe, param.number({ label: `PE de arcilla · ${m.label}`, default: m.pe, min: 0.1, max: 10, step: 0.01, unit: 'b/e', scope: 'zone', group: 'Arcilla seleccionada' })],
    [keys.nphi, param.number({ label: `Neutrón de arcilla · ${m.label}`, default: m.nphi, min: -0.1, max: 1, step: 0.01, unit: 'v/v', scope: 'zone', group: 'Arcilla seleccionada', tooltip: 'Respuesta en escala CNL caliza, ajustable con corona; no porosidad intrínseca.' })],
    [keys.gr, param.number({ label: `GR de arcilla · ${m.label}`, default: m.gr, min: 1, max: 350, step: 1, unit: 'gAPI', scope: 'zone', group: 'Arcilla seleccionada', tooltip: 'Punto medio del intervalo tabulado; calibrar con el extremo arcilloso del pozo.' })],
  ] as const;
}));

export function selectedClay(values: Readonly<Record<string, ParamValue>>): CalibrationClay {
  return CLAY_IDS.includes(values.clay as CalibrationClay) ? values.clay as CalibrationClay : 'illite';
}
export function clayCalibration(values: Readonly<Record<string, ParamValue>>): MineralOptions {
  const clay = selectedClay(values), keys = clayParamKeys(clay);
  const m = MINERALS.find(m => m.id === clay)!;
  return { clay, clayRho: Number(values[keys.rho] ?? m.rho), clayPe: Number(values[keys.pe] ?? m.pe), clayNphi: Number(values[keys.nphi] ?? m.nphi), clayGr: Number(values[keys.gr] ?? m.gr) };
}
