import { definePanelModule } from '../../core/module';

export const SATURATION_HEIGHT_ID = 'saturation-height';
export default definePanelModule({
  id: SATURATION_HEIGHT_ID,
  name: 'Saturación por altura',
  description: 'Contrasta la Sw del perfil con curvas capilares por tipo de roca y una referencia de agua libre revisada.',
  category: 'saturation',
  workspace: 'petrophysics',
  docs: {
    summary: 'Modelo bifásico, agua mojante y gradientes verticales constantes. La igualdad de presiones define el nivel de agua libre. El contraste con el perfil es exploratorio. La validación independiente exige referencias compatibles y separadas de los datos de ajuste y selección.',
    equations: [
      { latex: 'h=z_{FWL}-z,\\quad P_c=(G_w-G_{hc})h,\\quad \\rho_i=G_i/g', description: 'TVD y altura en m, gradientes en Pa/m y densidad en kg/m³. Predicción para h ≥ 0.' },
      { latex: 'z_{FWL}=\\frac{a_{hc}-a_w}{G_w-G_{hc}}', description: 'Intersección de rectas compatibles en un datum común.' },
      { latex: 'J=\\frac{P_c\\sqrt{k/\\phi}}{\\sigma|\\cos\\theta|}', description: 'Escalado en SI a geometría y mojabilidad comparables. Para la misma roca se escala solo por tensión y ángulo.' },
      { latex: 'S_w=S_{wi}+(1-S_{wi})(P_d/P_c)^\\lambda,\\quad P_c>P_d', description: 'Brooks–Corey en drenaje. En la meseta de entrada admitida, Sw es 1. Aplican los límites de soporte declarados.' },
    ],
    references: [
      'Brooks, R. H. y Corey, A. T. (1964). Hydraulic properties of porous media.',
      'Leverett, M. C. (1941). Capillary behavior in porous solids.',
      'ADR 0079 — Saturación por altura.',
    ],
  },
});
