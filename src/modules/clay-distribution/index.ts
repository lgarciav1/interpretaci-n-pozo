/**
 * Distribución de la arcilla · Thomas–Stieber (docs/decisiones/0061; Clase 8, slides 12–14). Clasifica cada muestra
 * como laminar, dispersa o estructural según su posición en el diagrama porosidad total contra Vsh, con los extremos
 * φ de la arena limpia y φ de la lutita como parámetros por zona (se eligen arrastrándolos en la plantilla
 * «Thomas–Stieber» del crossplot libre). Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { CLAY_DISTRIBUTION_CODE, DEFAULT_BAND_TOLERANCE, classifyClayDistribution, validEndpoints } from '../../petro/clayDistribution';

export const CLAY_DIST_ROLE = 'CLAY_DIST';
export const CLAY_DIST_TABLE = 'CLAY_DIST_ZONES';

const pctCell = (part: number, total: number): TableCell => (total > 0 ? (100 * part) / total : null);

export default defineModule({
  id: 'clay-distribution',
  name: 'Distribución de la arcilla · Thomas–Stieber',
  description: 'Arcilla laminar, dispersa o estructural según la posición de cada muestra en el diagrama porosidad total contra Vsh.',
  category: 'shale',
  workspace: ['petrophysics', 'geology'],
  roles: [
    {
      id: CLAY_DIST_ROLE,
      label: 'Distribución de la arcilla',
      unit: 'unitless',
      family: 'lithology',
      origin: 'computed',
      display: { color: '#8a5a2b', scale: 'linear', min: 0, max: 3 },
      description: 'Código por muestra: 0 sin clasificar (arena limpia, lutita o fuera del diagrama), 1 laminar, 2 dispersa, 3 estructural.',
    },
  ],
  inputs: {
    vsh: input.curve('VSH'),
    phit: input.curve('PHIT', { label: 'Porosidad total (densidad–neutrón)' }),
  },
  params: {
    phiSand: param.number({
      label: 'φ de la arena limpia',
      tooltip: 'Porosidad total de la arena sin arcilla (extremo izquierdo del diagrama, Vsh = 0). Se elige arrastrando el punto en la plantilla Thomas–Stieber o con «Estimar de los datos» (percentil 95 de la porosidad con Vsh ≤ 0,1).',
      default: 0.25,
      min: 0.05,
      max: 0.45,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
    }),
    phiShale: param.number({
      label: 'φ de la lutita',
      tooltip: 'Porosidad total de la lutita pura (extremo derecho del diagrama, Vsh = 1), incluida el agua ligada. Debe ser menor que la de la arena. «Estimar de los datos» usa la mediana de la porosidad con Vsh ≥ 0,9.',
      default: 0.1,
      min: 0.005,
      max: 0.4,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
    }),
    bandTolerance: param.number({
      label: 'Banda laminar',
      tooltip: 'Distancia en porosidad a la diagonal dentro de la cual la muestra se toma como laminar (±). También es el margen afuera de los bordes del diagrama antes de dejarla sin clasificar. Por defecto ±0,02, del orden del error de la porosidad de densidad–neutrón.',
      default: DEFAULT_BAND_TOLERANCE,
      min: 0,
      max: 0.1,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    dist: output.curve(CLAY_DIST_ROLE),
    byZone: output.table(CLAY_DIST_TABLE, {
      label: 'Distribución de la arcilla por zona',
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'laminated', label: 'Laminar', unit: '%' },
        { key: 'dispersed', label: 'Dispersa', unit: '%' },
        { key: 'structural', label: 'Estructural', unit: '%' },
        { key: 'unclassified', label: 'Sin clasificar', unit: '%' },
        { key: 'samples', label: 'Muestras con dato' },
        { key: 'dominant', label: 'Predomina', kind: 'text' },
      ],
    }),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const { vsh, phit } = inputs;
    const dist = new Float64Array(n).fill(NaN);
    const bad = new Set<string>();
    const close = new Set<string>();
    for (const s of segments) {
      const { phiSand, phiShale, bandTolerance } = s.params;
      const name = s.zoneId ? (zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId) : 'fuera de las zonas';
      if (validEndpoints(phiSand, phiShale) && phiSand - phiShale < 2 * bandTolerance && s.end > s.start) close.add(name);
      if (!validEndpoints(phiSand, phiShale)) {
        bad.add(name);
        continue;
      }
      for (let i = s.start; i < s.end; i++) {
        const c = classifyClayDistribution(vsh[i]!, phit[i]!, phiSand, phiShale, bandTolerance);
        if (c.reason !== 'no-data') dist[i] = CLAY_DISTRIBUTION_CODE[c.kind];
      }
    }
    for (const z of bad) warn(`La φ de la lutita no es menor que la de la arena (${z}): la distribución queda sin dato.`);
    if (close.size) warn(`φ de la arena y de la lutita difieren menos que dos anchos de la banda laminar (${[...close].join(', ')}): la diagonal es casi horizontal y la clasificación separa poco.`);

    const row = (zone: string, start: number, end: number): Record<string, TableCell> => {
      const c = [0, 0, 0, 0];
      let total = 0;
      for (let i = start; i < end; i++) {
        const v = dist[i]!;
        if (!Number.isFinite(v)) continue;
        c[v]!++;
        total++;
      }
      const classified = c[1]! + c[2]! + c[3]!;
      const names = ['', 'Laminar', 'Dispersa', 'Estructural'];
      const best = classified ? [1, 2, 3].reduce((a, b) => (c[b]! > c[a]! ? b : a)) : 0;
      return {
        zone,
        laminated: pctCell(c[1]!, total),
        dispersed: pctCell(c[2]!, total),
        structural: pctCell(c[3]!, total),
        unclassified: pctCell(c[0]!, total),
        samples: total,
        dominant: classified ? names[best]! : 'Sin dato',
      };
    };
    const rows = zones.length ? zones.map((z) => row(z.name, z.start, z.end)) : [row('Pozo completo', 0, n)];
    return { dist, byZone: { rows } };
  },
  docs: {
    summary:
      'Diagrama de Thomas y Stieber: porosidad total contra volumen de arcilla, con la arena limpia (φ de la arena) en Vsh = 0 y la lutita (φ de la lutita) en Vsh = 1. Si la arcilla está en láminas, cada muestra es una mezcla de arena limpia y lutita y cae sobre la diagonal. Si está dispersa en los poros, la porosidad baja más rápido (región A, debajo de la diagonal) hasta que la arcilla llena todo el espacio poral (vértice inferior) y después reemplaza granos. Si es estructural (granos de arcilla en lugar de granos de cuarzo), la porosidad de la arena se conserva y se suma la de la arcilla (región B, encima). Orienta la elección del modelo de saturación: laminar → Poupon–Leveaux o Indonesia; dispersa → Waxman–Smits o Dual-Water (Simandoux como aproximación). La arcilla dispersa es la que más daña la permeabilidad.',
    equations: [
      { latex: '\\phi_{lam} = (1 - V_{sh})\\,\\phi_{sand} + V_{sh}\\,\\phi_{sh}', description: 'Arena laminada (diagonal), de la arena limpia a la lutita.' },
      { latex: '\\phi_{disp} = \\phi_{sand} - V_{sh}\\,(1 - \\phi_{sh}),\\quad 0 \\le V_{sh} \\le \\phi_{sand}', description: 'Arcilla dispersa que rellena los poros; termina en el vértice inferior (φsand, φsand·φsh).' },
      { latex: '\\phi = V_{sh}\\,\\phi_{sh},\\quad \\phi_{sand} \\le V_{sh} \\le 1', description: 'Arcilla dispersa que reemplaza granos, del vértice inferior a la lutita.' },
      { latex: '\\phi_{str} = \\phi_{sand} + V_{sh}\\,\\phi_{sh},\\quad 0 \\le V_{sh} \\le 1 - \\phi_{sand}', description: 'Arcilla estructural que reemplaza granos; termina en el vértice superior (1 − φsand, φsand + (1 − φsand)·φsh).' },
      { latex: '\\phi = 1 - V_{sh}\\,(1 - \\phi_{sh}),\\quad 1 - \\phi_{sand} \\le V_{sh} \\le 1', description: 'Arcilla estructural que rellena poros, del vértice superior a la lutita.' },
      { latex: '|\\phi - \\phi_{lam}| \\le \\tau', description: 'Banda laminar de ancho ±τ (por defecto 0,02); debajo → dispersa (región A), encima → estructural (región B), hasta τ más allá de los bordes del diagrama.' },
      { latex: '\\phi_{sand} = P_{95}(\\phi_t \\mid V_{sh} \\le 0{,}1),\\quad \\phi_{sh} = P_{50}(\\phi_t \\mid V_{sh} \\ge 0{,}9)', description: 'Estimación de los extremos de los datos («Estimar de los datos»), con un mínimo de 10 muestras por extremo.' },
    ],
    references: [
      'Thomas, E.C. y Stieber, S.J. (1975). The distribution of shale in sandstones and its effect upon porosity. SPWLA 16th Annual Logging Symposium.',
      'Cátedra de Interpretación de Perfiles (FIUBA), Clase 8: mineralogía de arcillas (slides 12–14).',
    ],
    notes: 'Sin clasificar: muestras sin dato, arena limpia (Vsh < 0,1), lutita (Vsh > 0,9, donde todas las rectas convergen) y puntos fuera del diagrama. La clasificación por muestra es orientativa: depende de φsand y φsh, de que la porosidad total y el Vsh estén bien calculados y de que la arena limpia sea la misma en toda la zona. Para confirmar la distribución hacen falta corona, imágenes o RMN.',
  },
});
