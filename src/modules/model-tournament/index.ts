/** F22: panel exploratorio, sin nodo ni puntuación agregada en el motor. */
import { definePanelModule } from '../../core/module';

export const MODEL_TOURNAMENT_ID = 'model-tournament';
export default definePanelModule({
  id: MODEL_TOURNAMENT_ID,
  name: 'Torneo de modelos contra corona',
  description: 'Compara combinaciones de Vsh, porosidad total y Sw con la corona disponible, y permite aplicar una combinación explícita con snapshot y deshacer.',
  category: 'porosity',
  workspace: 'petrophysics',
  docs: {
    summary: 'Comparación exploratoria de cinco transformadas Vsh, cinco métodos explícitos de porosidad total y tres modelos Sw. Cada combinación usa el mismo motor y las fuentes preparadas vigentes. Se compara PHIT con porosidad de plugs incluidos, en su profundidad MD corregida y sin extrapolación. La clasificación usa solamente RMSE de porosidad sobre pares comunes a candidatos con soporte; no hay puntuación combinada ni ganador integral. El TP no aporta Sw in situ ni Vsh volumétrico compatibles: ambas variables quedan no evaluables. Los ensayos Sw–RI son datos de desaturación para ajustar n, no referencias del perfil. No se ajustan parámetros durante el torneo. El ajuste previo puede ser desconocido y la selección reiterada con los mismos plugs introduce optimismo; esto no constituye validación independiente. Mínimos exploratorios: cinco pares y 80% de cobertura; menos de diez pares tiene soporte escaso. Aplicar conserva las entradas y recetas, fija revisión, guarda evidencia y snapshot comparable en una operación reversible.',
    equations: [
      { latex: '\\operatorname{RMSE}=\\sqrt{\\frac{1}{n}\\sum_i(L_i-C_i)^2}', description: 'Raíz del error cuadrático medio por variable, en v/v. L: perfil; C: corona. No se mezclan variables.' },
      { latex: '\\operatorname{MAE}=\\frac{1}{n}\\sum_i|L_i-C_i|', description: 'Error absoluto medio por variable.' },
      { latex: '\\operatorname{sesgo}=\\frac{1}{n}\\sum_i(L_i-C_i)', description: 'Diferencia media; positiva si el perfil sobreestima.' },
      { latex: '\\operatorname{cobertura}=n/N', description: 'Pares válidos sobre referencias elegibles, incluidos faltantes del perfil en el denominador. Los IDs declarados de ajuste se excluyen de evaluación.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis. AAPG Methods in Exploration 16. Métodos Vsh, porosidad y Archie; ecuaciones de cada método en su ficha.',
      'Bateman, R. M. (1985). Openhole Log Analysis and Formation Evaluation. Comparación de perfiles y corona; diferencias de resolución y condiciones de medida.',
      'ADR 0078 — Torneo exploratorio de modelos contra corona. Soporte mínimo, pares comunes y separación entre ajuste y evaluación.',
    ],
  },
});
