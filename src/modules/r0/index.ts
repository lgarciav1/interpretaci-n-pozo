/**
 * Módulo R0 — resistividad mojada (F16). Quick-look de Archie en la pista de resistividad: la resistividad que tendría
 * la roca con 100 % de agua, a·Rw/φ^m. Donde Rt queda por encima de R0 hay hidrocarburo.
 * Bucle por segmento con la función escalar: Rw varía muestra a muestra (curva RW, corregida por temperatura) y a, m
 * se comparten con Archie (SHARED_PARAMS: un solo control para los dos). Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from '../../core/module';
import { wetResistivity } from '../../petro/saturation';
import { SHARED_PARAMS } from '../sharedParams';

export default defineModule({
  id: 'r0',
  name: 'R0 — Resistividad mojada',
  description: 'Resistividad de la roca con 100 % de agua, para leer el hidrocarburo como la separación entre Rt y R0.',
  category: 'saturation',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
    rw: input.curve('RW'),
  },
  params: {
    a: SHARED_PARAMS.a,
    m: SHARED_PARAMS.m,
  },
  outputs: {
    r0: output.curve('R0'),
  },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const { a, m } = s.params;
      for (let i = s.start; i < s.end; i++) out[i] = wetResistivity(inputs.phi[i]!, inputs.rw[i]!, a, m);
    }
    return { r0: out };
  },
  docs: {
    summary:
      'Resistividad que tendría la roca si sus poros estuvieran llenos de agua de formación (Sw = 1), con la ley de Archie. Se dibuja en la pista de resistividad junto a Rt: donde las dos coinciden la roca es acuífera; donde Rt supera a R0 hay hidrocarburo (el relleno entre ambas lo marca). Es la misma ley que la Sw de Archie, de modo que Sw = (R0/Rt)^(1/n); vale como lectura rápida en arenas limpias, y en arenas arcillosas Rt queda por debajo de lo esperado.',
    equations: [
      { latex: 'R_0 = \\frac{a\\,R_w}{\\phi^{m}}', description: 'Resistividad con 100 % de agua (Sw = 1). Sin recortar.' },
      { latex: 'S_w = \\left(\\frac{R_0}{R_t}\\right)^{1/n}', description: 'Relación con Archie: Rt = R0 donde Sw = 1; Rt > R0 donde Sw < 1.' },
    ],
    references: [
      'Archie, G. E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. Trans. AIME 146.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
  },
});
