# 0077 — Reconstrucción estadística de densidad en derrumbes (F20)

Fecha: 2026-11-17. Estado: decisión previa a implementación y evaluación.

## Contexto y decisión

`forest.ts` aprende clases y devuelve probabilidades: no es un regresor y no se reinterpretan sus clases como densidad. Se implementa un bosque de regresión extremadamente aleatorizado (Geurts, Ernst y Wehenkel, 2006, *Extremely randomized trees*, Machine Learning 63, 3–42), hojas con media y cortes que minimizan suma de cuadrados. Semilla y configuración fijas, sin búsqueda sobre los resultados de validación. Se descartan regresión de clases y regresión lineal única por sus contratos incorrectos o falta de flexibilidad.

El usuario define por intervalos **buen pozo** y **derrumbe** explícitamente y sin solapamiento. No se infieren etiquetas de notas. Un indicador CAL/BS puede orientar la selección; CAL inválido o máscara QC combinada no prueban derrumbe. El entrenamiento requiere densidad medida finita en [1,3.5] g/cm³, buen pozo y predictores confiables. Fuera de buen pozo nunca se usa ZDEN para aprender; en derrumbe nunca se lee ZDEN para decidir la estimación. Fuera de derrumbes el resultado conserva exactamente la original, incluidos nulos.

GR [0,500] gAPI, sónico [30,300] µs/ft y resistividad (0,100000] ohm·m son candidatos: presencia y rango físico no demuestran confianza. Cada predictor seleccionado exige aceptación explícita de confianza y admite máscara por muestra. Resistividad usa log10; el modelo no usa profundidad, densidad, porosidades calculadas ni etiquetas geológicas como predictor. NPHI [-.15,.8] v/v requiere además máscara explícita de confianza por muestra: el derrumbe puede alterarla aun dentro del rango físico. No se imputa ni interpola: una entrada inválida/no confiable impide predecir esa muestra. Exigir al menos dos predictores, máximo cuatro, de roles distintos. No se usa PE, afectado posiblemente por baritina en TP.

## Validación fijada antes de evaluar

Cinco folds deterministas intercalan **bloques completos de 10 m**, con buffer de **1.5 m** respecto de bloques retenidos. Son mayores que el paso de .1524 m y evitan copiar muestras vecinas; no garantizan independencia geológica. Para cada fold: prueba f, calibración (f+1)%5 y entrenamiento restantes, con buffers hacia ambas particiones retenidas. La calibración nunca entrena el predictor ni se usa como prueba; la verdad oculta no determina cortes, rango ni soporte. Cada test observado aporta a RMSE y R² una sola vez. Mínimos por partición: 100 entrenamientos, 20 calibraciones, 20 pruebas; al menos 15 bloques sanos y 100 pares de prueba globales. Una variancia objetivo nula impide informar R² útil y rechaza la oferta.

Se fija **RMSE ≤ .08 g/cm³**, **R² ≥ .50**, al menos **60% de cobertura** de predicciones evaluables en buen pozo y **85% de cobertura empírica** de banda nominal 90%. RMSE .08 equivale aproximadamente a .048 v/v de error en porosidad de arenisca con matriz 2.65 y fluido1; es un límite exploratorio, no exactitud instrumental ni aptitud para reservas. El semiancho final no puede superar **.15 g/cm³**. No se cambian estos límites para aprobar TP o sintético. Un fallo deja la curva sin reconstruir y reporta causas.

La banda usa el cuantil finito de orden ceil((n+1)*.90) de residuos absolutos de **calibración separada**. Se evalúa su cobertura en la partición de prueba no utilizada en la calibración. El ajuste final conserva fold0 para calibración y entrena el resto con buffer. Se añade piso .005 g/cm³ para evitar falsa precisión. No se vende como garantía conformal por la dependencia entre muestras de profundidad ni como intervalo físico de herramienta. Se informa cobertura observada, nominal y semiancho; no solo dispersión entre árboles.

Cada predicción requiere entrar en rangos de entrenamiento y distancia euclídea normalizada al vecino más cercano ≤ .35 (por rangos de entrenamiento); se rechazan extrapolaciones marginales y combinaciones sin soporte. Soporte de calibración y test se evalúa frente a su entrenamiento, nunca con objetivo oculto. Se informa cobertura por descarte, no se ocultan casos difíciles. Los bloques sin muestras válidas no cuentan como soporte. Nulos y huecos quedan señalados y sin reparación; no existe continuidad artificial entre huecos.

## Contrato científico y límites

La salida es una copia preparada con banda y estado por muestra: original, estimado ML, entrada no confiable/faltante, soporte insuficiente o validación rechazada. Las dos últimas categorías nunca se presentan como mediciones reparadas. I01: originales inmutables; I06: flag ML específico más procedencia y banda. La receta guarda roles, ids, confianza, intervalos y versión del método; arrays derivados se recalculan y no se guardan en JSON. Aplicar requiere acción expresa, no cambia silenciosamente la fuente activa, y es reversible. Snapshots fijan entradas/receta. La UI informa RMSE/R², cobertura, límites y acceso a documentación/Ecuaciones.

TP carece de verdad de densidad en derrumbes: RMSE/R² y cobertura miden buen pozo retenido; no validan densidad reconstruida en derrumbes. Se documentarán intervalos y confianza elegidos, sin inventar herramienta/lodo/DRX. El sintético ocultará bloques completos sanos sin entregar su objetivo al ajuste. La revisión científica independiente debe recalcular métricas y verificar ausencia de fuga.

### Precisiones previas solicitadas por revisión independiente

La cobertura de validación divide pares predichos por **todos** los objetivos sanos finitos en rango [1,3.5], incluidos descartes por entradas y soporte. La cobertura de derrumbe es estimados/objetivos y no es validación. Todos los folds deben cumplir mínimos; no se aprueba por promedio de los que pasaron. Se rechaza cuantil de rango mayor que n. El modelo final calibra su propia banda y verifica su semiancho, no promedia bandas CV.

Hiperparámetros fijados antes de evaluar: **32 árboles**, profundidad máxima **10**, mínimo **6 muestras por hoja**, **8 candidatos de corte aleatorios por variable por nodo**, todas las variables candidatas y todas las filas de entrenamiento por árbol (ExtraTrees, sin bootstrap). Semilla **2077**, umbral mínimo de ganancia SSE **1e-10**. No se ajustan tras ver sintético o TP.

### Revisión metodológica por hallazgo independiente (antes de repetir evaluación)

Un sintético independiente mostró banda final más estrecha que el error de un bloque oculto, aun con CV aprobada. El ancho calibrado únicamente en fold0 no representaba la heterogeneidad entre bloques y el cambio de proporción de entrenamiento. Se conserva el diseño/umbrales del modelo y se adopta **envolvente conservadora**: semiancho final = máximo del semiancho calibrado final y todos los semianchos de calibración de CV. Solo usa residuos de calibración; no se selecciona ancho con residuos de test ni del derrumbe. El máximo también debe ser ≤.15; de otro modo no se ofrece. La cobertura CV sigue midiendo bandas por fold (la final es al menos tan ancha). No garantiza cobertura90% en cada bloque: dependencia y desplazamiento geológico permanecen límites explícitos. Esta revisión fue aceptada por el revisor científico independiente antes de repetir la prueba.

Límite operativo: hasta 20000 muestras por evaluación; 32 árboles profundidad10, modelos CV evaluados secuencialmente en el worker. Los pares de prueba se devuelven solo como diagnóstico en memoria para recálculo independiente, nunca dentro del JSON de proyecto.
