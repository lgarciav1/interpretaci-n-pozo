# 0062 — Log Digitizer: motor puro de digitalización de registros escaneados

- Estado: fase 1 implementada (motor puro y tests). Fase 2 (interfaz): hecha, ver [0063](0063-log-digitizer-interfaz.md). Fase 3
  (punta a punta): validada con imágenes sintéticas y exportadas por la app (también perspectiva y sesión); falta un
  escaneo real.
- Alcance: carpeta nueva `src/digitizer/` (motor, tipos, sesión) y `tests/digitizer/` (generador sintético y pruebas).
- No cambia: el modelo de datos, el motor de cálculo, los módulos, la interfaz ni el HTML final (el motor todavía no se
  importa desde la app: `dist/index.html` queda byte a byte igual, 6.066.335 bytes).

## Contexto

El TP trabaja con un pozo ya digitalizado, pero un petrofísico recibe a menudo registros ajenos o antiguos que solo
existen como imagen escaneada. El «Log Digitizer» los convierte en curvas digitales (profundidad + valor) que la app
importa a un pozo y exporta a LAS/CSV. Es una herramienta de **adquisición de datos**, no un módulo de cálculo
petrofísico: la curva digitalizada es un `Curve` con `origin.kind = 'measured'` y fuente «Log Digitizer».

Restricciones heredadas: todo en TypeScript y en el navegador, sin dependencias nuevas (nada de OpenCV.js ni de
bibliotecas de visión), sin servidor, un solo HTML. Por eso el motor es propio, puro (sin DOM ni `<canvas>`), recibe la
imagen como `{ width, height, data: Uint8ClampedArray }` (igual que `ImageData`) y devuelve `Float64Array` y objetos
simples, transferibles a un Web Worker. Las funciones largas aceptan `onProgress` y `AbortSignal`.

## Decisiones

### D1. Dos decisiones críticas del masterplan

1. **Índice de profundidad común.** El índice de profundidad de la app es de todo el pozo (`Well.depth`). Una curva
   digitalizada entra de dos maneras, ambas puras (`src/digitizer/integration.ts`):
   - `addDigitizedCurveToWell(well, serie, meta, opts)`: la **remuestrea al índice del pozo** (NaN fuera del tramo
     digitalizado, sin extrapolar; huecos entre puntos mayores que `maxGapM` → NaN) y devuelve un pozo nuevo (el original
     no se toca). Si no hay superposición lanza `DigitizerError('no-overlap')`. El id se vuelve único (`GR`, `GR_2`…).
   - `createWellFromDigitized({ step, unit, curves })`: **pozo nuevo con índice uniforme** (paso en m o ft; la grilla
     cae en múltiplos exactos del paso y abarca la unión de los tramos).
2. **La sesión se guarda aparte del proyecto.** `DigitizerSession` (imagen + calibración + curvas + trazos) es **JSON
   puro** (`isJsonPure`): sin funciones ni arrays tipados. La imagen no va dentro, solo nombre, tamaño y una huella
   (`fingerprintImage`) para comprobar que es la misma al reabrir. Los trazos se guardan con `null` en lugar de NaN
   (`serializeTrace`/`deserializeTrace`). `parseSession`/`validateSession` rechazan sesiones corruptas con mensajes en
   español. La persistencia la hace la fase 2.

### D2. Convenciones

- Coordenadas de imagen: x = columna, y = fila hacia abajo; el centro del píxel (i, j) está en (i, j); posiciones
  subpíxel. La imagen está derecha y la profundidad crece hacia abajo.
- Profundidad física en **metros**, estrictamente creciente, faltantes = NaN (como `DepthIndex`).
- Escalas de valor: se reutiliza `AxisScale`, `fractionToValue`, `valueToFraction` y `validScale` de
  `src/viewer/scale.ts` (lineal o log, normal o invertida); no se duplica la matemática. Es lo único que el motor
  importa de `viewer/` (un test lo verifica).
- Errores de entrada: `DigitizerError` con código y mensaje en español. Imagen sin trazo o curva interrumpida **no** son
  errores: dan NaN y advertencias. Cancelación: `DigitizerAbortError` (`name === 'AbortError'`).

### D3. Archivos y contratos

| Archivo | Contenido |
|---|---|
| `types.ts` | `RasterImage`, `PixelPoint`, `Region`, `DepthTie`/`DepthCalibrationSpec`/`DepthCalibration`, `ValueFrame`, `CurveColorSpec`, `TraceMask`, `TraceSettings`, `TracedCurve`, `DigitizedSeries`, `ResampledSeries`, `DigitizerCurveSpec`, `GeometryStep`, `DigitizerSession` |
| `calibration.ts` | amarres de profundidad (lineal por tramos o recta de mínimos cuadrados con residuo RMS), unidad m/ft, escala de valor y sus inversas |
| `geometry.ts` | inclinación, homografía de 4 pares, rectificación de perspectiva, remuestreo bilineal |
| `color.ts` | CIELAB, ΔE, máscara de color y oscura, colores sugeridos |
| `tracing.ts` | trazado por Viterbi, modos automático y guiado |
| `sampling.ts` | trazo → serie física, remuestreo uniforme / al índice del pozo, mediana móvil, picos |
| `quality.ts` | métricas y banderas de calidad |
| `integration.ts` | pozo existente / pozo nuevo / `ExportInput` para `writeLas` y `writeCsv` |
| `session.ts`, `pipeline.ts`, `errors.ts`, `index.ts` | sesión, flujo completo (`digitizeCurve`, `applyGeometry`), errores, API pública |

### D4. Calibración (`calibration.ts`)

- **Profundidad.** ≥ 2 amarres (fila ↔ profundidad impresa, en m o ft; se convierte a metros con `src/core/units.ts`).
  Método `'piecewise'` (lineal por tramos que pasa por todos los amarres; fuera del primero y el último se prolonga con
  la pendiente del tramo extremo) o `'linear'` (recta de mínimos cuadrados). En ambos casos se reporta el **residuo RMS**
  del ajuste lineal global en m y en px (`rmsResidualPx`): con ≥ 3 amarres, > 2 px avisa «escaneo estirado o amarre mal
  puesto». Se verifica la monotonía (la profundidad debe crecer hacia abajo) y que no haya dos amarres en la misma fila.
  Inversas: `rowAtDepth`. Mensajes de error en español (`checkDepthSpec` los lista sin lanzar).
- **Valor.** `ValueFrame { leftPx, rightPx, scale }`: dos columnas con valor conocido (normalmente los bordes de la
  pista, sirven dos líneas de grilla rotuladas). `valueAtX`, `xAtValue` (inversa; NaN si el valor es ≤ 0 en log),
  `axisFromEdgeValues(izq, der, tipo)` (detecta la inversión) y `checkValueFrame`.

### D5. Geometría (`geometry.ts`)

- **Inclinación**: `estimateTiltAngle(p1, p2)` = `atan2(dx, dy)` de una línea que debería ser vertical;
  `rotateImage(img, ángulo, { expand })` rota alrededor del centro (bilineal) y devuelve las homografías directa e inversa.
- **Perspectiva**: `homographyFromPoints(src[4], dst[4])` resuelve las 8 incógnitas del sistema lineal
  (x h0 + y h1 + h2 − u x h6 − u y h7 = u, y análoga para v) con **normalización de Hartley** (centroide al origen,
  distancia media √2) y **eliminación gaussiana con pivoteo parcial**; rechaza puntos degenerados (tres alineados o
  repetidos). `rectifyQuad(img, [TL, TR, BR, BL], ancho, alto)` lleva un cuadrilátero convexo a un rectángulo. Por qué
  Hartley: con coordenadas de miles de píxeles el sistema sin normalizar queda mal condicionado; el test recupera una
  homografía conocida con puntos de hasta 11.800 px con error < 1e-6 px.
- Remuestreo bilineal de los 4 canales, relleno blanco fuera de la imagen. La geometría se registra en la sesión como
  `GeometryStep[]` y `applyGeometry` la reaplica; `mapPoint` lleva puntos de la original a la corregida.

### D6. Color (`color.ts`)

- sRGB → CIELAB (D65, CIE 15:2004), verificado contra valores de referencia (blanco, negro, rojo, verde, azul, gris 128).
  Distancia ΔE*ab (CIE76): suficiente para separar tintas de un registro; CIEDE2000 queda fuera por no aportar aquí.
- **Máscara de color**: un píxel anti-aliased es una mezcla papel→trazo; se proyecta en L\*a\*b\* sobre el segmento
  papel→color: intensidad = 255 · α · (1 − ρ/tolerancia), con α la fracción de trazo y ρ la distancia al segmento. Así
  los trazos finos (cuyos píxeles son todos mezclas) siguen activos, los bordes aportan cobertura parcial (centroides
  subpíxel) y la grilla gris o un trazo de otro color queda en cero. Se probó primero la distancia simple al color: no
  detectaba trazos de 1–2 px.
- **Máscara oscura** (negro sobre claro): por L\* con límite de croma (excluye azules oscuros). El borde de la pista
  también es oscuro: la región de búsqueda debe quedar dentro de la pista.
- `suggestCurveColors(imagen, región)`: descarta papel (L\* > 88 y croma < 12) y gris claro de grilla; cuantiza en
  bins de 6, agrupa con k-means ponderado **determinista** (inicio farthest-first, sin azar), representa cada grupo por
  el 40 % más alejado del papel (el trazo pleno, no el anti-aliasing), fusiona grupos a ΔE < 20, devuelve la
  `CurveColorSpec` lista (`dark` o `color`) y el color del papel estimado.

### D7. Trazado (`tracing.ts`)

Entrada: máscara de intensidad. Por fila, **candidatos** = tramos horizontales contiguos de píxeles activos
(puenteo de huecos de 1 px por ruido JPEG; centro = centroide ponderado, subpíxel; ancho registrado; los tramos de
≤ 2 px sin apoyo en las filas vecinas —sal y pimienta— se descartan; máximo 12 por fila por masa).

Se elige la trayectoria que minimiza

    C = Σ_j [(1 − q_j) − R] + Σ_(i→j) T(i,j) + (nº de cadenas) · S
    T(i,j) = (g' / (σ·√d))² + 0,02·|c_j − c_i| / d,     g' = max(0, g − freeSlope·d)

con q = calidad (intensidad media), R = recompensa por fila explicada, d = distancia en filas (d > 1 atraviesa un
hueco), g = distancia horizontal entre los tramos (0 si se solapan: un barrido casi horizontal es continuo aunque su
centro salte) y S = costo de empezar una cadena. Es un Viterbi sobre candidatos con aristas «salteadas» hasta
`maxGapRows + 1` filas y un mínimo prefijo para los reinicios; complejidad O(filas · (maxGapRows+1) · K²).

- **Huecos** de hasta `maxGapRows` filas (punteado, cruce, texto) se atraviesan interpolando x; esos puntos salen con
  `observed = 0` y confianza baja. Los más largos dejan **NaN**: no se inventan datos. Las cadenas con menos de
  S/R ≈ 6 filas nunca valen la pena (rótulos y manchas).
- **Tramos anchos** (> `wideRun`): se registra el ancho, baja la confianza y, si hay vecinos angostos, se toma el punto
  del tramo más cercano a la interpolación entre ellos.
- **Confianza** por punto = calidad × factor de ancho × exp(−0,35 · mayor costo de transición vecino). Heurística, no
  una probabilidad. Los puntos interpolados valen el 25 % del menor entre sus vecinos.
- **Automático**: toda la pista, con `prior { x, y?, sigma?, rows? }` opcional (penalización cuadrática cerca de la fila
  de referencia). **Guiado**: polilínea aproximada del usuario + corredor de ± k px; solo se aceptan píxeles dentro del
  corredor y se trazan únicamente las filas que abarca la guía.

#### Parámetros por defecto (`DEFAULT_TRACE_SETTINGS`)

| Ajuste | Valor | Qué controla |
|---|---|---|
| `threshold` | 96 (de 255) | intensidad mínima para que un píxel sea activo |
| `bridge` | 1 px | huecos de hasta 1 px dentro de un tramo se puentean |
| `maxCandidates` | 12 | candidatos por fila |
| `maxGapRows` | 25 filas | hueco máximo que se atraviesa |
| `sigma` | 2 px | escala del costo de salto lateral |
| `freeSlope` | 6 px/fila | pendiente que no se penaliza al atravesar un hueco |
| `maxJump` | 40 px/fila | salto máximo admisible entre tramos (más allá solo se reinicia) |
| `coverageReward` (R) | 4 | valor de explicar una fila |
| `restartCost` (S) | 24 | costo de una cadena nueva |
| `wideRun` | 30 px | desde aquí un tramo es un barrido casi horizontal |
| `despeckle` | true | descarta tramos de ≤ 2 px sin apoyo vertical |
| corredor guiado | 12 px | semiancho por defecto |
| tolerancia de color | ΔE 28 | `CurveColorSpec.tolerance` |
| modo oscuro | L\* 40 / 75, croma 30 | `lightMax` / `lightMin` / `chromaMax` |

### D8. Muestreo (`sampling.ts`)

Trazo → serie: z = `depthAtRow(y)`, v = `valueAtX(x)`; ordena y **promedia** los puntos con la misma profundidad
(media geométrica en escala log). Remuestreo: interpolación lineal (en log10 si la escala es log), **sin extrapolar**,
con `maxGapM` (por defecto 5 × el espaciado mediano) → NaN. Grilla uniforme en m o ft alineada a múltiplos del paso;
`resampleToIndex` para el índice de un pozo. Opcionales (apagados por defecto): `medianFilter(serie, ventana impar)` y
`removeSpikes` (pico aislado = se aparta de sus dos vecinos más que 25 % del ancho de la escala en el mismo sentido y
esos vecinos coinciden entre sí; se elimina o se reemplaza).

### D9. Calidad (`quality.ts`)

`assessQuality(trazo, calibración, marco, { expectedRows?, thresholds? })` → métricas (cobertura, fracción observada,
saltos y saltos/1000 filas, temblor estimado en px, confianza media, residuo de calibración) y banderas con mensajes en
español. Umbrales (`DEFAULT_QUALITY_THRESHOLDS`): aviso / mala → cobertura < 80 % / < 50 %; saltos > 5 / > 20 por 1000
filas (salto = cambio > 15 % del ancho de pista entre filas consecutivas); temblor > 1,5 / > 4 px; confianza media
< 0,5 / < 0,3; residuo de calibración > 2 / > 5 px (solo con método lineal y ≥ 3 amarres). `isLowQuality` = nivel ≠ bueno.

## Validación (números medidos)

Todo con el generador sintético `tests/digitizer/synth.ts` (grilla gris con líneas más oscuras cada 5, pista con
bordes, rótulos, curvas gruesas con anti-aliasing, punteadas, varios colores, cruces, desenfoque, ruido gaussiano, sal y
pimienta, artefactos JPEG por DCT 8×8, y deformaciones geométricas aplicadas a los **vértices** al dibujar, de modo que
el motor se prueba contra una deformación que no usa su propio remuestreo). Imagen base: 720 × 2400 px, pista de 600 px,
escala 0–150, 0,05 m/px. Error de valor en % del rango de la escala (en décadas para escala log).

**Casos limpios** (criterio: RMS del valor ≤ 1 % del rango y profundidad ≤ 1 px; desfase estimado por correlación en
pasos de 0,25 fila):

| Caso | Cobertura | RMS valor | RMS posición | Desfase de profundidad |
|---|---|---|---|---|
| verde 3 px con grilla y borde | 100 % | 0,017 % | 0,10 px | 0 filas |
| negro (modo oscuro) con rótulos | 100 % | 0,036 % | 0,22 px | 0 filas |
| trazo de 1 px | 100 % | 0,018 % | 0,11 px | — |
| resistividad log 0,2–2000 (4 décadas) | 100 % | 0,017 % del rango en décadas | 0,10 px | — |
| DT invertida 140→40 | 100 % | 0,015 % | — | — |

**Casos difíciles** (se documenta, sin ocultar fallos):

| Caso | Cobertura | Observada | RMS valor | Error máx. |
|---|---|---|---|---|
| punteado 18 px / 10 px | 99,9 % | 85,6 % | 0,18 % | 5,1 px |
| ruido fuerte (desenfoque, gauss σ=25, sal y pimienta 3 %, JPEG q=14, 40 rótulos), verde | 100 % | 99,5 % | 0,15 % | 5,5 px |
| ídem, negro | 100 % | 100 % | 0,11 % | 9,5 px |
| negra punteada fina (2 px, 10/8) con ese ruido | 100 % | 81,5 % | **0,42 %** | **30 px** (un punto) |
| cruce con otra curva de otro color dibujada encima | 100 % | 100 % | 0,042 % | 4,3 px |
| hueco de 20 filas (≤ 25) | 100 % | 99,3 % | 0,040 % | 3,9 px |
| hueco de 100 filas (> 25) | 95,9 % (98 filas NaN, sin inventar) | 95,9 % | 0,022 % | 3,4 px |
| escalones 30↔120 en una fila | 100 % | 100 % | **3,0 %** | 144 px |
| dos curvas del MISMO color que se cruzan, automático | 100 % | — | 36,6 % contra A, **2,6 % contra B** | — |

Lectura: el modo automático sigue UNA curva (aquí B) sin mezclarlas; elegir cuál con el prior o con el modo guiado
(RMS ≤ 1 % en el test). Los escalones son ambiguos por naturaleza (en las 2 filas del barrido la «posición verdadera»
no está definida); fuera de ±3 filas del salto el error es ≤ 2 px. Con 0,3 px de error al marcar las esquinas, la
rectificación de perspectiva deja líneas de la grilla con error ≤ 1,5 px (≤ 0,5 px con esquinas exactas): la perspectiva
amplifica el error de pick.

**Caso realista con datos reales** (`tests/digitizer/realistic.test.ts`): GR y AT90 del pozo del TP, tramo
7.700–7.850 m (985 muestras), dibujados en un registro de 1020 × 3800 px (dos pistas, GR lineal 0–150 y AT90 log
0,2–2000, 0,04 m/px, desenfoque, ruido gaussiano σ=6, sal y pimienta 0,2 %, JPEG q=5, rótulos, **0,7° de inclinación**) y
digitalizados completos: enderezado desde dos puntos marcados con ±0,5 px, 4 amarres de profundidad con ±0,5 px, bordes
de pista con ±0,5 px, trazado automático por color y remuestreo al índice original:

| Curva | RMSE | Correlación | Cobertura |
|---|---|---|---|
| GR | 0,855 gAPI (0,57 % de 150) | 0,99834 | 100 % |
| AT90 | 0,113 ohm·m = 0,0113 décadas (0,28 % de 4 décadas) | 0,99783 | 100 % |

**Rendimiento** (Node, pista de 1.500 × 12.000 px = 18 Mpx, un solo hilo): máscara de color 136–155 ms + trazado
83–180 ms = **218–335 ms** (objetivo < 3 s); modo oscuro 204–242 ms; rotar la imagen completa 776–848 ms. Sin copias
innecesarias: la máscara es un `Uint8Array` de un byte por píxel; el trazado usa arrays planos; el motor no modifica la
imagen de entrada (test).

Tests: 119 nuevos en `tests/digitizer/` (calibración con cuentas a mano, geometría con ida y vuelta, color contra
valores de referencia, trazado con verdad conocida, muestreo, calidad, integración, LAS/CSV releído con
`readWellFile`, sesión y pureza, flujo completo, realista, rendimiento). Suite completa: 3.261 en verde (3.142 + 119).

## Límites conocidos (fuera de alcance, no esconden fallos)

- Solo imágenes ya rasterizadas (RGBA). **PDF y TIFF** no se leen.
- Curvas que **«dan la vuelta»** al llegar al borde de la pista (wrap): no se siguen ni se unen los dos tramos.
- Sin **OCR**: la escala y los amarres los marca el usuario. Sin **segmentación automática de pistas** de una página.
- Un `x(y)` por curva: no hay lazos ni curvas que retroceden en profundidad.
- Curvas **del mismo color** que se cruzan o se tocan: el automático elige una; usar prior o modo guiado.
- **Escalones** casi horizontales: la posición dentro del barrido es ambigua (error de media pista en 1–2 filas).
- El modo oscuro toma como trazo el borde negro de la pista y las líneas oscuras de grilla de intensidad plena; hay
  que mantener la región dentro de la pista. Rótulos grandes del mismo color pueden desviar el trazo (visto en la
  prueba negra punteada con ruido fuerte: un punto con 30 px de error).
- ΔE*ab (CIE76), no CIEDE2000. Papel de fondo muy teñido: pasar `background` (lo estima `suggestCurveColors`).
- La rectificación asume una página plana (homografía); no corrige curvatura del papel ni deformaciones no proyectivas.
- Perspectiva con picks ruidosos: error de píxel del orden del error del pick, amplificado cerca de los bordes.

## Plan de las fases 2 y 3

**Fase 2 — módulo de interfaz** (otro agente; no toca el motor). Módulo de panel de «Adquisición de datos», con la imagen
mostrada en un canvas propio. Flujo: cargar imagen (`File` → `createImageBitmap` → `ImageData` → `RasterImage`, en la
interfaz) → corregir inclinación/perspectiva (marcar 2 o 4 puntos) → amarres de profundidad → marco de cada curva
(bordes y valores) → color con `suggestCurveColors` (clic) → trazar automático o guiado → semáforo de calidad → importar
(a un pozo o pozo nuevo) o exportar LAS/CSV. El cálculo pesado (`applyGeometry`, `digitizeCurve`) en un Web Worker con
progreso y cancelación. Persistir la sesión aparte del proyecto (`serializeSession`/`parseSession` + huella de la
imagen). Dibujo sobre la imagen con las inversas (`rowAtDepth`, `xAtValue`).

**Fase 3 — pruebas de punta a punta**: guion de navegador con una imagen real escaneada, importación al pozo del TP,
comparación visual en el visor y, si hay un registro con digital conocida, RMSE contra ella; ajuste de los umbrales de
calidad y de los parámetros con casos reales.

### Interfaz recomendada para la fase 2

| La interfaz llama | Con | Devuelve |
|---|---|---|
| `suggestCurveColors(image, region)` | `RasterImage`, `Region` | `ColorSuggestions` (`colors[].spec: CurveColorSpec`) |
| `estimateTiltAngle`, `rotateImage` / `rectifyQuad` / `applyGeometry(image, GeometryStep[])` | puntos marcados | `{ image, forward }` |
| `buildDepthCalibration(spec)`, `checkDepthSpec(spec)` | `DepthCalibrationSpec` | `DepthCalibration` (con `warnings`, `rmsResidualPx`) |
| `axisFromEdgeValues(izq, der, 'linear' \| 'log')`, `checkValueFrame` | valores impresos | `AxisScale` / problemas |
| `digitizeCurve(image, depth, spec: DigitizerCurveSpec, { onProgress, signal })` | imagen corregida | `{ trace, series, quality }` |
| `resampleToUniform(series, { step, unit })`, `resampleToIndex(series, well.depth.values)` | serie | `ResampledSeries` / `Float64Array` |
| `medianFilter`, `removeSpikes` | serie | serie |
| `addDigitizedCurveToWell(well, series, meta)` / `createWellFromDigitized(...)` | pozo / paso | `{ well, curve, coverage }` / `Well` |
| `digitizedExportInput(...)` → `writeLas` / `writeCsv` | curvas remuestreadas | `ExportInput` |
| `createSession`, `serializeSession`, `parseSession`, `serializeTrace`, `sessionMatchesImage` | — | `DigitizerSession` (JSON puro) |
