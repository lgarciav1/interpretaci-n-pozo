/**
 * Módulo RW — Rw conocida (de análisis de agua o del encabezado), llevada a temperatura de formación. Ver 0007, C10.
 * Es el primero de RW en el registro: fuente por defecto, siempre puede correr (TEMP viene de temp-gradient).
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { arpsResistivityC } from '../../petro/temperature';

export default defineModule({
  id: 'rw-manual',
  name: 'Rw conocida',
  description: 'Resistividad del agua de formación conocida, corregida por temperatura a cada profundidad.',
  category: 'water',
  workspace: 'petrophysics',
  inputs: {
    temp: input.curve('TEMP'),
  },
  params: {
    rwRef: param.number({
      label: 'Rw',
      tooltip: 'Resistividad del agua de formación medida o conocida, a la temperatura indicada abajo.',
      default: 0.05,
      min: 0.005,
      max: 5,
      step: 0.001,
      unit: 'ohm.m',
      scale: 'log',
      scope: 'zone',
    }),
    tRef: param.number({
      label: 'Temperatura de Rw',
      tooltip: 'Temperatura a la que se midió o se informa Rw.',
      default: 24,
      min: 0,
      max: 200,
      step: 0.5,
      unit: 'degC',
      scope: 'zone',
    }),
    correct: param.boolean({
      label: 'Corregir por temperatura',
      tooltip: 'Si está activado, Rw se lleva a la temperatura de formación de cada muestra. Si no, se usa el valor tal cual en toda la zona.',
      default: true,
      scope: 'zone',
    }),
  },
  outputs: {
    rw: output.curve('RW'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const { rwRef, tRef, correct } = s.params;
      for (let i = s.start; i < s.end; i++) out[i] = correct ? arpsResistivityC(rwRef, tRef, inputs.temp[i]!) : rwRef;
    }
    return { rw: out };
  },
  docs: {
    summary: 'Rw conocida, llevada a la temperatura de formación de cada muestra con la corrección de Arps.',
    equations: [{ latex: 'R_w(T) = R_{w,ref}\\,\\frac{T_{ref} + 21{,}5}{T + 21{,}5}', description: 'Temperaturas en °C (equivale a 6,77 con °F).' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.', 'Arps, J. J. (1953). The effect of temperature on the density and electrical resistivity of sodium chloride solutions. Trans. AIME 198.'],
  },
});
