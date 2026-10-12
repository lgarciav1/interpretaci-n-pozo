/**
 * Pozo sintético de demostración (fase 1). Imita la geometría del pozo del TP (7633–8518 m cada 0,1524 m,
 * zonas A–E) con capas de arena y arcilla generadas con una semilla fija. NO son los datos del TP: el lector real
 * (Excel/LAS/CSV) es la fase 2.
 */
import { createWell, type Curve, type Well, type Zone } from '../../core/well';
import type { UnitId } from '../../core/units';
import { forwardStepProfile } from '../../petro/invasion';
import { arpsResistivityC, formationTemperature } from '../../petro/temperature';
import { EXAMPLE_M } from '../../modules/core/example';
import rwManual from '../../modules/rw-manual';
import tempGradient from '../../modules/temp-gradient';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES: Zone[] = [
  { id: 'zone-a', name: 'A', top: 7633.26, base: 7724.39, color: '#e8c872', kind: 'formation' },
  { id: 'zone-b', name: 'B', top: 7724.55, base: 7906.05, color: '#9ec5e8', kind: 'formation' },
  { id: 'zone-c', name: 'C', top: 7906.21, base: 7969.91, color: '#f2a65a', kind: 'reservoir' },
  { id: 'zone-d', name: 'D', top: 7970.06, base: 8246.97, color: '#b8d98b', kind: 'formation' },
  { id: 'zone-e', name: 'E', top: 8247.13, base: 8518.55, color: '#c9a3d9', kind: 'formation' },
];

/** Exponente de cementación de diseño del agua de formación del demo (a = 1): el de los plugs de ejemplo. */
export const DEMO_M = EXAMPLE_M;
/** Resistividad de la arcilla (ohm·m). */
const R_SHALE = 2.2;

/**
 * Rw a la profundidad z con los valores POR DEFECTO de la app (módulos `rw-manual` y `temp-gradient`): la que va a
 * usar la interpretación del demo mientras el usuario no los cambie.
 */
export function demoRw(z: number): number {
  const t = tempGradient.params;
  const w = rwManual.params;
  const temp = formationTemperature(z - t.datum.default, t.tSurface.default, t.gradient.default / 100);
  return w.correct.default ? arpsResistivityC(w.rwRef.default, w.tRef.default, temp) : w.rwRef.default;
}

/** Proporción de arena por zona (para que las zonas se distingan). */
const SAND_RATIO: Record<string, number> = { 'zone-a': 0.35, 'zone-b': 0.55, 'zone-c': 0.75, 'zone-d': 0.45, 'zone-e': 0.3 };

export function syntheticWell(n = 5810, seed = 2026): { well: Well; zones: Zone[] } {
  const rnd = mulberry32(seed);
  const gauss = () => {
    const u = 1 - rnd();
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const top = 7633.2588;
  const step = 0.1524;
  const depth = Float64Array.from({ length: n }, (_, i) => top + i * step);

  // Capas: secuencia de espesores aleatorios, cada una arena (1) o arcilla (0).
  const sand = new Float64Array(n);
  let i = 0;
  while (i < n) {
    const d = depth[i]!;
    const z = ZONES.find((zz) => d >= zz.top && d <= zz.base);
    const ratio = z ? SAND_RATIO[z.id]! : 0.4;
    const thick = Math.max(3, Math.round((0.5 + rnd() * 6) / step));
    const isSand = rnd() < ratio ? 1 : 0;
    for (let k = i; k < Math.min(n, i + thick); k++) sand[k] = isSand;
    i += thick;
  }
  // Suavizado (transiciones graduales, como la respuesta vertical de una herramienta).
  const smooth = new Float64Array(n);
  const W = 4;
  for (let k = 0; k < n; k++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) {
      s += sand[j]!;
      c++;
    }
    smooth[k] = s / c;
  }

  const make = (f: (vsh: number, k: number) => number) => Float64Array.from({ length: n }, (_, k) => f(1 - smooth[k]!, k));
  const inZone = (k: number, id: string) => {
    const z = ZONES.find((zz) => zz.id === id)!;
    return depth[k]! >= z.top && depth[k]! <= z.base;
  };

  const gr = make((v) => 32 + 85 * v + gauss() * 4);
  const rhob = make((v) => 2.32 + 0.24 * v + gauss() * 0.015);
  const nphi = make((v) => 0.19 + 0.14 * v + gauss() * 0.01);
  const dt = make((v) => 88 + 22 * v + gauss() * 1.5);
  const pef = make((v) => 2.0 + 1.3 * v + gauss() * 0.1);
  const cal = make((v) => 8.6 + 0.9 * v * v + Math.abs(gauss()) * 0.05);
  const bs = make(() => 8.5);
  // Rt. Con hidrocarburo (zona C limpia): mezcla logarítmica arena 25 ohm·m – arcilla 2,2 ohm·m, como siempre.
  // Acuífero (Sw = 1, docs/decisiones/0023 D8): Archie con a = 1 y m = DEMO_M sobre la porosidad efectiva de la
  // muestra (densidad–neutrón de las curvas generadas, matriz 2,65 y fluido 1, por 1 − Vsh) y la Rw que calcula la app
  // con sus valores por defecto (Rw conocida llevada a la temperatura del gradiente), más la conducción de la arcilla
  // en paralelo (Vsh/Rsh). Así m desde el perfil en las zonas acuíferas recupera ≈ DEMO_M, el mismo m con el que se
  // generó el F de los plugs de ejemplo (src/modules/core/example.ts).
  const rt = make((v, k) => {
    const noise = Math.exp(gauss() * 0.08);
    if (inZone(k, 'zone-c') && v < 0.4) return Math.exp(Math.log(25) * (1 - v) + Math.log(R_SHALE) * v) * noise;
    const phiD = (2.65 - rhob[k]!) / 1.65;
    const phiE = Math.max(0, ((phiD + nphi[k]!) / 2) * (1 - v));
    return noise / (Math.pow(phiE, DEMO_M) / demoRw(depth[k]!) + v / R_SHALE);
  });
  // Inducción de arreglo (fase 8b): perfil escalonado plausible por zona, leído con el modelo directo de
  // src/petro/invasion.ts. En la arcilla no hay invasión (Rxo = Rt, diámetro = trépano); en la arena el contraste
  // Rxo/Rt y el diámetro de invasión crecen con la limpieza (contrastes y diámetros que el ajuste puede resolver). La zona C con hidrocarburo tiene Rxo < Rt (lodo dulce
  // que invade un reservorio resistivo); el resto, Rxo > Rt. AT90 es la lectura de 90 in del mismo modelo.
  const INVASION: Record<string, { ratio: number; di: number }> = {
    'zone-a': { ratio: 5.0, di: 40 },
    'zone-b': { ratio: 4.0, di: 50 },
    'zone-c': { ratio: 2.5, di: 60 },
    'zone-d': { ratio: 4.0, di: 45 },
    'zone-e': { ratio: 3.5, di: 40 },
  };
  const R50 = [10, 30, 60, 90];
  const at = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let k = 0; k < n; k++) {
    const v = 1 - smooth[k]!;
    const zone = ZONES.find((zz) => depth[k]! >= zz.top && depth[k]! <= zz.base);
    const inv = (zone && INVASION[zone.id]) || { ratio: 1, di: 8.5 };
    const hydrocarbon = inZone(k, 'zone-c') && v < 0.4;
    const ratio = hydrocarbon ? 0.3 : inv.ratio;
    const sandness = 1 - v;
    const rxo = rt[k]! * Math.pow(ratio, sandness);
    const di = 8.5 + (inv.di - 8.5) * sandness;
    const reading = forwardStepProfile(di, rxo, rt[k]!, R50);
    for (let q = 0; q < 4; q++) at[q]![k] = reading[q]!;
  }
  const [at10, at30, at60, at90] = at as [Float64Array, Float64Array, Float64Array, Float64Array];
  // SP casi vacía, como en el TP.
  const sp = make((v, k) => (k % 500 === 0 ? -40 + 50 * v : NaN));

  const c = (id: string, role: string | null, unit: UnitId, data: Float64Array, description: string): Curve => ({
    id,
    mnemonic: id,
    role,
    unit,
    data,
    description,
    origin: { kind: 'measured', source: 'sintético' },
  });

  const well = createWell({
    id: 'demo-sintetico',
    name: 'Pozo sintético de demostración',
    header: {
      WELL: { value: 'Pozo sintético', description: 'Nombre' },
      FLD: { value: 'Demostración', description: 'Yacimiento' },
      NOTE: { value: 'Datos generados en código (fase 1). No son los datos del TP.' },
    },
    depth,
    depthSourceUnit: 'm',
    curves: [
      c('BS', 'BS', 'in', bs, 'Diámetro de trépano'),
      c('CAL', 'CALI', 'in', cal, 'Caliper'),
      c('GR', 'GR', 'gAPI', gr, 'Rayos gamma'),
      c('SP', 'SP', 'mV', sp, 'Potencial espontáneo'),
      c('ZDEN', 'RHOB', 'g/cm3', rhob, 'Densidad'),
      c('PE', 'PEF', 'b/e', pef, 'Factor fotoeléctrico'),
      c('DT', 'DT', 'us/ft', dt, 'Sónico'),
      c('NPHI', 'NPHI', 'v/v', nphi, 'Porosidad neutrónica'),
      c('AT10', 'RA10', 'ohm.m', at10, 'Inducción 10 in'),
      c('AT30', 'RA30', 'ohm.m', at30, 'Inducción 30 in'),
      c('AT60', 'RM', 'ohm.m', at60, 'Inducción 60 in'),
      c('AT90', 'RT', 'ohm.m', at90, 'Inducción 90 in'),
    ],
  });
  return { well, zones: ZONES.map((z) => ({ ...z })) };
}
