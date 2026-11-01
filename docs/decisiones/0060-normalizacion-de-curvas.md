# 0060 — Normalización de curvas en «Preparar datos»

Fecha: 2026-11-01. Rama de trabajo del agente, sin integrar.

## Contexto

La Clase 8 («Preparación de datos», slides 7–10) fija el flujo Carga → Edición → **Normalización** → Cálculo de
arcillosidad → …, y define la normalización como «las correcciones que se deben realizar por posibles errores en la
calibración y escalas de los registros». La slide 10 la muestra comparando histogramas y curvas de frecuencia
acumulada de la misma curva (NPHI) antes y después. La app no tenía ninguna herramienta de normalización (solo la
calibración de los extremos de GR contra DRX, que no cambia la curva).

La tubería de preparación (0036–0041, 0058) aplica, por curva y en orden fijo, Exclusión → Interpolación → Mediana →
Alineación. Cada etapa es parte de una receta reproducible guardada en el proyecto v7 (`PreparationState`), evaluada
en el plan de preparación del motor y publicada con banderas de calidad por muestra (`Quality`, `Uint16Array`).

## Decisión

### 1. Matemática (`src/core/preparation/normalization.ts`, pura y probada)

Tres métodos sobre la curva tal como sale de la etapa anterior (después de la alineación):

| Método | Transformación | Anclajes |
|---|---|---|
| Dos puntos (lineal) | x' = y_lo + (x − x_lo)·(y_hi − y_lo)/(x_hi − x_lo) | x_lo = P_lo, x_hi = P_hi |
| Un punto · desplazamiento | x' = x + (y − x_p) | x_p = P_p |
| Un punto · escala | x' = x·y/x_p | x_p = P_p |

- **Percentiles**: definición 7 de Hyndman y Fan (1996) (`numpy.percentile` por defecto, `quantile(type = 7)` de R):
  h = (n − 1)·p/100, x_(p) = x_⌊h⌋ + (h − ⌊h⌋)(x_⌊h⌋+1 − x_⌊h⌋), sobre las muestras ordenadas. Es la misma definición
  que ya usan `src/petro/stats.ts` y el histograma.
- **Muestra de origen**: muestras **finitas** de la etapa anterior con profundidad en el intervalo de referencia
  [tope, base] (extremos incluidos) y **sin** las banderas «excluida» ni «faltante original». Así no cuentan las
  exclusiones (ni los picos que el usuario quitó) ni los valores estimados para rellenar huecos, que no son
  mediciones. Sí cuentan las muestras filtradas y las remuestreadas por una alineación (son mediciones procesadas;
  excluir las «interpoladas» dejaría sin muestra a toda curva corrida una distancia que no es múltiplo del paso).
- **Umbral mínimo: 50 muestras** (`MIN_NORMALIZATION_SAMPLES`, ≈ 7,6 m con paso de 0,1524 m). Con n = 50, el P5 cae
  entre la 3.ª y la 4.ª muestra ordenada (h = 2,45) y el P95 entre la 47.ª y la 48.ª: cada percentil de cola por
  defecto queda apoyado en al menos dos mediciones más allá de él. Con menos muestras el percentil es una lectura
  individual y la normalización sería la de un pico.
- **Dominio de los parámetros** (validación estricta de la receta): tope < base finitos; 0 ≤ P_lo < P_hi ≤ 100 (dos
  puntos) o 0 ≤ P_p ≤ 100 (un punto); referencias finitas; en dos puntos **y_hi > y_lo** (una corrección de
  calibración conserva el orden: invertir la curva no es normalizar; esto cumple a fortiori y_hi ≠ y_lo); en escala,
  y ≠ 0.
- **Dominio de los datos** (al evaluar; el error se muestra como motivo y bloquea «Aplicar»): al menos 50 muestras;
  en dos puntos x_hi > x_lo (un tramo constante no define escala); en escala x_p ≠ 0 y ganancia y/x_p > 0.
- **Alcance de la transformación**: toda la curva (todas sus muestras finitas), porque corrige la calibración de la
  herramienta; el intervalo solo elige de dónde salen los percentiles. Los NaN (faltantes, exclusiones, muestras sin
  soporte de la alineación) se conservan como NaN con sus banderas.
- **Dominio físico por rol** (`NORMALIZATION_DOMAINS`): GR, CGR, URAN, THOR ≥ 0; POTA en [0, 100] %; NPHI y
  porosidades medidas en [−0,15, 1] v/v; porosidades RMN en [0, 1] v/v; RHOB en [1, 5] g/cm³; PEF, DT, DTS, CALI, BS y
  resistividades > 0. Roles sin entrada (SP, TEMP, DRHO…) no tienen dominio declarado. Una salida finita fuera del
  dominio **se conserva** (no se recorta) y lleva la bandera `Quality.OutOfDomain` (128); la herramienta, la tubería,
  la exportación y el informe la cuentan y la avisan.
- **Calidad**: toda muestra finita normalizada lleva la bandera nueva `Quality.Normalized` = **256** (bit 8; cabe en
  `Uint16Array`). Las banderas de las etapas previas se conservan (la normalización es un mapa por muestra, no
  remuestrea). Una salida no finita (desborde) es un error, no un NaN silencioso.
- **Referencia independiente**: `scripts/qa/normalization-reference.py` (numpy) calcula percentiles tipo 7, la ida y
  vuelta de una transformación conocida, un caso con NaN y exclusiones, y los casos de dominio; sus números están
  copiados como esperados en `tests/preparation-normalization.test.ts`.

### 2. Receta y estado

**Un nuevo tipo de nodo `linear-normalization`**, siguiendo el patrón de los nodos existentes: el `kind` es la última
etapa de la receta, con su campo obligatorio (`normalization`), y las anteriores opcionales (`gapFill`, `filter`,
`shift`). `withNodeStages(node, gapFill, filter, shift, normalization)` arma el nodo mínimo; agregar o quitar una etapa
anterior conserva la normalización (y viceversa). La normalización, como las demás etapas, no se combina con MGT.

```ts
type CurveNormalization =
  | { method: 'two-point'; top; base; lowPercentile; highPercentile; lowReference; highReference }
  | { method: 'shift' | 'scale'; top; base; percentile; reference };
```

La receta guarda **niveles de percentil y valores de referencia, no los valores x_lo/x_hi**: los percentiles se
recalculan al evaluar, de forma determinista sobre las entradas fijadas por la revisión. El resultado del motor publica
junto a la curva las estadísticas de la normalización (`PreparedPayload.normalization`: muestras usadas, valores de
origen, ganancia, salidas fuera de dominio), validadas por `validatePreparedPayloads`; de ahí las leen la tubería, el
histograma, la exportación y el informe.

**`PreparationState.schemaVersion` 6.** La versión sigue siendo la **mínima** que exige el contenido (regla vigente
desde 0038): 6 si algún nodo normaliza; si no, 5 (MGT), 4, 3, 2 o 1 como antes. Validación estricta: forma exacta de
cada método (claves de más o de menos se rechazan), dominio de cada campo, y la versión tiene que coincidir con el
contenido (un estado v6 sin normalización, o v5 con normalización, se rechaza).

**Migración desde 1–5: identidad.** Los estados 1–5 siguen siendo válidos tal cual y no se reescriben: un proyecto o
snapshot viejo abre idéntico (mismas recetas, misma `preparationStateKey`, mismo `recipeKey` y por lo tanto la misma
`contentVersion`, la misma caché y los mismos resultados) y, si no se normaliza nada, se vuelve a guardar con la misma
versión de preparación y byte a byte igual. El archivo de proyecto sigue en **v7** (el formato admite nodos nuevos con
su `schemaVersion` interno, como pasó con 2→5). Un proyecto con normalización guardado por esta versión no lo abre una
versión anterior de la app (rechaza `schemaVersion` 6 explícitamente, sin perder datos ni abrir algo distinto).

### 3. Interfaz (`src/modules/preparation/`)

- Etapa **«Normalización»** en la tubería entre Alineación y Preparada, con conteo «N normalizadas» (bit 256).
- Herramienta **«Normalizar»** (`NormalizationEditor.tsx`, `NormalizationHistogram.tsx`, puro `normalizationView.ts`):
  - intervalo de referencia: la vista del panel, el tramo marcado en el gráfico o cualquier zona;
  - modo: Dos puntos / Desplazamiento / Escala (control segmentado);
  - **histograma** (canvas con `useCanvas`, tokens, claro/oscuro, cifras tabulares) con las muestras del intervalo
    ANTES (estado previo a la normalización, en gris) y DESPUÉS (vista previa, en el color de la curva) superpuestos,
    y sus curvas de frecuencia acumulada (eje derecho 0–100 %), como la slide 10. Escala log para resistividades;
  - **marcadores arrastrables** de los percentiles de origen sobre el histograma: arrastrar mueve el nivel del
    percentil (rango empírico inverso de la definición 7, redondeado a 0,1); el gesto cambia solo el borrador (la
    vista previa), Escape lo cancela y vuelve al nivel del comienzo; las flechas lo mueven de a 0,5. Los valores de
    referencia (y sus percentiles, para quien prefiera escribirlos) son campos numéricos;
  - vista previa viva que también actualiza el gráfico antes/después central y la barra de banderas;
  - «Aplicar» = un `commit` con `group` (un paso de deshacer) y «Deshacer» como las otras herramientas; si no se puede
    aplicar, el pie dice por qué (muestras insuficientes, percentiles iguales, transformación identidad, MGT…).
    Las muestras fuera del dominio físico se avisan en el pie sin bloquear.
- «Guardadas» muestra la normalización (método, intervalo, percentiles y referencias) con «Quitar normalización».
- Bandera nueva «Normalizada» en `flags.ts` (leyenda, barra de banderas, tarjetas).
- Paleta (Ctrl+K): **«Normalizar curva»** (grupo Pozo) abre el panel con la herramienta.
- Sin ecuaciones en la interfaz: están en las `docs` del módulo `preparation` (módulo Ecuaciones).

### 4. Alcance

Un pozo. La normalización multi-pozo (ajuste de histogramas entre pozos, pozo tipo) queda fuera: los valores de
referencia se ingresan a mano (los de un pozo vecino o los de arcilla/arena limpia conocidas). Tampoco se normaliza por
corrida o por tramo: una receta corrige toda la curva.

## Alternativas descartadas

- **Campo opcional `normalization` en todos los tipos de nodo.** Rompe el invariante «el `kind` dice la última etapa»
  que usan la validación de forma, la `recipeKey` y la tubería, y obliga a enseñarle a cada `switch` sobre `kind` un
  caso más por tipo. El nodo propio es una sola rama nueva.
- **Nodo aparte por curva para la normalización** (dos recetas encadenadas). El contrato es «una receta por curva
  sobre un original con revisión explícita»; encadenar recetas exigiría un grafo de preparación que no existe.
- **Guardar x_lo y x_hi congelados en la receta.** Reproducible también, pero una exclusión agregada después dejaría
  una transformación vieja calculada con picos que el usuario ya quitó, sin aviso. Recalcular sobre las entradas
  fijadas es igual de determinista y los valores usados quedan en el resultado, la exportación y el informe.
- **Recortar al dominio físico.** Escondería un valor de referencia mal elegido; se marca y se avisa.
- **Excluir del cálculo de percentiles todas las muestras «interpoladas».** Dejaría sin muestra a cualquier curva
  alineada con un corrimiento que no es múltiplo del paso (todas sus salidas son remuestreos).
- **Subir el formato de proyecto a v8.** Innecesario: el cambio es interno a `preparation` y está versionado allí.

## Verificación

- `tests/preparation-normalization.test.ts`: percentiles tipo 7 y rango inverso, transformación conocida de ida y
  vuelta, caso con NaN/exclusiones, dominio de parámetros y de datos, dominio físico y bandera 128, bandera 256,
  composición con interpolación/mediana/alineación, esquema v6 (forma, versión mínima, rechazo de mezclas), migración
  1–5 (proyectos y snapshots viejos abren idénticos y se reescriben byte a byte), guardar/reabrir v7, deshacer/rehacer,
  conteos de la tubería, exportación (descripción QC) e informe (parámetros, percentiles de origen, referencias,
  intervalo) y la lógica pura del histograma y de los marcadores.
- Migración probada contra el código anterior: `tests/fixtures/preparation-legacy-v1-v4.json` se generó con el commit
  `acbd1e4` (antes de esta decisión): cuatro proyectos v7 con preparación 1, 2, 3 y 4 y un snapshot cada uno. Con el
  código nuevo abren con la misma versión, se reescriben iguales (salvo la marca de hora de guardado), dan las mismas
  claves de plan y contexto y los mismos datos y banderas por muestra. La versión 5 (MGT) la siguen cubriendo sin
  cambios los tests de `tests/mgt-environment.test.ts`.
- Navegador: `npm run build && NODE_PATH=$(npm root -g) node scripts/qa/normalization-panel.cjs` sobre
  `dist/index.html` por `file://`, con los perfiles reales del TP cargados con el asistente de 3 pasos. NPHI: P5/P95 de
  la curva original 0,1461/0,2635 v/v; se excluyen los tres picos (3,317, 3,317 y 0,788 v/v en 8.498,89–8.499,20 m) y
  quedan 5.807 muestras de origen con P5 = 0,1461 y P95 = 0,2634 v/v; normalizada a 0,12/0,30 v/v (ganancia 1,5345)
  la tubería cuenta «5.807 normalizadas» y el panel avisa 123 muestras fuera del rango físico (las lecturas de
  −0,038 a −0,041 v/v del fondo del pozo, 8.499,96–8.518,55 m, que quedan por debajo de −0,15), conservadas con la
  bandera 128. Aplicar, deshacer (la exclusión queda), rehacer, guardar v7 (preparación v6), exportar LAS (la curva y su
  `_QC` declaran percentiles, referencias, intervalo y bits) y reabrir con la misma normalización; sin errores de
  página.
- Capturas: `docs/capturas/normalizacion/` (claro y oscuro, dock ancho y angosto).
- Tamaño del HTML único: 5.994.213 bytes antes (commit `acbd1e4`), 6.040.759 después (+46 kB).

## Detalles de interacción

- Mientras el usuario no escribe referencias, éstas siguen a los percentiles de origen (la curva no cambia y el pie
  pide escribirlas). Reabrir la herramienta sobre una normalización aplicada la carga para editarla y no propone un
  cambio vacío.
- La vista previa del histograma se calcula en el hilo de la interfaz con las mismas funciones del motor (5.810
  muestras: un ordenamiento por cambio); la del gráfico central y los conteos vienen del motor aislado de snapshots.
- Mientras se arrastra un marcador el eje del histograma queda fijo (no se mueve bajo el puntero aunque cambie la
  serie «después»).
