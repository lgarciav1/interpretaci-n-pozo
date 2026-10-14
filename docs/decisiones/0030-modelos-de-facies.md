# 0030 — Modelos de facies: random forest FORCE 2020 y electrofacies (fase 10b)

- Estado: implementada, pendiente de revisión por un subagente distinto del que la escribió.
- Alcance: `src/ml/` (modelos puros, sin UI), `tools/ml/train.mjs` (entrenamiento offline), modelo embebido en
  `src/ml/model/lithologyModels.ts` (generado), tests `tests/ml-*.test.ts`. La interfaz (pista de litología, panel de
  importancia, selector de k) es la fase 10c y no está hecha.
- Métricas completas y salida cruda del entrenamiento: `0030-modelos-de-facies-metricas.md`. API y flujo de
  reentrenamiento: `src/ml/README.md`.

## Contexto

El plan (ola 4, función M) pide dos modos de facies porque el pozo del TP no trae facies definidas: (1) un random
forest entrenado con las litologías del dataset público FORCE 2020 (98 pozos del Mar del Norte, 1 170 511 muestras
cada 0,152 m) y aplicado al pozo del TP, y (2) electrofacies sin supervisión sobre el pozo propio. La hipótesis es que
la litología se transfiere entre cuencas porque la respuesta de las herramientas es física; esta fase la implementa y
la mide, y deja dicho dónde no se sostiene.

El build final es un único HTML sin internet: la inferencia usa solo el modelo serializado; el dataset (280 MB) nunca
entra al repo ni al build.

## D1. Clases y etiquetas (corrección respecto del encargo)

El mapa de códigos se verificó contra `starter_notebook.ipynb` (`lithology_keys`) y `test_code.py`
(`lithology_numbers`), y está documentado en `src/ml/lithology.ts`:

| Índice | Código | Clase | Índice | Código | Clase |
|---|---|---|---|---|---|
| 0 | 30000 | Arenisca | 6 | 70032 | Creta (chalk) |
| 1 | 65030 | Arenisca/Lutita | 7 | 88000 | Halita |
| 2 | 65000 | Lutita | 8 | 86000 | Anhidrita |
| 3 | 80000 | Marga | 9 | 99000 | Toba |
| 4 | 74000 | **Dolomía** (no caliza) | 10 | 90000 | Carbón |
| 5 | 70000 | Caliza | 11 | 93000 | Basamento |

El encargo decía «74000 Caliza» y «88000 Evaporita-Halita(?)»: lo correcto es 74000 = Dolomite, 88000 = Halite y
86000 = Anhydrite; solo 70000 es caliza. La matriz de penalización de la competencia (`penalty_matrix.npy`, 12×12,
simétrica, máximo 4) se leyó con NumPy y se copió como constante (`FORCE_PENALTY_MATRIX`); un test verifica sus
propiedades y entradas conocidas. La confianza de la etiqueta es 1 alta, 2 media, 3 baja (starter notebook). Las
etiquetas son interpretación humana de los pozos, no corona: el modelo aprende «cómo interpretó FORCE», con su ruido.

## D2. Características y mapeo FORCE ↔ TP

Solo curvas presentes en ambos conjuntos. Transformación común (`src/ml/features.ts`), igual para entrenar y
predecir:

| Característica | FORCE 2020 | TP | Unidad | Transformación | Rango válido (fuera → NaN) |
|---|---|---|---|---|---|
| GR | GR | GR | gAPI | — | 0–500 |
| RHOB | RHOB | ZDEN | g/cm³ | — | 1,0–3,3 |
| NPHI | NPHI | NPHI | v/v | si el percentil 95 > 1,5 está en % → ÷100 | −0,05–1,0 |
| PEF | PEF | PE | b/e | — (solo variante con PE) | 0–20 |
| DTC | DTC | DT | µs/ft | — | 30–250 |
| LOG_RDEP | RDEP | AT90 | log10(ohm·m) | log10 | 0,03–10 000 ohm·m |

- **Neutrón.** Verificado: en FORCE el NPHI está siempre en v/v (máximo 0,9996, 599 valores negativos pequeños); el TP
  también (mediana 0,206). El percentil 95 (no el máximo) decide el caso «en %» porque el TP tiene 2 picos de 3,3 v/v
  que un criterio por máximo confundiría con porcentaje.
- **Resistividad.** AT90 (inducción de arreglo de 90 in) se toma como análogo de RDEP; no es la misma herramienta, y
  eso es un límite de la transferencia, no un detalle. Se usa en log10 porque el rango de FORCE llega a 2000 ohm·m.
- **Valores espurios.** El rango físico elimina los picos conocidos de ambos conjuntos (FORCE: GR 1077, PEF 383,
  RHOB 0,72; TP: CAL 1,098 in, NPHI 3,3 v/v, PE > 20) tratándolos como faltantes.
- **Caliper: excluido.** `CALI` está soportado por el featurizador pero no entra a los modelos. En la exploración (14
  grupos de 7 pozos, ver «Exploración») mejoró la penalización 0,957 → 0,932, dentro del ruido (el desvío entre
  grupos es 0,2), y es un proxy de la sección del pozo (diámetro de trépano, profundidad) que no se transfiere a otra
  cuenca; `CALI − BS` no es utilizable porque BS falta en el 42 % de las filas de FORCE. Queda como control de
  calidad, no como entrada.
- **Sin ingeniería de características.** `NPHI − φD` (separación neutrón–densidad) mejoró la penalización 0,888 →
  0,870 en la exploración; se descartó por depender de una matriz asumida (2,65) que en el TP no se conoce y por ser un
  efecto dentro del ruido.
- **Sin profundidad ni coordenadas.** Son identificadores del pozo, no física; el TP (7 633–8 518 m) está fuera de
  todo el rango de FORCE (máximo 5 437 m).

## D3. Faltantes (NaN)

En FORCE faltan muchísimas curvas: NPHI 35 %, PEF 43 %, RHOB 14 %, DTC 7 %, CALI 8 %, RDEP 1 %, GR 0 %; solo el 61 %
de las filas tiene completas las cinco características de la variante sin PE y el 38 % las seis de la variante con PE.

- **Entrenamiento y árbol.** Cada corte aprende hacia qué hijo van los NaN (el que da menor impureza; si el nodo no
  vio NaN en esa característica, hacia el hijo con más filas). No se imputa. Se descartan para entrenar las filas con
  menos de 2 características finitas (no tienen nada que aprender y en inferencia reciben otra regla).
- **Inferencia.** Con menos de 2 características finitas se devuelve la distribución a priori del entrenamiento y
  `valid = 0`; las probabilidades nunca son NaN (testeado). Una curva ausente entera se informa en
  `missingCurves` y se trata como NaN.
- **Riesgo reconocido.** El patrón de faltantes de FORCE depende del pozo y de la época, no de la litología, y un árbol
  puede aprender «sin NPHI → lutita» por ese motivo. No se contrarrestó con aumento de datos (enmascarar al azar). En
  el TP casi no se activa: 144 de 5 810 muestras (2,5 %) tienen algún faltante con PE y 72 (1,2 %) sin PE.
- **Alternativa descartada:** imputación por mediana o por regresión entre curvas; inventa información y esconde que
  la muestra no tenía la curva.

## D4. Con y sin PE: dos modelos

El PE del TP es sospechoso de baritina (decisión 0029: 96 % de las muestras con PE > 4 b/e y ρb < 2,55 g/cm³; mediana
6,4 b/e contra 4,3 en FORCE). Un árbol no puede «ignorar» una característica sin reentrenarse, y un PE distorsionado
empuja a caliza. Se entrenaron dos variantes con la misma configuración: `withPe` (GR, RHOB, NPHI, PEF, DTC, LOG_RDEP)
y `noPe` (sin PEF). `chooseLithologyVariant(curves, 'auto')` aplica la misma regla `detectSuspectPe` de la 0029: sin
curva PE o con PE sospechoso usa `noPe`; en el TP elige `noPe` (fracción 0,96) y devuelve el motivo para mostrarlo.
`'use'` e `'ignore'` fuerzan la variante. Costo: un segundo modelo de 662 KB. Además, el PE casi no aporta fuera de
muestra (ver importancia), así que perder la variante con PE cuesta poco.

## D5. Random forest

Implementación propia (`src/ml/forest.ts`): árboles de clasificación con impureza de Gini, características
cuantizadas en 64 bins por cuantiles (el corte se guarda como un byte; entrenamiento e inferencia cuantizan el valor
en Float32, `Math.fround`, igual que los bordes), muestra con reemplazo por árbol,
`mtry = ⌈√d⌉`. Hiperparámetros del modelo final (todos configurables en `tools/ml/train.mjs`):

| Parámetro | Valor | Motivo |
|---|---|---|
| Árboles | 48 | más árboles no cambiaron las métricas; limita el tamaño |
| Muestra por árbol | 120 000 filas con reemplazo, con probabilidad ∝ peso | usa todo el dataset a lo largo del bosque |
| Profundidad máxima | 16 | |
| Hoja mínima | 60 filas | 20/40/60 dan métricas equivalentes; 60 cuesta la mitad de tamaño |
| Bins | 64 | |
| Clases guardadas por hoja | 6 (uint8, probabilidad real en 1/255) + «resto» repartido según los a priori | con 3 clases y renormalizando se perdía la masa de las clases raras (log-loss del test oculto 0,794 contra 0,755 con las 12; 387 muestras con p(verdad) = 0 contra 16; Dolomía media 0,0017 contra 0,0051). Con 6 + resto: 0,756, 4 muestras en 0 y Dolomía 0,0049, con 1,36 MB en total (ver «Clases por hoja») |
| Peso de clase | (n_mayoritaria / n_clase)^0,25 | compromiso entre exactitud y F1 macro (ver abajo) |
| Peso de confianza | 1 / 0,5 / 0,25 para confianza 1 / 2 / 3 | neutro en la exploración (0,884 vs 0,888 sin pesos); menos peso al dato menos fiable |
| Semilla | 20201 | todo es determinístico (re-entrenar da los mismos bytes: verificado) |

**Peso de clase.** Sin pesos (potencia 0) la exactitud es máxima pero casi nunca se predicen las clases raras (F1 macro
0,21). Con potencia 1 (balanceo completo) la exactitud cae a 0,49 y la penalización sube a 1,41. Con 0,25 se elige un
compromiso (F1 macro 0,33, penalización 0,89). **Consecuencia:** las probabilidades de salida son las de una muestra
reponderada, no las prevalencias reales; no son probabilidades calibradas. Para usarlas como tales haría falta una
calibración (isotónica) que no se hizo.

**Importancia.** MDI (por impureza) se calcula en el entrenamiento y se guarda en el modelo (`importance`, suma 1).
La importancia por permutación (`permutationImportance`, función pura sobre un `predict`) sobre 14 pozos retenidos
(modelo reentrenado sin ellos, barajado dentro de cada pozo; métrica F1 macro / penalización):

| Variante | GR | RHOB | NPHI | PEF | DTC | LOG_RDEP |
|---|---|---|---|---|---|---|
| noPe, MDI | 0,334 | 0,171 | 0,183 | — | 0,179 | 0,134 |
| noPe, permutación (caída de F1 macro) | 0,066 | 0,076 | 0,044 | — | 0,028 | 0,041 |
| noPe, permutación (aumento de penalización) | 0,285 | 0,119 | 0,181 | — | 0,025 | 0,030 |
| withPe, MDI | 0,319 | 0,154 | 0,159 | 0,081 | 0,168 | 0,119 |
| withPe, permutación (caída de F1 macro) | 0,082 | 0,081 | 0,059 | 0,012 | 0,025 | 0,045 |
| withPe, permutación (aumento de penalización) | 0,312 | 0,109 | 0,166 | 0,001 | 0,002 | 0,009 |

El GR domina y luego densidad y neutrón. El sónico y el PE pesan bastante por MDI y casi nada por permutación fuera
de muestra: el sesgo conocido de MDI (reparte a favor de características continuas y correlacionadas). La
importancia por permutación subestima las curvas correlacionadas (RHOB–NPHI–DTC).

## D6. Electrofacies sin supervisión

`clusterElectrofacies(curves, { k, method: 'kmeans' | 'gmm', seed })` (`electrofacies.ts`, `kmeans.ts`, `gmm.ts`):

- Características por defecto: GR, RHOB, NPHI, DTC, LOG_RDEP (sin PE ni caliper); estandarización robusta (mediana y
  (p84 − p16)/2 por característica).
- **k-means** con inicialización k-means++, 5 reinicios con semillas derivadas, desempate al centro de menor índice,
  re-siembra determinística de clusters vacíos. Los NaN se manejan con distancia sobre las dimensiones observadas.
  Pseudo-probabilidad: `p_j ∝ exp(−‖x−c_j‖²/(2σ²))` con σ² la varianza común dentro de los clusters (responsabilidades
  de una mezcla esférica de pesos iguales). **No es una probabilidad calibrada**; ordena la ambigüedad entre clusters.
- **Mezcla gaussiana** (EM, covarianza diagonal) inicializada con k-means, log-sum-exp, piso de varianza 1e-3 en
  unidades estandarizadas, reinicio de componentes colapsados sobre la muestra peor explicada, NaN marginalizados
  exactamente (EM exacto para faltantes al azar). Devuelve responsabilidades, pesos, medias, varianzas, log-verosimilitud
  y BIC. `scanClusterCount` ayuda a elegir k, con una advertencia: las muestras de un perfil están autocorrelacionadas
  (vecinas a 0,15 m casi idénticas), el BIC las trata como independientes y por eso **tiende a sobreestimar k**. Tomar
  el k del BIC como cota superior y preferir el codo o el criterio del intérprete.
- **Orden canónico** de clusters (lexicográfico por el centro, con el GR primero): el cluster 0 es el de menor GR en
  cualquier semilla.
- Las etiquetas no son litologías: son grupos de respuesta parecida que el intérprete nombra.

## D7. Validación

`src/ml/validation.ts`. Dos esquemas sin fuga, ambos con exactitud, F1 macro, matriz de confusión por clase y
penalización de la competencia:

1. **Bloques de profundidad por pozo** (`depthBlockFolds`): bloques contiguos de 200 m por pozo repartidos entre 5 folds
   (round-robin con desfase propio de cada pozo), con **buffer de 30 m**: ninguna muestra de entrenamiento queda a menos
   de 30 m de un bloque de prueba del mismo pozo. Propiedades testeadas: los conjuntos de prueba particionan las
   muestras, train y test nunca se solapan, el buffer se respeta, cada bloque entero cae en un solo fold.
2. **Leave-one-well-out** (`leaveOneWellOutFolds`): 98 folds, uno por pozo. Es el esquema que se parece a aplicar el
   modelo a un pozo nuevo.

Además se corrió una partición **al azar** (5 folds) solo para medir cuánto infla. Toda la validación usa la
configuración del modelo final, y los pesos de clase de cada fold se calculan solo con sus filas de entrenamiento
(`crossValidate` además falla si una muestra aparece en train y test). **Sesgo optimista leve:** los 98 pozos de los bloques y del leave-one-well-out son los mismos con los que se
exploraron y eligieron los hiperparámetros (peso de clase, hoja mínima, características); el test oculto solo se usó
en la corrida final, sin ajustar nada con él. Cifras reales (agrupadas sobre todas las
muestras de prueba; ver el archivo de métricas para la media por fold, el desvío y la matriz de confusión):

| Esquema | Variante | Exactitud | F1 macro | Penalización FORCE (puntuación) |
|---|---|---|---|---|
| Al azar (5 folds) | noPe | 0,769 | 0,528 | 0,613 (−0,613) |
| Al azar (5 folds) | withPe | 0,782 | 0,549 | 0,578 (−0,578) |
| Bloques de profundidad (5 folds, 200 m, buffer 30 m) | noPe | 0,728 | 0,416 | 0,723 (−0,723) |
| Bloques de profundidad (5 folds, 200 m, buffer 30 m) | withPe | 0,741 | 0,433 | 0,692 (−0,692) |
| Leave-one-well-out (98 pozos) | noPe | 0,676 | 0,351 | 0,871 (−0,871) |
| Leave-one-well-out (98 pozos) | withPe | 0,681 | 0,359 | 0,862 (−0,862) |
| Test oculto oficial de FORCE (10 pozos ajenos a train.csv, 122 397 muestras) | noPe | 0,745 | 0,436 | 0,674 (−0,674) |
| Test oculto oficial de FORCE | withPe | 0,754 | 0,449 | 0,651 (−0,651) |

- La partición al azar infla respecto de los bloques: +0,04 de exactitud, +0,11 de F1 macro y −0,11 de penalización
  (más optimista). Un test sintético muestra el mecanismo: con litología constante por tramo y sin relación entre
  tramos, el azar da > 0,85 y los bloques < 0,6 (el valor sin información sería 1/3).
- Leave-one-well-out es peor que los bloques (los pozos nuevos son más difíciles) y **muy variable entre pozos**: el
  desvío de la penalización por pozo es 0,40 (media por pozo 0,85). El número agrupado esconde pozos con 1,0 o más.
- Solo con las muestras de confianza 1 todo mejora (LOWO noPe: exactitud 0,706, penalización 0,787): parte del error
  es ruido de la etiqueta.
- Por clase (LOWO noPe): lutita F1 0,82, arenisca 0,61, anhidrita 0,71, halita 0,61 (recall 0,45: muchas halitas
  van a caliza), caliza 0,51, carbón 0,43. **Arenisca/lutita (0,18), marga (0,20), creta (0,10), toba (0,05), dolomía
  (0,00) y basamento (0,00) no se distinguen** fuera de muestra: son clases con soporte escaso o definidas por
  contexto que cuatro-cinco curvas no capturan.
- El test oculto oficial (10 pozos de la misma región de FORCE) da −0,65/−0,67; no es una medida de transferencia a otra
  cuenca. Se informa como referencia de que la implementación funciona: la puntuación es de calidad media, no una
  réplica de los mejores equipos de la competencia.
- El PE aporta poco: 0,871 → 0,862 de penalización en LOWO.
- **Verificación independiente del puntaje.** Las predicciones de los modelos embebidos sobre el test oculto se
  reevaluaron fuera del código TypeScript, con NumPy y la fórmula de `test_code.py` (−media de `A[verdad, predicción]`
  con el `penalty_matrix.npy` original): −0,674 (noPe) y −0,651 (withPe), exactitud 0,745 y 0,754 (repetido con los modelos actuales, 6 clases por hoja + resto; la primera versión daba −0,672 y −0,650); coinciden con las
  cifras del motor de métricas. La constante TypeScript de la matriz es idéntica elemento a elemento al `.npy`.

## D8. Tamaño y tiempos

| | withPe | noPe |
|---|---|---|
| Árboles / nodos / hojas | 48 / 122 254 / 61 151 | 48 / 122 050 / 61 049 |
| Binario | 1197 KB | 1194 KB |
| Texto embebido (zlib + base64) | 662 KB | 662 KB |
| Entrenamiento (Node 22, 4 núcleos compartidos, una sola hebra) | 9 s | 8 s |
| Decodificar el modelo | 35 ms | 53 ms |
| Inferencia de las 5 810 muestras del TP (mediana caliente) | 42 ms | 42 ms |

Los dos modelos suman 1,36 MB de texto (objetivo ≤ 1,5 MB; un test lo verifica). Importar solo el barril `src/ml/index.ts` (sin `embedded.ts`) pesa 11 KB: el modelo no se arrastra al hilo
principal; se importa desde `src/ml/embedded.ts` únicamente en el Worker. Un bundle de Vite en formato IIFE
con toda la API más los modelos pesa 1,38 MB y se ejecutó en un contexto sin DOM, `Buffer` ni `btoa`. El
entrenamiento completo (lectura del CSV de 280 MB incluida) tarda unos 30 s; la validación leave-one-well-out, unos
14 min por variante.

## D9. Resultado sobre el pozo del TP (solo forma, no «verdad»)

El test de humo del modelo embebido verifica: 5 810 muestras, probabilidades que suman 1 (± 1e-5) y sin NaN, índices de
clase en rango, confianza = probabilidad máxima ≥ 1/12, ≥ 5 700 muestras válidas, tamaño del modelo y que el PE se
descarte en modo automático. No verifica que las litologías sean correctas: no hay verdad de terreno. A título
informativo, el modelo sin PE da en el TP mayormente arenisca y lutita, con arenisca dominante en las zonas B y D y
lutita en C y E, y algo de caliza (11 %) y marga (9 %) en la zona A, coherente con la inversión mineral de la 0029;
confianza media 0,59. Es una observación de consistencia, no una validación.

## D10. Límites de la transferencia de cuenca

La hipótesis del plan («la respuesta física se transfiere») se sostiene a medias:

- **Profundidad.** El TP está entre 7 633 y 8 518 m; en FORCE solo el 1,5 % de las muestras pasa de 4 500 m (9 pozos) y
  ninguna de 5 437 m. A esa profundidad la compactación y la cementación cambian densidad, sónico y neutrón de una
  misma litología. El modelo extrapola.
- **Distribuciones.** Más del 97 % de los valores del TP caen dentro del rango p1–p99 de FORCE en cada curva (NPHI 2,4 %
  fuera, RDEP 1 %), así que no hay extrapolación grosera en una curva por separado; sí puede haberla en la combinación.
- **Herramientas y calibración.** FORCE mezcla décadas y proveedores; el TP tiene una resistividad de inducción
  (AT90) que no es RDEP. El PE del TP está contaminado (baritina).
- **Etiquetas.** Interpretación humana de FORCE (Mar del Norte: lutitas de gran espesor, carbonatos, evaporitas), con
  clases (halita, anhidrita, creta, toba, carbón, basamento) que probablemente no existen en el TP. La salida debe
  leerse como «a qué se parece según FORCE», con la probabilidad delante, y no como una litología medida. Las clases
  que el modelo no distingue (D7) no deberían mostrarse como si fueran fiables.
- **Qué mide cada número.** LOWO y los bloques miden generalización dentro de la cuenca de FORCE; ninguno mide la
  transferencia al TP. La única forma de medirla es comparar con corona o con la interpretación de la cátedra del TP.
  Pendiente.

## Exploración de hiperparámetros (datos de apoyo)

Realizada con 24 árboles, muestra de 60 000 filas por árbol y 14 grupos de 7 pozos en leave-group-out (salvo las dos
últimas filas, con 48 árboles y muestra de 120 000, como el modelo final); no es el esquema final, solo orientó las
decisiones. Variante sin PE; exactitud / F1 macro / penalización en leave-group-out:

| Prueba | Exactitud | F1 macro | Penalización |
|---|---|---|---|
| class-power 0 | 0,684 | 0,207 | 0,863 |
| class-power 0,25 | 0,667 | 0,330 | 0,888 |
| class-power 0,5 | 0,639 | 0,324 | 0,957 |
| class-power 1 | 0,486 | 0,275 | 1,413 |
| class-power 0,5 + CALI | 0,647 | 0,337 | 0,932 |
| class-power 0,25 + NPHI − φD(2,65) | 0,674 | 0,341 | 0,870 |
| mtry 2 / 3 / 4 (class-power 0,5) | 0,645 / 0,639 / 0,635 | 0,325 / 0,324 / 0,322 | 0,939 / 0,957 / 0,965 |
| pesos de confianza 1/0,5/0,25 · 1/1/1 · 1/0,25/0,1 (hoja 100) | 0,672 · 0,670 · 0,673 | 0,274 · 0,282 · 0,281 | 0,884 · 0,888 · 0,881 |
| hoja mínima 20 / 40 / 60 (48 árboles, muestra 120 000) | 0,665 / 0,668 / 0,669 | 0,325 / 0,328 / 0,326 | 0,896 / 0,887 / 0,886 |
| clases por hoja 3 / 12, renormalizando (hoja 40) | 0,668 / 0,668 | 0,328 / 0,328 | 0,887 / 0,888 |

Las diferencias menores que ≈ 0,03 de penalización están dentro del ruido (desvío entre grupos ≈ 0,2).

## Clases por hoja (corrección tras la revisión)

La exactitud y la penalización no dependen de cuántas clases se guardan (el argmax no cambia), pero las probabilidades
sí. Medido sobre el test oculto (modelo sin PE, floor 1e-6 para la log-loss; mismos árboles, solo cambia el
almacenamiento de las hojas):

| Almacenamiento | Log-loss | Muestras con p(verdad) = 0 | Dolomía, p media | Texto de los dos modelos |
|---|---|---|---|---|
| 3 clases, renormalizadas (versión anterior) | 0,794 | 387 | 0,0017 | 0,91 MB |
| 3 clases + resto repartido | 0,773 | 0 | 0,0023 | 0,99 MB |
| 4 clases + resto | 0,762 | 0 | 0,0032 | 1,15 MB |
| **6 clases + resto (elegida)** | **0,756** | 4 | 0,0049 | **1,36 MB** |
| 12 clases (exacto) | 0,755 | 16 | 0,0051 | 1,51 MB |

(withPe: 0,756 → 0,738 con 6 clases + resto.) Cada hoja guarda la probabilidad real de sus 6 clases más probables;
la masa restante se reparte al predecir entre las demás clases según los a priori del entrenamiento. Con 12 clases el
promedio de hojas es exacto (test); con 6 + resto la diferencia es ≈ 0,0003 de log-loss y el modelo queda por debajo del
presupuesto de 1,5 MB.

## Alternativas descartadas

- **Dependencia externa** (xgboost/ONNX/WASM): prohibida por la restricción de cero dependencias y de un solo HTML.
- **Un solo modelo con PE enmascarado:** un árbol entrenado con PE lo usa cuando está; enmascararlo en inferencia lo
  degrada de forma impredecible. Dos modelos son más claros.
- **Todo el dataset en el build:** 280 MB, descartado por la restricción de tamaño.
- **Normalización por pozo** (z-score de cada curva dentro del pozo): ayuda entre pozos de FORCE pero cambia el
  significado de las curvas en un pozo cuya litología no es la media de FORCE (el TP es casi todo siliciclástico).
- **Partición al azar:** infla (D7).

## Abierto para la 10c y para después

1. **Hecho en la 10c (0031):** pista de litología con probabilidad apilada, panel de importancia (MDI almacenada) y
   selector de k de electrofacies con `scanClusterCount`, todo calculado en el Web Worker. La permutación bajo demanda
   quedó fuera (sin verdad de terreno del TP; ver 0031, D5).
2. **Hecho en la 10c (0031):** aviso `variantReason` y advertencia de transferencia de cuenca en los avisos del módulo,
   en el panel y en el tooltip de la pista.
3. **Hecho en la 10c (0031):** las clases que el modelo no distingue (F1 < 0,25 en leave-one-well-out) se atenúan en la
   pista y se rotulan «poco distinguible»; no se agrupan.
4. Calibración de probabilidades (isotónica por clase) si se quieren mostrar como probabilidades reales.
5. Medir la transferencia con datos del TP (corona o interpretación de la cátedra) cuando existan.
6. Más variantes de entrenamiento (p. ej. solo siliciclásticos) si la cátedra confirma que el TP lo es.
7. Una vez integrado, ajustar la inversión mineral y las zonas con las litologías sugeridas, no al revés.
