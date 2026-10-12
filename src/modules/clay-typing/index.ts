/** Geo-2: clasificación orientativa Th–K y alertas de uranio; definición pura para el Worker. */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { CLAY_REGIONS, classifyClay, thoriumUranium, uraniumFlag } from '../../petro/mineralogy';

export const CLAY_ZONES = 'CLAY_ZONES';
const cell = (x: number): TableCell => Number.isFinite(x) ? x : null;

export default defineModule({
  id: 'clay-typing', name: 'Tipo de arcilla · GR espectral',
  description: 'Th–K, afinidad mineral y contexto Th/U por zona. El uranio alto es una alerta contextual.',
  category: 'geology', workspace: 'geology',
  roles: [
    { id: 'CLAY_TYPE', label: 'Afinidad de arcilla', unit: 'unitless', family: 'lithology', origin: 'computed', display: { color: '#96644a', scale: 'linear', min: 0, max: 8 } },
    { id: 'CLAY_DISTANCE', label: 'Distancia a región Th–K', unit: 'unitless', family: 'other', origin: 'computed', display: { color: '#817685', scale: 'linear', min: 0, max: 1 } },
    { id: 'TH_U', label: 'Cociente Th/U', unit: 'unitless', family: 'spectral', origin: 'computed', display: { color: '#508c98', scale: 'linear', min: 0, max: 15 } },
    { id: 'IND_HIGH_U', label: 'Bandera de uranio alto', unit: 'unitless', family: 'flag', origin: 'computed', display: { color: '#ad44a2', scale: 'linear', min: 0, max: 1 } },
  ],
  inputs: { k: input.curve('POTA'), th: input.curve('THOR'), u: input.optionalCurve('URAN') },
  params: { uraniumThreshold: param.number({ label: 'Uranio alto', tooltip: 'Umbral práctico: una alerta requiere confirmar materia orgánica o inundación máxima con otros datos.', default: 5, min: 0.1, max: 20, step: 0.1, unit: 'ppm', scope: 'zone' }) },
  outputs: {
    type: output.curve('CLAY_TYPE'), distance: output.curve('CLAY_DISTANCE'), ratio: output.curve('TH_U'), highU: output.curve('IND_HIGH_U'),
    zones: output.table(CLAY_ZONES, { label: 'Arcilla y ambiente por zona', hidden: true, columns: [
      { key: 'zone', label: 'Zona', kind: 'text' }, { key: 'clay', label: 'Afinidad dominante', kind: 'text' },
      { key: 'samples', label: 'Muestras válidas' }, { key: 'ratio', label: 'Th/U medio' },
      { key: 'environment', label: 'Contexto', kind: 'text' }, { key: 'outside', label: 'Fuera de regiones (%)' },
      { key: 'ambiguous', label: 'Ambiguas (%)' }, { key: 'distance', label: 'Distancia media' }, { key: 'highU', label: 'U alto (%)' },
    ] }),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const type = new Float64Array(n).fill(NaN), distance = new Float64Array(n).fill(NaN);
    const ratio = new Float64Array(n).fill(NaN), highU = new Float64Array(n).fill(NaN);
    const inside = new Uint8Array(n), ambiguous = new Uint8Array(n);
    for (const s of segments) for (let i = s.start; i < s.end; i++) {
      const c = classifyClay(inputs.k[i], inputs.th[i]);
      if (c) { type[i] = c.index; distance[i] = c.distance; inside[i] = Number(c.inside); ambiguous[i] = Number(c.ambiguous); }
      if (inputs.u) { ratio[i] = thoriumUranium(inputs.th[i], inputs.u[i]).ratio; highU[i] = uraniumFlag(inputs.u[i], s.params.uraniumThreshold); }
    }
    const rows = zones.map(z => {
      const counts = new Map<number, number>(); let count = 0, outside = 0, amb = 0, dist = 0, rsum = 0, rn = 0, flags = 0, un = 0;
      for (let i = z.start; i < z.end; i++) {
        if (Number.isFinite(type[i])) { counts.set(type[i], (counts.get(type[i]) ?? 0) + 1); count++; outside += 1 - inside[i]; amb += ambiguous[i]; dist += distance[i]; }
        if (Number.isFinite(ratio[i])) { rsum += ratio[i]; rn++; }
        if (Number.isFinite(highU[i])) { flags += highU[i]; un++; }
      }
      const dominant = [...counts].sort((a,b) => b[1]-a[1])[0]?.[0];
      const meanRatio = rn ? rsum/rn : NaN;
      return { zoneId: z.id, zone: z.name, clay: dominant === undefined ? 'Sin dato' : CLAY_REGIONS[dominant - 1]?.label ?? 'Sin dato', samples: count,
        ratio: cell(meanRatio), environment: thoriumUranium(meanRatio, 1).label, outside: cell(count ? 100*outside/count : NaN), ambiguous: cell(count ? 100*amb/count : NaN), distance: cell(count ? dist/count : NaN), highU: cell(un ? 100*flags/un : NaN) };
    });
    warn('Regiones Th–K aproximadas, SIN VERIFICAR contra la carta CP-19: se informa afinidad, no identificación mineral definitiva.');
    return { type, distance, ratio, highU, zones: { rows } };
  },
  docs: {
    summary: 'Clasifica por contención de regiones Th–K aproximadas; fuera de ellas devuelve la región más próxima y la distancia normalizada. Conserva la ambigüedad de regiones superpuestas. El contexto Th/U y la alerta de U no identifican por sí solos ambiente, materia orgánica ni superficies estratigráficas.',
    equations: [{ latex: 'R=Th/U', description: 'Cociente con ambos elementos en ppm; U no positivo queda sin dato.' }],
    references: ['Schlumberger, Log Interpretation Charts, carta CP-19 (vértices aproximados SIN VERIFICAR).', 'Quirein et al. (1982), aplicaciones del GR espectral.', 'Adams y Weaver (1958), cociente Th/U en rocas sedimentarias.'],
    notes: 'Umbral U configurable, práctico. Los campos de minerales afines incluyen micas y feldespato K. No se calcula volumen de arcilla con esta clasificación.',
  },
});
