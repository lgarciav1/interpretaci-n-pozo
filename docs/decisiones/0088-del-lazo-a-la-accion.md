# 0088 — Del Lazo a la Acción: banderas de usuario y exclusión QC desde selección

Fecha: 2026-11-24. Sigue a la 0014 (histograma y crossplot), la 0016 (pistas armables), la 0021 (selección compartida) y el masterplan de preparación (invariantes I01–I08).

## Contexto

La selección compartida (`PlotSelection`, `src/plots/link.ts`) vincula visualmente un lazo o rectángulo del crossplot, clases del histograma, un rango de distribuciones por zona o un tramo del visor. Hasta ahora esa selección es efímera (estado de UI): al detectar una anomalía (p. ej. baritina, derrumbe o una facies limpia en Densidad–Neutrón), el usuario no puede convertirla directamente en una bandera reutilizable para filtrar otros gráficos (como Pickett) ni enviarla como exclusión trazable al flujo de Preparación.

## Decisión

Cuando hay una `PlotSelection` activa para el pozo vigente, la barra/resumen de selección (en Crossplot, Histograma, Distribuciones y barra del visor) ofrece dos acciones explícitas y deshacibles en un único paso de `commit` (`Ctrl+Z`):

### 1. Banderas de usuario en `Interpretation.userFlags?`

- **Persistencia JSON pura:** se agrega el campo opcional `userFlags?: readonly UserFlagDef[]` a `Interpretation` (`src/core/interpretation.ts`), con forma JSON pura:
  - `id`: identificador único del pozo (`[a-zA-Z0-9_-]{1,64}`).
  - `name`: nombre corto legible (1–64 caracteres, único sin distinguir mayúsculas/minúsculas dentro del pozo).
  - `color?`: color hex `#rrggbb` opcional para la franja en el visor.
  - `intervals`: lista ordenada y no solapada de intervalos cerrados en profundidad medida `{ top, base }` (en metros MD, `top <= base`) donde la bandera vale `1`.
  - `source?`: origen breve informativo (p. ej. «Lazo en el crossplot»).
- **Intervalos exactos (`gap = 0`):** al capturar una `PlotSelection`, los tramos se construyen con `maskToExactIntervals(depth, mask)` sobre bloques contiguos de `mask[i] === 1`, tomando `[depth[start], depth[last]]` sin unir huecos de una muestra ni ensanchar medio paso (`maskRuns` usa `gap = 1` y `±half`, lo que incluiría muestras no seleccionadas y podría salir de `[depth[0], depth[n-1]]`). Como `Well.depth.values` es estrictamente creciente, la evaluación `evaluateUserFlag(depth, flag)` devuelve un `Float64Array` de longitud `depth.length` con valores exactos `0`/`1` idénticos a la máscara seleccionada (I02).
- **Proyección derivada y caché por identidad:** las banderas de usuario se proyectan fuera de `Well.curves` mediante una capa pura cacheada por identidad (`withUserFlagCurves` y `withUserFlagCatalog`) como curvas con prefijo de rol `UFLAG_<id>`, `family: 'flag'`, `origin: 'computed'`, `unit: 'unitless'` y `moduleId: 'user-flags'`.
  - Aparecen de inmediato en el selector de filtros genéricos (`Banderas`, `filterCurveOptions` / `isFlagCurve`) con condición `Sí (= 1)` / `No (= 0)`.
  - Aparecen en «Armar pistas» (grupo «Banderas») y en la pista `collect: 'flags'` del visor y exportación de figuras.
  - No aparecen como curvas numéricas en ejes X/Y ni tendencias (`curveSeriesProvider.list` omite `family === 'flag'`).
- **Invariantes y rendimiento:**
  - `Well.curves` permanece intacto (I01) y no se alteran ni invalidan `inputRevisions`.
  - `sameEngineInputs` no incluye `userFlags`: crear o borrar una bandera de usuario no recalcula el motor petrofísico en el Web Worker.
  - Los snapshots clonan `Interpretation`, por lo que cada snapshot conserva sus banderas de usuario históricas (I08).
  - Compatibilidad: `userFlags` es opcional en archivos v6 y v7 (sin subir versión de archivo). Los proyectos previos sin `userFlags` abren sin avisos ni cambios; en v6 los elementos inválidos se descartan con aviso y en v7 se rechazan con validación estricta.

### 2. Exclusión de tramos en Preparación desde la selección

- **Curva medida objetivo:** se elige siempre una curva **original** de `entry.well.curves` (nunca una proyección preparada, I01/I02). Por defecto se sugiere la del eje Y del crossplot (o X si Y no es medida), la curva activa en histograma/distribuciones o la primera curva medida desde el visor. Si la clave de gráfico apunta a un rol con fuente medida o a una curva preparada existente, se resuelve a su curva original de entrada (`node.input.curveId`).
- **Intervalos exactos y límites:** se convierten las muestras seleccionadas mediante `maskToExactIntervals(depth, mask)` (`gap = 0`, extremos exactos dentro de `[depth[0], depth[n-1]]`), garantizando que cada tramo contiene al menos una muestra y no excluye muestras intermedias fuera de la selección. Si el total de intervalos nuevos más los existentes en la curva excede el límite de 256 intervalos de `Preparation`, el diálogo lo informa antes de confirmar y bloquea la operación sin modificar el estado.
- **Motivo obligatorio:** se agrega el campo opcional `reason?: string` (1–200 caracteres) a `MaskInterval` (`src/core/preparation/state.ts`) para registrar el motivo exigido al excluir desde una selección. Es opcional para conservar compatibilidad total con recetas y archivos v7 previos; `maskRanges` y `preparationStateKey` no cambian, `schemaVersion` sigue intacta y «Preparaciones guardadas» muestra el motivo junto a cada tramo.
- **Activación explícita de fuente (I04) y atomicidad (I12):** `addMaskIntervals` incorpora la opción `activateSource?: boolean` (por defecto `true` para preservar los llamadores existentes de Preparación). En el diálogo de G02, si el rol de la curva todavía no usa su curva preparada como fuente activa, la casilla «Usar la curva preparada como fuente activa de `<ROL>`» inicia **desmarcada** para exigir activación explícita: sin marcarla, la receta se guarda en `Preparation` (con migración a revisiones de entrada si faltaban) dejando intacta la fuente activa actual; al marcarla, se guardan receta y activación en un solo `commit` deshacible con un paso de `Ctrl+Z`.
- **Respeto a dependencias científicas (I05/I06/I07):** se preservan todas las validaciones de `addMaskIntervals` (rechazo si la curva tiene reconstrucción de densidad o MGT activo, si es predictor/caliper auxiliar de un nodo activo o si su revisión fijada quedó obsoleta).

## Alternativas descartadas

1. **Guardar la bandera como curva medida en `Well.curves`:** viola I01 (mezcla interpretaciones del usuario con mediciones originales), obliga a emitir nuevas `inputRevisions`, invalida vínculos de `Preparation` y duplica arrays binarios en el archivo del proyecto.
2. **Guardar `selection.runs` (`maskRuns` con `gap = 1` y `±half`):** ensancha extremos fuera de `[depth[0], depth[n-1]]` cuando se seleccionan los bordes del pozo y puentea huecos de una muestra, alterando silenciosamente qué muestras pertenecen a la bandera o se excluyen en QC.
3. **Activar automáticamente la curva preparada al excluir desde un gráfico:** contradice I04 (sustitución implícita de fuente) cuando el usuario aún está explorando o usando otro origen para ese rol.
4. **Serializar bitsets/arrays en `Interpretation`:** rompe el contrato JSON puro de `Interpretation` y engorda los snapshots innecesariamente.

## Límites científicos y qué no cubre

- Las banderas de usuario son anotaciones de filtrado y visualización: no alimentan automáticamente el motor petrofísico ni modifican cutoffs de reservorio/pay (I10).
- Una bandera guarda intervalos MD `[top, base]`: si un usuario reimporta un pozo con distinta grilla de muestreo, los intervalos se evalúan sobre la profundidad vigente sin mutar datos originales.
- En exclusiones muy fragmentadas (>256 tramos desconectados en una misma curva), el usuario debe acotar la selección o usar una bandera de usuario para filtrar gráficos sin sobrepasar el límite de `Preparation`.
