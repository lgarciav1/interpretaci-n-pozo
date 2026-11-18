import { definePanelModule } from '../../core/module';

export const TRAINER_ID = 'trainer';

export default definePanelModule({
  id: TRAINER_ID,
  name: 'Entrenador',
  description: 'Pozo sintético con porosidad efectiva y saturación de agua conocidas.',
  category: 'porosity',
  workspace: 'petrophysics',
  docs: {
    summary: 'Modelos directos del ejercicio. Se usa Archie ideal sin conducción de arcilla. La corrección compara porosidad efectiva y saturación de agua por profundidad medida.',
    equations: [
      { latex: 'GR=GR_{limpia}+(GR_{arcilla}-GR_{limpia})V_{sh}+\\varepsilon_{GR}' },
      { latex: '\\phi_t=\\frac{\\phi_e}{1-V_{sh}},\\quad \\rho_b=\\rho_{ma}-(\\rho_{ma}-\\rho_{fl})\\phi_t+\\varepsilon_\\rho,\\quad NPHI=\\phi_t+\\varepsilon_N' },
      { latex: 'R_t=\\frac{a R_w}{\\phi_e^m S_w^n}\\exp(\\varepsilon_{\\ln R_t})' },
      { latex: 'MAE=\\frac{100}{k}\\sum_{i=1}^{k}|e_i|,\\quad RMSE=100\\sqrt{\\frac{1}{k}\\sum_{i=1}^{k}e_i^2},\\quad C=100\\frac{k}{N}', description: 'Error de estimación en fracción (e), pares válidos (k) y muestras de la zona (N). Errores en puntos porcentuales y cobertura en %.' },
    ],
    references: [
      'Archie, G. E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. Trans. AIME 146.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
  },
});
