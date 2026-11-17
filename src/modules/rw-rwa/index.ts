/**
 * Módulo RWA/RW — Rw por Rwa mínima. Ver 0007, C12.
 * RWA = Rt·φ^m/a por muestra (a la temperatura de formación). La referencia a 24 °C se toma de un percentil bajo
 * de RWA en muestras poco arcillosas (en una zona limpia con agua el mínimo de Rwa es Rw); RW se lleva después a la
 * temperatura de cada muestra con Arps.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { apparentWaterResistivity } from '../../petro/rw';
import { intervalStats, percentile } from '../../petro/stats';
import { arpsResistivityC } from '../../petro/temperature';
import { SHARED_PARAMS } from '../sharedParams';

/** Temperatura de referencia de Rwa/Rw (°C): 75 °F. */
const T_REF_C = 24;

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

export default defineModule({
  id: 'rw-rwa',
  name: 'Rw por Rwa mínima',
  description: 'Estima Rw como un percentil bajo de la resistividad aparente del agua en muestras limpias del pozo o de cada zona.',
  category: 'water',
  workspace: 'petrophysics',
  inputs: {
    rt: input.curve('RT'),
    phi: input.curve('PHIE'),
    temp: input.curve('TEMP'),
    vsh: input.optionalCurve('VSH'),
  },
  params: {
    a: SHARED_PARAMS.a,
    m: SHARED_PARAMS.m,
    mode: param.enum({
      label: 'Alcance de Rw',
      tooltip:
        'Un valor de Rw para todo el pozo, o uno por zona. Por zona, una zona con hidrocarburo (sin agua) da una Rw demasiado alta.',
      options: [
        { value: 'well', label: 'Un Rw para todo el pozo' },
        { value: 'zone', label: 'Un Rw por zona' },
      ],
      default: 'well',
    }),
    percentile: param.number({
      label: 'Percentil de Rwa',
      tooltip: 'Fracción de las muestras con Rwa por debajo del valor elegido. 0,10 toma el décimo percentil; más bajo se acerca al mínimo.',
      default: 0.1,
      min: 0.01,
      max: 0.5,
      step: 0.01,
      unit: 'v/v',
    }),
    vshMax: param.number({
      label: 'Vsh máxima de las muestras',
      tooltip: 'Solo se usan muestras con volumen de arcilla no mayor que este valor. Sin curva de Vsh se usan todas.',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.01,
      unit: 'v/v',
    }),
  },
  outputs: {
    rwa: output.curve('RWA'),
    rw: output.curve('RW'),
    byZone: output.table('RW_RWA_BY_ZONE', {
      label: 'Rw por Rwa mínima, por zona',
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'temp', label: 'Temperatura', unit: 'degC' },
        { key: 'rw', label: 'Rw a T', unit: 'ohm.m' },
        { key: 'count', label: 'Muestras usadas' },
      ],
    }),
  },
  compute({ n, thickness, inputs, params, segments, zones, warn }) {
    const rwa = new Float64Array(n);
    const rwaRef = new Float64Array(n).fill(NaN); // Rwa a 24 °C de las muestras elegibles; NaN = excluida
    for (const s of segments) {
      const { a, m } = s.params;
      for (let i = s.start; i < s.end; i++) {
        const r = apparentWaterResistivity(inputs.rt[i]!, inputs.phi[i]!, a, m);
        rwa[i] = r;
        const v = inputs.vsh ? inputs.vsh[i]! : 0;
        // sin VSH se usan todas; con VSH, solo las que tienen dato y no superan el máximo
        if (v <= params.vshMax) rwaRef[i] = arpsResistivityC(r, inputs.temp[i]!, T_REF_C);
      }
    }

    const rw = new Float64Array(n);
    const rows: Record<string, TableCell>[] = [];
    const nameOf = (id: string | null) => (id ? (zones.find((z) => z.id === id)?.name ?? id) : null);
    const countFinite = (start: number, end: number) => {
      let c = 0;
      for (let i = start; i < end; i++) if (Number.isFinite(rwaRef[i]!)) c++;
      return c;
    };

    const wellUsed = countFinite(0, n);
    const wellRef = params.mode === 'well' ? percentile(rwaRef, params.percentile, 0, n) : NaN;
    if (params.mode === 'well' && n > 0 && Number.isNaN(wellRef)) {
      warn('Ninguna muestra del pozo cumple el filtro de Vsh y tiene Rwa válida: Rw queda sin dato.');
    }

    for (const s of segments) {
      if (s.end <= s.start) continue;
      const name = nameOf(s.zoneId);
      const label = name ?? (zones.length === 0 ? 'Pozo completo' : 'Fuera de zonas');
      let ref = wellRef;
      let used = countFinite(s.start, s.end);
      if (params.mode === 'zone') {
        ref = percentile(rwaRef, params.percentile, s.start, s.end);
        if (Number.isNaN(ref)) {
          warn(`${name ? `En la zona ${name}` : 'Fuera de las zonas'}, ninguna muestra cumple el filtro de Vsh y tiene Rwa válida: Rw queda sin dato.`, { zoneId: s.zoneId ?? undefined });
        }
      } else {
        used = wellUsed;
      }
      for (let i = s.start; i < s.end; i++) rw[i] = arpsResistivityC(ref, T_REF_C, inputs.temp[i]!);
      const T = intervalStats(inputs.temp, thickness, s.start, s.end).mean;
      rows.push({ zone: label, temp: num(T), rw: num(arpsResistivityC(ref, T_REF_C, T)), count: used });
    }
    return { rwa, rw, byZone: { rows } };
  },
  docs: {
    summary:
      'Rw por Rwa mínima: en una zona limpia con agua, la resistividad aparente del agua es Rw; el mínimo (aquí, un percentil bajo para ignorar ruido) la estima. Rwa se lleva a 24 °C para comparar muestras a distinta temperatura y Rw vuelve a la temperatura de cada muestra.',
    equations: [
      { latex: 'R_{wa} = \\frac{R_t\\,\\phi^{m}}{a}', description: 'En una zona con 100 % de agua, Rwa = Rw.' },
      { latex: 'R_w(T) = R_{w,24}\\,\\frac{24 + 21{,}5}{T + 21{,}5}', description: 'Corrección de Arps, temperaturas en °C.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16 (Rwa).',
      'Arps, J. J. (1953). The effect of temperature on the density and electrical resistivity of sodium chloride solutions. Trans. AIME 198.',
    ],
    notes: 'El percentil elegido por encima del mínimo descarta valores espurios de Rwa (RT bajo por derrumbes, φ subestimada).',
  },
});
