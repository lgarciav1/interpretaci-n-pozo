/**
 * G08 — Módulo de panel «Coherencia cruzada entre herramientas» (docs/decisiones/0092): sin puertos ni cálculo en el
 * motor; audita en solo lectura las salidas vigentes del pozo zona por zona. El modelo puro vive en
 * `src/petro/crossCheck.ts` + `./model.ts`, y la interfaz en `./dock.tsx`. Las ecuaciones van solo acá (módulo Ecuaciones).
 */
import { definePanelModule } from '../../core/module';

export const CROSS_CHECK_ID = 'cross-check';

export default definePanelModule({
  id: CROSS_CHECK_ID,
  name: 'Coherencia cruzada entre herramientas',
  description:
    'Semáforo de consistencia física por zona entre saturación de Archie, SCAL, RMN, corona, contactos MDT, capacidad de sello MICP, GR espectral y movilidad Sxo.',
  category: 'summary',
  workspace: ['petrophysics', 'geology'],
  docs: {
    summary:
      'Audita en vivo la consistencia física entre mediciones independientes sin recalcular petrofísica ni ocultar ensayos faltantes: (1) porcentaje de pay con Sw por debajo de Swi de SCAL; (2) medianas de agua ligada en reservorio neto comparando Archie (BVW), RMN (BVI) y SCAL (φe·Swi); (3) sesgos de porosidad entre perfil (PHIE), RMN y corona distinguiendo derrumbes, déficit por gas/fluido o matriz; (4) contradicciones entre contactos MDT (OWC/GWC) y pay o arenas acuíferas; (5) columna máxima retenible desde la presión de desplazamiento Pd de MICP/SCAL declarando los supuestos interfaciales y de densidad; y (6) impacto de uranio espectral en GR y fracción móvil del hidrocarburo en pay cuando G06/G07 están activos.',
    equations: [
      {
        latex: '\\%(S_w < S_{wi} - \\varepsilon) = 100\\,\\frac{N_{\\text{pay}}(S_w < S_{wi} - \\varepsilon)}{N_{\\text{pay}}}',
        description:
          'Chequeo Archie vs. SCAL en muestras de pay: acuerdo < 5 %, atención 5–20 %, tensión > 20 % (criterios operativos de auditoría con tolerancia ε vigente de swi-pc).',
      },
      {
        latex: '\\text{BVW} = \\phi_e\\,S_w \\quad \\text{vs.} \\quad \\text{BVI}_{\\text{RMN}} \\quad \\text{vs.} \\quad \\text{BVI}_{\\text{SCAL}} = \\phi_e\\,S_{wi}',
        description:
          'Medianas (P50) de volumen de agua y agua ligada en reservorio neto. Detecta sobreestimación de BVI por corte fijo de T2 (33 ms) cuando BVI_RMN / BVI_SCAL ≥ 1,25 (atención) o ≥ 1,5 (tensión).',
      },
      {
        latex: '\\Delta\\phi_{\\text{RMN}} = \\operatorname{mediana}(\\phi_{e,\\text{RMN}} - \\phi_e), \\qquad \\Delta\\phi_{\\text{corona}} = \\operatorname{mediana}(\\phi_e - \\phi_{\\text{corona}})',
        description:
          'Sesgo de porosidad por zona (acuerdo ≤ 0,02 v/v, atención 0,02–0,04 v/v, tensión > 0,04 v/v), contrastado con IND_WASHOUT e IND_NMR_DEFICIT para atribuir causa.',
      },
      {
        latex: 'z > z_c + \\delta_z \\;\\land\\; \\text{NET\\_PAY} = 1, \\qquad z < z_c - \\delta_z \\;\\land\\; \\text{arena limpia} \\;\\land\\; S_w > 0{,}80',
        description:
          'Contradicciones respecto de un contacto de agua MDT (OWC/GWC) en el mismo compartimiento, con margen operativo δz = 2,0 m.',
      },
      {
        latex: 'P_{d,\\text{res}} = P_{d,\\text{lab}}\\,\\frac{(\\sigma\\cos\\theta)_{\\text{res}}}{(\\sigma\\cos\\theta)_{\\text{lab}}}, \\qquad h_{\\max} = \\frac{P_{d,\\text{res}}}{\\Delta\\rho\\,g}',
        description:
          'Columna máxima retenible desde la presión de desplazamiento Pd (psi mercurio–aire) con el sistema interfacial y Δρ vigentes del panel MICP. Exige muestras de roca sello para declarar soporte directo de sello.',
      },
      {
        latex: 'f_U = \\operatorname{mediana}(\\text{U\\_GR\\_FRAC}), \\qquad f_{\\text{móvil}} = \\frac{\\sum h_i\\,\\phi_{e,i}\\,\\text{MOS}_i}{\\sum h_i\\,\\phi_{e,i}\\,(1 - S_{w,i})}',
        description:
          'Sensibilidad al uranio en GR (atención 15–30 %, tensión > 30 % sin CGR) y fracción móvil del hidrocarburo en el pay con invasión resuelta (acuerdo ≥ 30 %, atención 10–30 %, tensión < 10 %).',
      },
    ],
    references: [
      'Archie, G. E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. Trans. AIME 146: 54–62.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Coates, G. R., Xiao, L. y Prammer, M. G. (1999). NMR Logging: Principles and Applications. Halliburton Energy Services.',
      'Purcell, W. R. (1949). Capillary pressures — their measurement using mercury and the calculation of permeability therefrom. Trans. AIME 186: 39–48.',
      'Tiab, D. y Donaldson, E. C. (2015). Petrophysics, 4.ª ed. Gulf Professional Publishing.',
    ],
    notes:
      'Todos los umbrales del semáforo son criterios operativos de auditoría para priorizar la revisión técnica durante la interpretación y la defensa (ADR 0092), no leyes petrofísicas universales. Un estado en «Sin soporte» indica ausencia de curva o ensayo y nunca se oculta.',
  },
});
