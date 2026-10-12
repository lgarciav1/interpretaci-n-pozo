/**
 * Módulo de tipos de roca (fase 8, función P; docs/decisiones/0024-rock-typing.md). Definición PURA (la ejecuta el
 * Web Worker).
 *
 * Lleva al pozo las familias de roca que se arman en el panel «Tipos de roca» con los plugs: por muestra, con la
 * porosidad efectiva y la permeabilidad vigente del perfil (la del modelo k–φ de corona si es la fuente elegida),
 * calcula FZI, R35 de Winland y la CLASE, que la superposición del módulo dibuja como pista de colores.
 *
 * El motor no ve los plugs (0009, D1): los límites de FZI los elige el panel (automáticos por Fisher–Jenks o
 * manuales) y «Llevar al pozo» los escribe en estos parámetros, como «Aplicar» del modelo k–φ (0010, D4).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { classifyByBoundsInto, flowZoneIndexInto, PORT_CLASSES, portClassIndexInto, winlandR35Into } from '../../petro/rockTyping';

export const ROCK_TYPING_ID = 'rock-typing';
/** Tabla por clase (la lee Resultados; el panel no la necesita). */
export const ROCK_TYPES_TABLE = 'ROCK_TYPES';
/** Máximo de unidades de flujo (y de límites + 1). */
export const MAX_FLOW_UNITS = 6;
export const MIN_FLOW_UNITS = 2;
/** Claves de los límites de FZI, en orden: con n unidades se usan las n − 1 primeras. */
export const BOUND_KEYS = ['fzi1', 'fzi2', 'fzi3', 'fzi4', 'fzi5'] as const;
/** Límites de fábrica (µm): bandas en escala log típicas de areniscas, de mala a muy buena calidad. */
export const DEFAULT_BOUNDS: readonly number[] = [0.25, 0.6, 1.5, 3.5, 8];

export type RockTypingMethod = 'fzi' | 'winland';

const boundParam = (i: number) =>
  param.number({
    label: `Límite de FZI ${i + 1}–${i + 2}`,
    tooltip: `Indicador de zona de flujo que separa la unidad ${i + 1} de la ${i + 2}. Lo escribe «Llevar al pozo» desde el panel Tipos de roca (automático sobre los plugs o manual).`,
    default: DEFAULT_BOUNDS[i]!,
    min: 0.01,
    max: 100,
    unit: 'um',
    scale: 'log',
    group: 'Límites de FZI',
  });

/** Límites usados con n unidades (los n − 1 primeros, finitos y > 0), en el orden guardado. */
export function activeBounds(values: Readonly<Record<string, unknown>>, nUnits: number): number[] {
  const n = Math.max(MIN_FLOW_UNITS, Math.min(MAX_FLOW_UNITS, Math.round(nUnits)));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const v = values[BOUND_KEYS[i]!];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

/** ¿Límites estrictamente crecientes? */
export const ascending = (b: readonly number[]) => b.every((v, i) => i === 0 || v > b[i - 1]!);

/** Rótulo corto de una clase: «UF 3» (unidad de flujo, 1 = FZI más bajo) o el de la clase de garganta («Meso»). */
export function classLabel(method: RockTypingMethod, index: number): string {
  return method === 'winland' ? (PORT_CLASSES[index]?.label ?? '—') : `UF ${index + 1}`;
}

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

export default defineModule({
  id: ROCK_TYPING_ID,
  name: 'Tipos de roca (FZI y Winland)',
  description:
    'Indicador de zona de flujo y radio de garganta R35 por muestra con la porosidad efectiva y la permeabilidad del perfil, y la clase de roca (unidades de flujo por FZI o clases de garganta de Winland) como pista de colores. Los límites se eligen con los plugs en el panel Tipos de roca.',
  category: 'permeability',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
    k: input.curve('PERM'),
  },
  params: {
    method: param.enum({
      label: 'Clasificación',
      tooltip: 'Unidades de flujo por bandas de FZI (límites elegidos con los plugs) o clases de tamaño de garganta por el R35 de Winland (nano, micro, meso, macro, mega).',
      options: [
        { value: 'fzi', label: 'Unidades de flujo (FZI)' },
        { value: 'winland', label: 'Clases de garganta (Winland R35)' },
      ],
      default: 'fzi',
      group: 'Clasificación',
    }),
    nUnits: param.number({
      label: 'Unidades de flujo',
      tooltip: 'Cantidad de unidades de flujo por FZI: se usan los primeros límites (una unidad más que límites).',
      default: 4,
      min: MIN_FLOW_UNITS,
      max: MAX_FLOW_UNITS,
      step: 1,
      group: 'Clasificación',
    }),
    fzi1: boundParam(0),
    fzi2: boundParam(1),
    fzi3: boundParam(2),
    fzi4: boundParam(3),
    fzi5: boundParam(4),
  },
  outputs: {
    fzi: output.curve('FZI'),
    r35: output.curve('R35'),
    rockType: output.curve('ROCK_TYPE'),
    byClass: output.table(ROCK_TYPES_TABLE, {
      label: 'Tipos de roca en el pozo',
      columns: [
        { key: 'rockType', label: 'Tipo de roca', kind: 'text' },
        { key: 'lower', label: 'Desde', unit: 'um' },
        { key: 'upper', label: 'Hasta', unit: 'um' },
        { key: 'n', label: 'Muestras' },
        { key: 'thickness', label: 'Espesor', unit: 'm' },
        { key: 'phi', label: 'φ media', unit: 'v/v' },
        { key: 'k', label: 'k media geométrica', unit: 'mD' },
      ],
    }),
  },
  compute({ n, inputs, params, thickness, warn }) {
    const { phi, k } = inputs;
    const fzi = new Float64Array(n);
    const r35 = new Float64Array(n);
    const rockType = new Float64Array(n);
    flowZoneIndexInto(phi, k, fzi);
    winlandR35Into(phi, k, r35);

    const method: RockTypingMethod = params.method;
    let edges: number[];
    if (method === 'winland') {
      portClassIndexInto(r35, rockType);
      edges = PORT_CLASSES.slice(0, -1).map((c) => c.max);
    } else {
      edges = activeBounds(params, params.nUnits);
      if (edges.length < Math.round(params.nUnits) - 1) warn('Hay límites de FZI sin valor: se usan menos unidades de flujo.');
      if (!ascending(edges)) {
        warn('Los límites de FZI no están en orden creciente: se ordenan. Elegilos de nuevo en el panel Tipos de roca.');
        edges = [...edges].sort((a, b) => a - b);
      }
      classifyByBoundsInto(fzi, rockType, edges);
    }

    // Estadística por clase (φ media, k media geométrica y espesor de las muestras clasificadas).
    const nc = edges.length + 1;
    const cnt = new Float64Array(nc);
    const h = new Float64Array(nc);
    const sPhi = new Float64Array(nc);
    const sLogK = new Float64Array(nc);
    let any = false;
    for (let i = 0; i < n; i++) {
      const c = rockType[i]!;
      if (!Number.isFinite(c)) continue;
      any = true;
      cnt[c]!++;
      h[c]! += thickness[i]!;
      sPhi[c]! += phi[i]!;
      sLogK[c]! += Math.log10(k[i]!);
    }
    if (!any) warn('Ninguna muestra con porosidad efectiva entre 0 y 1 y permeabilidad positiva: no hay tipos de roca.');
    const rows: Record<string, TableCell>[] = [];
    for (let c = 0; c < nc; c++) {
      rows.push({
        rockType: classLabel(method, c),
        lower: c === 0 ? (method === 'winland' ? 0 : null) : num(edges[c - 1]!),
        upper: c === nc - 1 ? null : num(edges[c]!),
        n: cnt[c]!,
        thickness: cnt[c]! > 0 ? h[c]! : 0,
        phi: cnt[c]! > 0 ? sPhi[c]! / cnt[c]! : null,
        k: cnt[c]! > 0 ? 10 ** (sLogK[c]! / cnt[c]!) : null,
      });
    }
    return { fzi, r35, rockType, byClass: { rows } };
  },
  docs: {
    summary:
      'Tipos de roca a partir de la porosidad y la permeabilidad. El índice de calidad de reservorio RQI y el indicador de zona de flujo FZI (Amaefule et al., 1993) separan unidades de flujo hidráulico: rocas con igual FZI caen sobre una misma recta de pendiente 1 en el gráfico log RQI – log φz y comparten la relación k–φ. El radio de garganta R35 de Winland (y los R10–R75 de Pittman) clasifica la roca por el tamaño de garganta que domina el flujo: nano < 0,1 µm, micro 0,1–0,5, meso 0,5–2, macro 2–10 y mega > 10 (Martin et al., 1997). Las clases se definen con los plugs (Fisher–Jenks sobre log FZI o límites manuales) y se llevan al pozo con la permeabilidad del perfil, que conviene que sea la del modelo k–φ de corona. Sin ensayos de presión capilar, la función J de Leverett, las curvas Pc–Sw y la distribución de gargantas de Washburn se ilustran con un ejemplo de libro.',
    equations: [
      { latex: '\\log R_{35} = 0{,}732 + 0{,}588\\,\\log k - 0{,}864\\,\\log \\phi_{\\%}', description: 'Winland (Kolodzie, 1980): radio de garganta (µm) al 35 % de saturación de mercurio; k en mD, φ en %.' },
      { latex: '\\log R_{x} = a_x + b_x\\,\\log k + c_x\\,\\log \\phi_{\\%}', description: 'Pittman (1992): radios R10 a R75 con los coeficientes de su tabla.' },
      { latex: 'RQI = 0{,}0314\\,\\sqrt{k/\\phi},\\qquad \\phi_z = \\frac{\\phi}{1-\\phi},\\qquad FZI = \\frac{RQI}{\\phi_z}', description: 'Amaefule et al. (1993): índice de calidad de reservorio y FZI en µm (k en mD, φ en v/v).' },
      { latex: 'k = 1014\\,FZI^2\\,\\frac{\\phi^3}{(1-\\phi)^2}', description: 'Relación k–φ de una unidad de flujo (recta de pendiente 1 en log RQI – log φz).' },
      { latex: '\\text{GVF} = 1 - \\frac{SS_{dentro}}{SS_{total}}', description: 'Bondad de la clasificación de Fisher–Jenks sobre log FZI (1 = clases sin dispersión interna).' },
      { latex: 'J(S_w) = 0{,}2166\\,\\frac{P_c}{\\sigma\\,|\\cos\\theta|}\\sqrt{\\frac{k}{\\phi}}', description: 'Función J de Leverett (Pc en psi, σ en dyn/cm, k en mD).' },
      { latex: 'P_c = P_d\\,\\left(S_w^{*}\\right)^{-1/\\lambda},\\qquad S_w^{*} = \\frac{S_w - S_{wirr}}{1 - S_{wirr}}', description: 'Brooks y Corey (1964): forma de las curvas de presión capilar de ejemplo.' },
      { latex: 'r = \\frac{2\\,\\sigma\\,|\\cos\\theta|}{P_c}', description: 'Washburn: radio de garganta que invade el mercurio a la presión Pc (mercurio–aire: r[µm] ≈ 106,7 / Pc[psi]).' },
    ],
    references: [
      'Kolodzie, S. (1980). Analysis of pore throat size and use of the Waxman–Smits equation to determine OOIP in Spindle Field, Colorado. SPE 9382.',
      'Pittman, E.D. (1992). Relationship of porosity and permeability to various parameters derived from mercury injection–capillary pressure curves for sandstone. AAPG Bulletin 76(2).',
      'Amaefule, J.O., Altunbay, M., Tiab, D., Kersey, D.G. y Keelan, D.K. (1993). Enhanced reservoir description: using core and log data to identify hydraulic (flow) units and predict permeability in uncored intervals/wells. SPE 26436.',
      'Martin, A.J., Solomon, S.T. y Hartmann, D.J. (1997). Characterization of petrophysical flow units in carbonate reservoirs. AAPG Bulletin 81(5).',
      'Leverett, M.C. (1941). Capillary behavior in porous solids. Trans. AIME 142.',
      'Brooks, R.H. y Corey, A.T. (1964). Hydraulic properties of porous media. Hydrology Papers 3, Colorado State University.',
      'Tiab, D. y Donaldson, E.C. (2015). Petrophysics, 4.ª ed. Gulf Professional Publishing, caps. 3 y 5.',
    ],
  },
});
