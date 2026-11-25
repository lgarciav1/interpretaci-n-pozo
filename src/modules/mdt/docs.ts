/**
 * Documentación de Presiones MDT (gradientes, contactos, exceso de presión y EMW) para el módulo Ecuaciones.
 * Las ecuaciones solo se muestran en la pantalla «Ecuaciones», nunca en la interfaz del panel MDT.
 * Ver `docs/decisiones/0089-exceso-de-presion-y-emw-en-mdt.md`.
 */
import type { ModuleDocs } from '../../core/module';

export const MDT_DOCS: ModuleDocs = {
  summary:
    'Interpretación de presiones de formación (MDT/RFT/XPT): ajuste lineal de gradientes por fluido en presión absoluta, detección de contactos (CGP, CAP/FWL, CGA) por intersección de rectas, visualización en Exceso de presión respecto de una columna hidrostática de referencia y en Densidad Equivalente de Lodo (EMW) referida al datum de superficie z = 0. En ausencia de columna TVD o de datum verificado, los cálculos sobre profundidad medida (MD) asumen pozo vertical y datum en superficie; en pozos desviados las densidades y la EMW resultan subestimadas. Una regresión zonal con densidad aparente mayor a 1,25 g/cm³ excede el rango físico de una salmuera continua y sugiere compartimentalización o sobrepresión escalonada.',
  equations: [
    {
      latex: '\\frac{dP}{dz} = \\rho\\,g \\qquad (g = 9{,}80665\\;\\mathrm{m/s^2})',
      description: 'Gradiente hidrostático de una columna continua de fluido: 1 g/cm³ equivale a 9,80665 kPa/m y a 0,43353 psi/ft.',
    },
    {
      latex: 'P_{\\mathrm{ex}}(z) = P(z) - \\bigl[P_0 + \\rho_{\\mathrm{ref}}\\,g\\,(z - z_0)\\bigr]',
      description: 'Exceso de presión respecto de una columna de densidad ρ_ref (g/cm³) con referencia (z₀, P₀). Con P₀ anclado a la primera prueba incluida en z₀ se centra en 0; con z₀ = 0 y P₀ = 0 expresa la sobrepresión sobre la hidrostática desde superficie.',
    },
    {
      latex: '\\frac{dP_{\\mathrm{ex}}}{dz} = (\\rho_{\\mathrm{fluido}} - \\rho_{\\mathrm{ref}})\\,g',
      description: 'Proyección exacta de una recta de fluido al espacio de exceso: si ρ_fluido = ρ_ref la recta se dibuja vertical (pendiente 0) y el corte de dos rectas conserva idéntica profundidad de contacto.',
    },
    {
      latex: '\\rho_{\\mathrm{eq}}(z) = \\frac{P(z)}{g\\,z} \\qquad (z > 0,\\;P \\ge 0,\\;\\text{datum } z = 0)',
      description: 'Densidad equivalente de lodo (EMW) en g/cm³ (con P en kPa y z en m) o en lb/gal (1 g/cm³ = 8,3454 lb/gal; 1 lb/gal = 12/231 ≈ 0,05195 psi/ft, valor exacto de la aproximación de campo 0,052).',
    },
    {
      latex: '\\rho_{\\mathrm{ap}} > 1{,}25\\;\\mathrm{g/cm^3}',
      description: 'Umbral diagnóstico de densidad aparente no física en una regresión zonal: excede una salmuera saturada (0,98–1,20 g/cm³) y sugiere sellos, compartimentalización o sobrepresión escalonada.',
    },
  ],
  references: [
    'Dake, L. P. (1978). Fundamentals of Reservoir Engineering, cap. 1.4. Elsevier.',
    'Bourgoyne, A. T. et al. (1986). Applied Drilling Engineering, SPE Textbook Series Vol. 2, cap. 6.',
    'Mouchet, J. P. y Mitchell, A. (1989). Abnormal Pressures While Drilling. Elf Aquitaine.',
    'Schlumberger (2006). Fundamentals of Formation Testing, cap. 4 (gradientes, contactos y gráficos de exceso de presión).',
  ],
};
