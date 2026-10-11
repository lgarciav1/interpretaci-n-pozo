/**
 * Documentación de la calculadora de agua de formación para el módulo Ecuaciones. La calculadora es un panel del dock
 * (no un módulo del motor, no produce curvas), así que su documentación vive acá con la misma forma que `docs` de un
 * módulo. Las ecuaciones solo se muestran en el módulo Ecuaciones, nunca en la interfaz del panel.
 */
import type { ModuleDocs } from '../../core/module';

export const FORMATION_WATER_DOCS: ModuleDocs = {
  summary:
    'Conversión entre salinidad de NaCl equivalente, temperatura y resistividad del agua de formación (Rw): completados dos valores se calcula el tercero. La salinidad se pasa a Rw a 75 °F con la correlación de Bateman y Konen (ajuste de la carta Gen-9 de Schlumberger) y la temperatura con la corrección de Arps. Válido de 1 000 a 250 000 ppm (error ≲ 5 % hasta 150 000 ppm) y hasta ≈ 200 °C; fuera de eso se avisa. La Rw de una salmuera con otras sales necesita los multiplicadores iónicos de la carta Gen-8 (no implementados). Rmf desde Rm queda pendiente.',
  equations: [
    { latex: 'R_{w,75} = 0{,}0123 + \\frac{3647{,}5}{C^{0{,}955}}', description: 'C en ppm de NaCl; Rw a 75 °F (23,9 °C) en ohm·m.' },
    { latex: 'C = \\left(\\frac{3647{,}5}{R_{w,75} - 0{,}0123}\\right)^{1/0{,}955}', description: 'Inversa; exige Rw,75 > 0,0123 ohm·m.' },
    { latex: 'R_w(T) = R_{w,75}\\,\\frac{75 + 6{,}77}{T + 6{,}77}', description: 'Arps, T en °F (en °C: 21,5 y 23,9 °C).' },
    { latex: 'T = R_{w,75}\\,\\frac{75 + 6{,}77}{R_w} - 6{,}77', description: 'Temperatura a la que una solución de salinidad C tiene resistividad Rw (°F).' },
  ],
  references: [
    'Bateman, R. M. y Konen, C. E. (1977). The log analyst and the programmable pocket calculator. The Log Analyst 18(5).',
    'Arps, J. J. (1953). The effect of temperature on the density and electrical resistivity of sodium chloride solutions. Trans. AIME 198.',
    'Schlumberger. Log Interpretation Charts, cartas Gen-8 y Gen-9.',
    'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
  ],
};
