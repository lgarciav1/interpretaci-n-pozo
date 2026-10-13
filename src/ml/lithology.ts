/**
 * Clases de litología de la competencia FORCE 2020 y su matriz de penalización.
 *
 * MAPA DE CÓDIGOS (verificado contra `datos/FORCE2020/lithology_competition/data/starter_notebook.ipynb`, diccionario
 * `lithology_keys`, y contra `data/test_code.py`, diccionario `lithology_numbers`, que da el índice 0–11 que usa la
 * matriz de penalización):
 *
 *   índice  código  clase (original)       en español
 *     0     30000   Sandstone              Arenisca
 *     1     65030   Sandstone/Shale        Arenisca/Lutita (intercalaciones finas)
 *     2     65000   Shale                  Lutita
 *     3     80000   Marl                   Marga
 *     4     74000   Dolomite               Dolomía        (NO caliza: corrige un malentendido frecuente)
 *     5     70000   Limestone              Caliza
 *     6     70032   Chalk                  Creta (chalk)
 *     7     88000   Halite                 Halita (sal)
 *     8     86000   Anhydrite              Anhidrita
 *     9     99000   Tuff                   Toba
 *    10     90000   Coal                   Carbón
 *    11     93000   Basement               Basamento
 *
 * Las etiquetas del dataset vienen de interpretación humana de los pozos (no de análisis de corona), con una
 * columna de confianza: 1 alta, 2 media, 3 baja (starter_notebook.ipynb).
 */

export interface LithologyClass {
  /** Índice 0–11 (orden de la competencia y de la matriz de penalización). */
  index: number;
  /** Código numérico de la etiqueta FORCE 2020. */
  code: number;
  /** Nombre en inglés tal como figura en el dataset. */
  name: string;
  /** Nombre para la interfaz. */
  label: string;
}

export const LITHOLOGY_CLASSES: readonly LithologyClass[] = [
  { index: 0, code: 30000, name: 'Sandstone', label: 'Arenisca' },
  { index: 1, code: 65030, name: 'Sandstone/Shale', label: 'Arenisca/Lutita' },
  { index: 2, code: 65000, name: 'Shale', label: 'Lutita' },
  { index: 3, code: 80000, name: 'Marl', label: 'Marga' },
  { index: 4, code: 74000, name: 'Dolomite', label: 'Dolomía' },
  { index: 5, code: 70000, name: 'Limestone', label: 'Caliza' },
  { index: 6, code: 70032, name: 'Chalk', label: 'Creta' },
  { index: 7, code: 88000, name: 'Halite', label: 'Halita' },
  { index: 8, code: 86000, name: 'Anhydrite', label: 'Anhidrita' },
  { index: 9, code: 99000, name: 'Tuff', label: 'Toba' },
  { index: 10, code: 90000, name: 'Coal', label: 'Carbón' },
  { index: 11, code: 93000, name: 'Basement', label: 'Basamento' },
];

/** Código FORCE → índice de clase (−1 si el código no existe). */
export function lithologyIndexOfCode(code: number): number {
  const c = LITHOLOGY_CLASSES.find(k => k.code === code);
  return c ? c.index : -1;
}

/**
 * Matriz de penalización de la competencia FORCE 2020, `A[verdadera][predicha]`, simétrica, diagonal 0, máximo 4.
 * Fuente: `datos/FORCE2020/lithology_competition/data/penalty_matrix.npy` (leída con NumPy y copiada tal cual).
 * La puntuación de la competencia es −(1/N)·Σ A[verdad_i][predicción_i] (más cerca de 0 es mejor); aquí se informa la
 * penalización media positiva, que es el mismo número sin el signo.
 */
export const FORCE_PENALTY_MATRIX: readonly (readonly number[])[] = [
  [0.0, 2.0, 3.5, 3.0, 3.75, 3.5, 3.5, 4.0, 4.0, 2.5, 3.875, 3.25],
  [2.0, 0.0, 2.375, 2.75, 4.0, 3.75, 3.75, 3.875, 4.0, 3.0, 3.75, 3.0],
  [3.5, 2.375, 0.0, 2.0, 3.5, 3.5, 3.75, 4.0, 4.0, 2.75, 3.25, 3.0],
  [3.0, 2.75, 2.0, 0.0, 2.5, 2.0, 2.25, 4.0, 4.0, 3.375, 3.75, 3.25],
  [3.75, 4.0, 3.5, 2.5, 0.0, 2.625, 2.875, 3.75, 3.25, 3.0, 4.0, 3.625],
  [3.5, 3.75, 3.5, 2.0, 2.625, 0.0, 1.375, 4.0, 3.75, 3.5, 4.0, 3.625],
  [3.5, 3.75, 3.75, 2.25, 2.875, 1.375, 0.0, 4.0, 3.75, 3.125, 4.0, 3.75],
  [4.0, 3.875, 4.0, 4.0, 3.75, 4.0, 4.0, 0.0, 2.75, 3.75, 3.75, 4.0],
  [4.0, 4.0, 4.0, 4.0, 3.25, 3.75, 3.75, 2.75, 0.0, 4.0, 4.0, 3.875],
  [2.5, 3.0, 2.75, 3.375, 3.0, 3.5, 3.125, 3.75, 4.0, 0.0, 2.5, 3.25],
  [3.875, 3.75, 3.25, 3.75, 4.0, 4.0, 4.0, 3.75, 4.0, 2.5, 0.0, 4.0],
  [3.25, 3.0, 3.0, 3.25, 3.625, 3.625, 3.75, 4.0, 3.875, 3.25, 4.0, 0.0],
];
