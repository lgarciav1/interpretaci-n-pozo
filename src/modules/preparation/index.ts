/**
 * Módulo «Preparar datos» (docs/decisiones/0058). Definición PURA: la importa el registro (y por él, el Web Worker).
 *
 * Es un módulo de panel: no es un nodo del motor. Los cálculos (exclusión, espurios, interpolación, mediana, alineación,
 * MGT, DRX y calibración GR) viven en `src/core/preparation/` y corren en el plan de preparación del motor; este archivo
 * solo declara identidad, categoría, espacios de trabajo y la documentación para el módulo Ecuaciones. La interfaz es
 * el panel del dock (`dock.tsx`, misma carpeta) y su acción de la paleta (`commands.ts`).
 */
import { definePanelModule } from '../../core/module';

export const PREPARATION_ID = 'preparation';
/** Id de la pestaña del dock (igual al del módulo: así «Ecuaciones» abre su entrada desde la pestaña). */
export const PREPARATION_DOCK_ID = PREPARATION_ID;

export default definePanelModule({
  id: PREPARATION_ID,
  name: 'Preparar datos',
  description:
    'Limpieza y puesta en profundidad de las curvas medidas antes de interpretar: excluir tramos o espurios, estimar huecos cortos, suavizar con mediana, alinear en MD, normalizar (calibración y escala), corregir GR por pozo (MGT) y calibrar los extremos de GR con DRX. Conserva siempre el original.',
  category: 'qc',
  workspace: ['petrophysics', 'geology'],
  docs: {
    summary:
      'Etapas en orden fijo sobre cada curva original, sin borrar filas ni cambiar el índice de profundidad: exclusión → interpolación de faltantes originales → mediana móvil → corrimiento constante en MD → normalización. Cada muestra lleva banderas de calidad combinables (faltante original, excluida, sospechosa, interpolada, filtrada, corrida, corregida, fuera de dominio, normalizada). La normalización corrige posibles errores de calibración y escala: lleva percentiles de la curva en un intervalo de referencia a valores conocidos (de un pozo vecino o de arcilla y arena limpia) y se aplica a toda la curva. La corrección MGT de GR por diámetro de pozo es una receta aparte, no combinable con las otras etapas. La calibración de GR con DRX ajusta los extremos de arena limpia y arcilla del índice de rayos gamma contra el volumen de arcilla de laboratorio para el método de Vsh elegido.',
    equations: [
      {
        latex: '\\widehat{\\rho}(x)=\\frac{1}{T}\\sum_{t=1}^{T} f_t(x)',
        description: 'F20 density-rf-v1: regresión con bosque aleatorio entrenado sólo en densidad sana del mismo pozo. Árboles extremadamente aleatorizados con medias de hoja; no se convierten clases a densidad.',
      },
      {
        latex: '\\mathrm{RMSE}=\\sqrt{\\frac{1}{n}\\sum_i(\\widehat{\\rho}_i-\\rho_i)^2},\\quad R^2=1-\\frac{\\sum_i(\\widehat{\\rho}_i-\\rho_i)^2}{\\sum_i(\\rho_i-\\overline{\\rho})^2}',
        description: 'Métricas sobre bloques sanos ocultos, con separación en profundidad. Puerta fija: RMSE ≤ 0,08 g/cm³, R² ≥ 0,50, cobertura de validación ≥ 60 %. No miden el error real en derrumbes.',
      },
      {
        latex: '[\\widehat{\\rho}(x)-q_{0.9},\\widehat{\\rho}(x)+q_{0.9}]',
        description: 'Banda nominal 90 % con residuos absolutos de bloques independientes de calibración. Exige cobertura observada ≥ 85 % y semiancho ≤ 0,15 g/cm³. La extrapolación o falta de soporte impide estimar. La cobertura global de validación no garantiza cobertura en cada intervalo: un bloque sintético oculto de la revisión independiente cubrió sólo 65 %. En derrumbes la densidad verdadera es desconocida.',
      },
      {
        latex: "x'_i = \\begin{cases} \\mathrm{NaN} & z_t \\le z_i \\le z_b \\\\ x_i & \\text{en otro caso} \\end{cases}",
        description: 'Exclusión de un tramo cerrado [tope, base] en MD: la medición pasa a sin dato y se conserva el original.',
      },
      {
        latex: '\\left| x_i - \\tilde{m}_i \\right| > \\max\\left(\\delta,\\; 3 \\cdot 1{,}4826\\,\\mathrm{MAD}_i\\right)',
        description:
          'Candidato a espurio: m̃ y MAD son la mediana y la desviación absoluta mediana de los tres vecinos a cada lado (sin el centro); δ es la desviación mínima. Solo señala: excluir es una decisión por muestra.',
      },
      {
        latex: 'x_k = (1 - t)\\,x_a + t\\,x_b, \\qquad t = \\frac{z_k - z_a}{z_b - z_a}, \\qquad z_b - z_a \\le \\Delta z_{max}',
        description:
          'Interpolación lineal acotada en MD entre dos mediciones finitas (anclajes a y b) que encierran faltantes originales. No extrapola, no cruza fronteras de zona ni rellena exclusiones.',
      },
      {
        latex: 'y_i = \\operatorname{med}\\left\\{ x_j : \\left| z_j - z_i \\right| \\le r \\right\\}, \\qquad n_i \\ge 3',
        description:
          'Mediana móvil con ventana física simétrica de radio r (m MD), con vecinos a ambos lados; corta en faltantes, exclusiones, zonas y separaciones mayores que la máxima. Lee la etapa anterior sin recursión.',
      },
      {
        latex: "z' = z + \\Delta z, \\qquad y(z_k) = (1 - t)\\,x_a + t\\,x_b, \\qquad t = \\frac{z_k - z'_a}{z'_b - z'_a}",
        description:
          'Corrimiento constante de toda la curva (positivo = más profundo) y remuestreo lineal al índice MD del pozo, sin extrapolar; las coincidencias exactas conservan el dato. Huecos mayores que el máximo quedan fuera de dominio.',
      },
      {
        latex: "x' = y_{lo} + \\left(x - x_{lo}\\right) \\frac{y_{hi} - y_{lo}}{x_{hi} - x_{lo}}, \\qquad x_{lo} = P_{lo}, \\; x_{hi} = P_{hi}",
        description:
          'Normalización lineal de dos puntos: los percentiles P_lo y P_hi (por defecto P5 y P95) de la curva en el intervalo de referencia van a los valores de referencia y_lo < y_hi. Corrige escala y corrimiento a la vez. Exige x_hi > x_lo y al menos 50 muestras de origen (finitas, sin excluidas ni estimadas).',
      },
      {
        latex: "x' = x + \\left(y - x_p\\right) \\quad \\text{(desplazamiento)}, \\qquad x' = x \\, \\frac{y}{x_p} \\quad \\text{(escala)}",
        description:
          'Normalización de un punto: el percentil P_p de origen (por defecto P50) va al valor de referencia y, sumando una constante o multiplicando por una (la escala exige y/x_p > 0). Una salida fuera del rango físico de la curva se conserva y se marca fuera de dominio, sin recortarla.',
      },
      {
        latex: 'x_{(p)} = x_{\\lfloor h \\rfloor} + \\left(h - \\lfloor h \\rfloor\\right)\\left(x_{\\lfloor h \\rfloor + 1} - x_{\\lfloor h \\rfloor}\\right), \\qquad h = \\frac{(n - 1)\\,p}{100}',
        description: 'Percentil p de las n muestras de origen ordenadas (definición 7 de Hyndman y Fan, la de numpy y R por defecto).',
      },
      {
        latex: 'GR_c = GR \\cdot f(d), \\qquad t = 1{,}316\\,d - 3{,}5',
        description: 'Corrección MGT (LDEO) de GR total por diámetro de pozo d (pulgadas), en pozo abierto con agua de mar.',
      },
      {
        latex: 'f_{cen} = 4{,}7\\cdot10^{-6}\\,t^4 - 2{,}45\\cdot10^{-4}\\,t^3 + 5{,}59\\cdot10^{-3}\\,t^2 - 1{,}31\\cdot10^{-3}\\,t + 0{,}82',
        description: 'Factor MGT con la herramienta centrada.',
      },
      {
        latex: 'f_{exc} = -8{,}22\\cdot10^{-6}\\,t^3 + 1{,}36\\cdot10^{-4}\\,t^2 + 2{,}44\\cdot10^{-2}\\,t + 0{,}812',
        description: 'Factor MGT con la herramienta excentrada. Fuera del dominio de diámetro, temperatura o presión: sin dato, sin extrapolar.',
      },
      {
        latex: 'I_{GR} = \\frac{GR - GR_{limpia}}{GR_{arcilla} - GR_{limpia}}',
        description: 'Índice de rayos gamma con los extremos de arena limpia y arcilla.',
      },
      {
        latex: '\\min_{GR_{limpia},\\,GR_{arcilla}} \\; \\frac{1}{n} \\sum_{i=1}^{n} \\left( g(I_{GR,i}) - V_{DRX,i} \\right)^2',
        description:
          'Calibración de GR con DRX: extremos que mejor reproducen el volumen de arcilla de laboratorio V_DRX con el método g de Vsh elegido (uno de los extremos puede quedar fijo). Se informan RMSE, sesgo y validación por bloques de profundidad.',
      },
      {
        latex: 'GR_i = GR_{limpia} + \\left(GR_{arcilla} - GR_{limpia}\\right)\\, g^{-1}(V_{DRX,i})',
        description: 'Arranque del ajuste: regresión lineal de GR contra el índice que corresponde a cada V_DRX.',
      },
      { latex: 'V_{sh} = I_{GR}', description: 'Método lineal.' },
      { latex: 'V_{sh} = 0{,}083\\,(2^{3{,}7\\,I_{GR}} - 1)', description: 'Larionov, rocas terciarias.' },
      { latex: 'V_{sh} = 0{,}33\\,(2^{2\\,I_{GR}} - 1)', description: 'Larionov, rocas antiguas.' },
      { latex: 'V_{sh} = 1{,}7 - \\sqrt{3{,}38 - (I_{GR} + 0{,}7)^2}', description: 'Clavier.' },
      { latex: 'V_{sh} = \\frac{I_{GR}}{3 - 2\\,I_{GR}}', description: 'Steiber.' },
      {
        latex: '\\frac{N}{G} = \\frac{\\sum_i h_i \\,[\\,V_{sh,i} \\le V_{sh,c}\\,]}{\\sum_i h_i}',
        description: 'Impacto del cutoff de Vsh elegido con evidencia DRX sobre la relación neto/bruto de la zona (h: espesor de cada muestra).',
      },
    ],
    references: [
      'Geurts, P., Ernst, D. y Wehenkel, L. (2006). Extremely randomized trees. Machine Learning 63, 3–42.',
      'Breiman, L. (2001). Random Forests. Machine Learning 45, 5–32 (regresión). F20: ADR 0077, dominio y criterios prefijados density-rf-v1.',
      'Angelopoulos, A. N. y Bates, S. (2023). Conformal Prediction: A Gentle Introduction. Foundations and Trends in Machine Learning (calibración por residuos; dependencia espacial limita garantías).',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Bateman, R. M. (2012). Openhole Log Analysis and Formation Evaluation, 2.ª ed. SPE (control de calidad, puesta en profundidad).',
      'Tukey, J. W. (1977). Exploratory Data Analysis. Addison-Wesley (medianas móviles).',
      'Cátedra de Interpretación de Perfiles (FIUBA), Clase 8 «Preparación de datos», slides 9–10 (normalización: correcciones por errores de calibración y escala; comparación de histogramas y frecuencia acumulada).',
      'Hyndman, R. J. y Fan, Y. (1996). Sample quantiles in statistical packages. The American Statistician 50(4), 361–365 (percentiles, definición 7).',
      'Hampel, F. R. (1974). The influence curve and its role in robust estimation. Journal of the American Statistical Association 69 (MAD normalizada, 1,4826).',
      'Goldberg, D., Meltser, M., Myers, G. y Masterson, W. (2004). Proc. ODP Scientific Results 191, cap. 6, ecuaciones 2–4 (corrección MGT).',
      'Larionov, V. V. (1969). Borehole Radiometry. Moscú: Nedra.',
      'Clavier, C., Hoyle, W. y Meunier, D. (1971). Quantitative interpretation of thermal neutron decay time logs. JPT.',
      'Steiber, R. G. (1973). Optimization of shale volumes in open hole logs. Journal of Petroleum Technology.',
    ],
    notes:
      'Las etapas son recetas guardadas en el proyecto (se deshacen y se comparan con snapshots); el original nunca se modifica. Las correcciones ambientales que requieren datos de adquisición imposibles de verificar con los datos del TP quedan fuera de alcance; MGT es opcional y exige declarar sus condiciones.',
  },
});
