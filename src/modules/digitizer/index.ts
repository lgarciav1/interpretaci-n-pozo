/**
 * Módulo «Log Digitizer» (docs/decisiones/0062 motor, 0063 interfaz). Definición PURA: la importa el registro (y por
 * él, el Web Worker del motor petrofísico), así que no importa React ni nada de la interfaz.
 *
 * Es un módulo de panel (como «Preparar datos», 0058): no es un nodo del motor ni calcula curvas del pozo. Es una
 * herramienta de ADQUISICIÓN de datos: convierte un registro escaneado en curvas medidas (`origin.kind = 'measured'`,
 * fuente «Log Digitizer»). El motor de digitalización vive en `src/digitizer/`; la interfaz es la pestaña del dock
 * (`dock.tsx`), la acción de la paleta (`commands.ts`) y la mesa de digitalización a ventana completa (`ui/`).
 */
import { definePanelModule } from '../../core/module';

export const DIGITIZER_ID = 'digitizer';
/** Id de la pestaña del dock (igual al del módulo: así «Ecuaciones» abre su entrada desde la pestaña). */
export const DIGITIZER_DOCK_ID = DIGITIZER_ID;

export default definePanelModule({
  id: DIGITIZER_ID,
  name: 'Log Digitizer',
  description:
    'Pasa a digital registros escaneados o ajenos: corrige la inclinación y la perspectiva de la imagen, calibra profundidad y escala de cada pista, traza las curvas por color (automático, guiado o a mano) y las agrega al pozo activo, crea un pozo nuevo o las exporta a LAS/CSV.',
  category: 'data-acquisition',
  categoryLabel: 'Adquisición de datos',
  workspace: ['petrophysics', 'geology'],
  docs: {
    summary:
      'Convierte un registro escaneado en curvas digitales. La imagen se endereza (rotación desde dos puntos de una línea que debería ser vertical) y, si hace falta, se rectifica la perspectiva con cuatro esquinas (homografía). La profundidad sale de amarres fila ↔ profundidad impresa (lineal por tramos o recta de mínimos cuadrados con su residuo) y el valor de cada curva de dos columnas con valor conocido (bordes de la pista), en escala lineal o logarítmica, normal o invertida. El trazo se aísla por color en CIELAB y se sigue fila por fila eligiendo la trayectoria de menor costo (programación dinámica de Viterbi). La serie se remuestrea por interpolación lineal (en log10 para escalas logarítmicas), sin extrapolar. Precisión típica: 1–2 % del rango de la escala con escaneos de unos 20 px por metro; peor con ruido, cruces del mismo color o curvas muy dentadas. Toda curva digitalizada debe revisarse.',
    equations: [
      {
        latex: 'z(y) = z_i + \\left(y - y_i\\right) \\frac{z_{i+1} - z_i}{y_{i+1} - y_i}, \\qquad y_i \\le y \\le y_{i+1}',
        description:
          'Calibración de profundidad lineal por tramos: pasa por todos los amarres (fila y_i ↔ profundidad z_i, en metros). Fuera del primero y del último se prolonga la pendiente del tramo extremo.',
      },
      {
        latex: '(a, b) = \\arg\\min \\sum_i \\left(z_i - a - b\\,y_i\\right)^2, \\qquad \\mathrm{RMS}_{px} = \\frac{1}{|b|}\\sqrt{\\frac{1}{n}\\sum_i \\left(z_i - a - b\\,y_i\\right)^2}',
        description:
          'Recta de mínimos cuadrados (método lineal) y residuo de los amarres en píxeles: con tres o más amarres, más de 2 px sugiere un escaneo estirado o un amarre mal puesto.',
      },
      {
        latex: 'f = \\frac{x - x_L}{x_R - x_L}, \\qquad v = v_L + f\\,\\left(v_R - v_L\\right)',
        description: 'Escala lineal de una pista: x_L y x_R son las columnas marcadas (bordes) con valores v_L y v_R. Si v_L > v_R la escala está invertida (p. ej. NPHI o DT).',
      },
      {
        latex: '\\log_{10} v = \\log_{10} v_L + f\\,\\left(\\log_{10} v_R - \\log_{10} v_L\\right)',
        description: 'Escala logarítmica (resistividades): la fracción de pista es lineal en décadas.',
      },
      {
        latex: '\\theta = \\operatorname{atan2}\\left(x_2 - x_1,\\; y_2 - y_1\\right)',
        description: 'Inclinación a partir de dos puntos marcados sobre una línea que debería ser vertical; la imagen se rota −θ alrededor de su centro con remuestreo bilineal.',
      },
      {
        latex:
          '\\begin{pmatrix} u \\\\ v \\\\ 1 \\end{pmatrix} \\sim H \\begin{pmatrix} x \\\\ y \\\\ 1 \\end{pmatrix}, \\qquad x\\,h_0 + y\\,h_1 + h_2 - u\\,x\\,h_6 - u\\,y\\,h_7 = u, \\quad x\\,h_3 + y\\,h_4 + h_5 - v\\,x\\,h_6 - v\\,y\\,h_7 = v',
        description:
          'Rectificación de perspectiva: homografía (h_8 = 1) de las cuatro esquinas marcadas a un rectángulo. Las 8 ecuaciones se resuelven con normalización de Hartley (centroide al origen, distancia media √2) y eliminación gaussiana con pivoteo parcial.',
      },
      {
        latex: '\\Delta E^*_{ab} = \\sqrt{\\left(L^*_1 - L^*_2\\right)^2 + \\left(a^*_1 - a^*_2\\right)^2 + \\left(b^*_1 - b^*_2\\right)^2}',
        description:
          'Distancia de color CIE76 en CIELAB (D65). La intensidad de máscara de un píxel es 255·α·(1 − ρ/tol), con α la fracción de trazo de su proyección sobre el segmento papel→color y ρ su distancia a ese segmento.',
      },
      {
        latex:
          'C = \\sum_j \\left[\\left(1 - q_j\\right) - R\\right] + \\sum_{i \\to j} \\left[\\left(\\frac{g\\prime}{\\sigma \\sqrt{d}}\\right)^2 + 0{,}02\\,\\frac{\\left|c_j - c_i\\right|}{d}\\right] + n_{cadenas}\\,S, \\qquad g\\prime = \\max\\left(0,\\; g - s_{libre}\\,d\\right)',
        description:
          'Costo del trazado que minimiza el algoritmo de Viterbi sobre los tramos candidatos de cada fila: q = calidad del tramo, R = recompensa por fila explicada, d = filas entre tramos (d > 1 atraviesa un hueco), g = distancia horizontal entre tramos, c = centros, S = costo de empezar una cadena. Huecos de más de 25 filas quedan sin dato.',
      },
      {
        latex: 'v(z) = v_a + \\frac{z - z_a}{z_b - z_a}\\left(v_b - v_a\\right) \\quad \\text{(en } \\log_{10} v \\text{ si la escala es logarítmica)}',
        description: 'Remuestreo al índice del pozo o a un paso uniforme: interpolación lineal entre puntos digitalizados, sin extrapolar; huecos mayores que 5 veces el espaciado mediano quedan sin dato.',
      },
    ],
    references: [
      'Hartley, R. I. (1997). In defense of the eight-point algorithm. IEEE Transactions on Pattern Analysis and Machine Intelligence 19(6), 580–593 (normalización de coordenadas).',
      'Hartley, R. y Zisserman, A. (2004). Multiple View Geometry in Computer Vision, 2.ª ed. Cambridge University Press (homografía por correspondencias de puntos).',
      'Viterbi, A. J. (1967). Error bounds for convolutional codes and an asymptotically optimum decoding algorithm. IEEE Transactions on Information Theory 13(2), 260–269.',
      'Forney, G. D. (1973). The Viterbi algorithm. Proceedings of the IEEE 61(3), 268–278.',
      'CIE (2004). Colorimetry, 3.ª ed. Publicación CIE 15:2004 (CIELAB, iluminante D65, ΔE*ab).',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16 (escalas de pistas: lineales, logarítmicas e invertidas).',
    ],
    notes:
      'Límites: solo imágenes rasterizadas (JPG, PNG, WebP; no PDF ni TIFF); no sigue curvas que «dan la vuelta» en el borde de la pista; sin OCR: la escala y los amarres los marca la persona; curvas del mismo color que se cruzan requieren el modo guiado. La sesión de digitalización (imagen, calibración y trazos) se guarda aparte del proyecto. Detalle en docs/decisiones/0062 y 0063.',
  },
});
