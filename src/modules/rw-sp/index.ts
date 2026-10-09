/**
 * Módulo RW — Rw desde el SP. Ver 0007, C11 y D2.
 * Por segmento (zona): temperatura media, Rmf a esa temperatura, Rmfe, SSP = SP de arena limpia − línea base de
 * arcillas y Rw por la ecuación del SP; después se lleva a la temperatura de cada muestra con Arps (curva RW).
 * La curva SP identifica el método (y la usa el panel); el cálculo usa los valores de los parámetros.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { equivalentMudFiltrateResistivity, RMFE_THRESHOLD_75F, spCoefficient, waterResistivityFromSp } from '../../petro/rw';
import { intervalStats } from '../../petro/stats';
import { arpsResistivityC, celsiusToFahrenheit, fahrenheitToCelsius } from '../../petro/temperature';
import { SHARED_PARAMS } from '../sharedParams';

/** 75 °F en °C: temperatura a la que se decide la rama de Rmfe. */
const T_75F_C = fahrenheitToCelsius(75);

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

export default defineModule({
  id: 'rw-sp',
  name: 'Rw desde el SP',
  description: 'Resistividad del agua de formación a partir de la deflexión del potencial espontáneo en una arena limpia con agua.',
  category: 'water',
  workspace: 'petrophysics',
  inputs: {
    sp: input.curve('SP'),
    temp: input.curve('TEMP'),
  },
  params: {
    spShale: param.number({
      label: 'Línea base de arcillas',
      tooltip: 'Lectura del SP frente a las arcillas de la zona (la referencia desde la que se mide la deflexión).',
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: 'mV',
      scope: 'zone',
    }),
    spClean: param.number({
      label: 'SP de arena limpia con agua',
      tooltip: 'Lectura del SP frente a una arena limpia y gruesa con agua. Suele ser negativa (a la izquierda de la línea base).',
      default: -60,
      min: -250,
      max: 100,
      step: 0.5,
      unit: 'mV',
      scope: 'zone',
    }),
    rmf: SHARED_PARAMS.rmf,
    tRmf: SHARED_PARAMS.tRmf,
  },
  outputs: {
    rw: output.curve('RW'),
    byZone: output.table('RW_SP_BY_ZONE', {
      label: 'Rw desde el SP por zona',
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'temp', label: 'Temperatura', unit: 'degC' },
        { key: 'rmfT', label: 'Rmf a T', unit: 'ohm.m' },
        { key: 'rmfe', label: 'Rmfe', unit: 'ohm.m' },
        { key: 'ssp', label: 'SSP', unit: 'mV' },
        { key: 'k', label: 'K del SP', unit: 'mV' },
        { key: 'rw', label: 'Rw a T', unit: 'ohm.m' },
      ],
    }),
  },
  compute({ n, thickness, inputs, segments, zones, warn }) {
    const rw = new Float64Array(n);
    const rows: Record<string, TableCell>[] = [];
    const nameOf = (id: string | null) => (id ? (zones.find((z) => z.id === id)?.name ?? id) : null);

    for (const s of segments) {
      const name = nameOf(s.zoneId);
      const where = name ? `en la zona ${name}` : zones.length === 0 ? 'en el pozo' : 'fuera de las zonas';
      const { spShale, spClean, rmf, tRmf } = s.params;

      const T = intervalStats(inputs.temp, thickness, s.start, s.end).mean;
      const rmfT = arpsResistivityC(rmf, tRmf, T);
      const rmf75 = arpsResistivityC(rmf, tRmf, T_75F_C);
      const rmfe = equivalentMudFiltrateResistivity(rmfT, rmf75);
      const ssp = spClean - spShale;
      const tF = celsiusToFahrenheit(T);
      const rwT = waterResistivityFromSp(ssp, rmfe, tF);

      if (ssp >= 0) warn(`${where}, la arena limpia no se desvía a la izquierda de la línea base de arcillas: no hay deflexión de SP para calcular Rw.`);
      if (rmf75 <= RMFE_THRESHOLD_75F) {
        warn(`${where}, el filtrado es muy salado (Rmf a 75 °F ≤ 0,1 Ω·m): se tomó Rmfe igual a Rmf, sin la carta de corrección; Rw es aproximada.`);
      }
      let spCount = 0;
      for (let i = s.start; i < s.end; i++) if (!Number.isNaN(inputs.sp[i]!)) spCount++;
      if (s.end > s.start && spCount === 0) warn(`${where}, el SP no tiene datos: revisá las lecturas elegidas para la línea base y la arena limpia.`);
      if (s.end > s.start && Number.isNaN(T)) warn(`${where}, la temperatura no tiene datos: Rw queda sin dato.`);

      for (let i = s.start; i < s.end; i++) rw[i] = arpsResistivityC(rwT, T, inputs.temp[i]!);

      if (s.end > s.start) {
        rows.push({
          zone: name ?? (zones.length === 0 ? 'Pozo completo' : 'Fuera de zonas'),
          temp: num(T),
          rmfT: num(rmfT),
          rmfe: num(rmfe),
          ssp: num(ssp),
          k: num(spCoefficient(tF)),
          rw: num(rwT),
        });
      }
    }
    return { rw, byZone: { rows } };
  },
  docs: {
    summary:
      'Rw desde el potencial espontáneo: la deflexión estática (SSP) de una arena limpia con agua respecto de las arcillas, junto con el filtrado de lodo a la temperatura de formación, da la resistividad del agua. Se corrige muestra a muestra por temperatura.',
    equations: [
      { latex: 'K = 60 + 0{,}133\\,T_f\\ (^{\\circ}F)', description: 'Coeficiente del SP, en mV por década.' },
      { latex: 'SSP = SP_{limpia} - SP_{arcilla}' },
      { latex: 'R_{mfe} = 0{,}85\\,R_{mf}(T_f)', description: 'Si Rmf a 75 °F > 0,1 Ω·m; si no, se aproxima Rmfe ≈ Rmf(Tf).' },
      { latex: 'R_{we} = R_{mfe}\\,10^{SSP/K}', description: 'Se toma Rw ≈ Rwe (aproximación: no se usa la carta SP-2).' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, cap. 4 (SP).',
      'Schlumberger (2009). Log Interpretation Charts, cartas SP-1 y SP-2.',
    ],
    notes:
      'Rwe se toma como Rw: es válido para NaCl con salinidad moderada a baja. En aguas dulces (Rwe > ~0,12 Ω·m a 75 °F) Rw difiere de Rwe. Para Rmf a 75 °F ≤ 0,1 Ω·m tampoco se aplica la carta de Rmfe.',
  },
});
