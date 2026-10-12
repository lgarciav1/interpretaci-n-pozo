# src/plots

Gráficos fuera del visor (histograma y crossplot libre, fase 7a) y herramientas que se dibujan sobre cualquier gráfico.
Igual que el visor: datos del proyecto + resultados del motor; lo que el usuario elige sobre un gráfico se escribe con
recetas puras de `src/core/state/` por `commit`. Sin React en los `.ts` de esta carpeta.

## `trend/` — líneas de tendencia y gradientes

Decisión: [`docs/decisiones/0008-tendencias-y-gradientes.md`](../../docs/decisiones/0008-tendencias-y-gradientes.md).

| Archivo | Qué hace |
|---|---|
| `series.ts` | contrato `TrendSeriesProvider` / `ResolvedSeries`, `createSeriesRegistry`, proveedor incorporado `curve` |
| `compute.ts` | `evaluateTrend(spec, serie, zonas, vistaPrevia?)`: tramo → índices, excluidos, ajuste o mano alzada, pendiente y gradientes |
| `draw.ts` | geometría independiente de los ejes (`trendGeometry`, muestreo adaptativo en px) y dibujo en canvas |
| `format.ts` | ecuación, R², gradientes, etiqueta del visor y tooltip (coma decimal) |
| `overlay.ts` | `createTrendsOverlays(opts)`: superposiciones del visor (sin stores; las compone `ViewerSlot`) |

Tests: `tests/plots/` (series y ajuste, geometría, interacción con `PointerGestures`).

## `xy/` — gráfico x–y base

Decisión: [`docs/decisiones/0010-datos-de-corona.md`](../../docs/decisiones/0010-datos-de-corona.md) (D6). Gráfico de
dispersión genérico en canvas: ejes lineales o logarítmicos en cada eje, grilla y rótulos con unidad, capas de puntos,
líneas, guías y tendencias. Lo usan el crossplot k–φ de la corona y, desde la fase 7a, el histograma y el crossplot libre. No
sabe nada de plugs ni de curvas.

| Archivo | Qué hace |
|---|---|
| `axes.ts` | puro: `XYAxis`, `axisFraction` / `fractionValue` (dato ↔ fracción, lineal, log e invertido), `xyMapping` (dato ↔ px), `axisTicks` (1-2-5 o décadas), `niceRange`, `plotRectFor`, `nearestPoint`, `dataRectFromPx`, `pointsInRect` |
| `draw.ts` | canvas sin React: `drawFrame` (marco, grilla, rótulos, títulos), `drawPoint`, `drawDataLine`, `drawXYTrend` (capa de tendencias de `trend/`) y `drawXYScene` (todo lo que se ve, sin lo interactivo; lo usan `XYPlot` y las figuras) |
| `layers.ts` | tipos de capa (`XYPointLayer`, `XYLineLayer`, `XYTrendLayer`, `XYGuide`), con `name` opcional para la leyenda |
| `figure.ts`, `figures.ts` | figura de publicación (título, leyenda con ecuación y R², barra de color, créditos) y registro de los gráficos exportables |
| `XYPlot.tsx` | componente: capas, tooltip, clic, selección por rectángulo y teclado |
| `pick.ts` | puro: grilla de búsqueda del punto bajo el puntero (`buildPointGrid`, `gridNearest`) para nubes de decenas de miles de puntos |
| `xy.css` | estilos del contenedor, del tooltip y de la manija de las guías arrastrables |

Tests: `tests/plots/xy-geometry.test.ts`, `tests/plots/xy-interaction.test.ts`.

### Uso

```tsx
import { XYPlot } from '../../plots/xy/XYPlot';

<XYPlot
  x={{ kind: 'linear', min: 0, max: 0.3, label: 'Porosidad φ', unit: 'v/v' }}
  y={{ kind: 'log', min: 0.01, max: 10000, label: 'Permeabilidad k', unit: 'mD' }}
  points={[{ id: 'plugs', x: phi, y: k, color: '#a21caf', interactive: true, label: (i) => ids[i]! }]}
  trends={[{ id: 't1', coeffs, span: [0.06, 0.21], color: '#1d4ed8', extend: true, label: ['k = 0,02·e^(50,2·φ)', 'R² 0,95'] }]}
  height={260}
  ariaLabel="Crossplot k–φ"
  onPointClick={(layerId, i) => …}
  onSelectRect={(r) => …}
/>
```

- **Ejes** (`x`, `y`: `XYAxis { kind: 'linear' | 'log', min, max, label, unit?, reversed? }`): `max > min` y, en log,
  `min > 0`; un eje inválido no dibuja el gráfico; `emptyText` se muestra si ninguna capa tiene datos. `niceRange(series, kind, { pad?, zero? })` da un
  rango «lindo» (lineal: múltiplos de un paso 1-2-5; log: décadas enteras). `reversed` pone el mayor a la izquierda o
  abajo (profundidad, escalas de densidad). Los valores ≤ 0 en un eje log, y los NaN, no se ubican (no se dibujan); los
  que caen fuera del rango salen del área y el dibujo los recorta.
- **Escalas y mapeo**: `xyMapping(xAxis, yAxis, rect)` devuelve `x(v)`, `y(v)` (y crece hacia arriba) y las inversas
  `xInv`, `yInv`; es la misma función que usan la grilla, los puntos y las tendencias. `plotRectFor(ancho, alto,
  compact?, ui?)` reserva el lugar de los rótulos y los títulos.
- **Tamaño de interfaz** (docs/decisiones/0013): `XYPlot` pasa el factor (`ui`) a `plotRectFor` y `drawXYScene`, que
  agrandan rótulos, títulos, márgenes y la etiqueta de tendencias (no los puntos). `height` es px de Compacto. La figura
  exportada llama sin factor (1): sale igual con cualquier nivel.
- **Capas**: `points` (`XYPointLayer`: `color` fijo o por punto —color por una tercera curva o por capa—, `variant`
  lleno/vacío/tachado, `cloud` para una nube tenue de miles de puntos no interactiva, `dense` para una nube de decenas
  de miles de puntos dibujada en lotes por color —puede ser interactiva—, `interactive` y `label` para el tooltip y el
  teclado), `bars` (`XYBarLayer`: clases de un histograma, relleno tenue y contorno escalonado), `lines` (`XYLineLayer`:
  cortan en los NaN; `y2` las mide contra el eje derecho; `label`/`labelAt` las rotulan en un extremo visible),
  `guides` (`XYGuide`: línea vertical u horizontal con rótulo de dos renglones; con `id` y `draggable`, arrastrable) y
  `trends`.
- **Eje derecho** (`y2`): para la acumulada del histograma; `plotRectFor(…, rightAxis)` le reserva el margen.
- **Guías arrastrables** (cutoffs, GR limpio/arcilla): `onGuideChange(id, valor, 'preview' | 'commit' | 'cancel')` al
  arrastrar la línea o su manija (un `role="slider"`: Tab, flechas —1 % del eje o `step`—, Mayús ×10, Supr =
  `onGuideRemove` salvo `removable: false`). Las flechas mandan solo `'commit'`. El valor se redondea a un paso 1-2-5 de
  1/400 del eje (3 cifras en log). La guía se ve en su nueva posición durante el arrastre aunque el dueño todavía no la
  haya guardado.
- **Manijas 2D** (`handles: XYHandle[]`, fase 7b): punto con forma (círculo, rombo, cuadrado), rótulo visible de dos
  renglones (`label`, `detail`, lado preferido `labelAt`), nombre accesible y `valueText`, y opcionalmente una
  polilínea `grabPath` por la que también se agarra (trasladar una recta). `onHandleChange(id, {x, y}, fase)` da la
  posición nueva en datos (`movePointPx`: conserva el desplazamiento puntero–manija y no sale del área);
  `onHandleNudge(id, dx, dy, mayús)` las flechas en dirección de pantalla. `disabled` = visible pero quieta. El dueño
  vuelve a ubicar la manija (redondeada al paso del parámetro). No salen en las figuras exportadas.
- **Conexión con otros paneles**: `onPointHover`/`onPointLeave`, `onBarHover(clase)` + `barLabel(clase)` (tooltip de la
  clase), `highlight` (punto resaltado desde afuera: el cursor del visor) y `selection` (rectángulo vigente). Todo lo
  interactivo va en un segundo canvas: mover el puntero no redibuja la escena.
- `height` en px de Compacto o `'fill'` (ocupa el alto del contenedor: paneles del dock).
- Las capas que no se pasan son listas vacías **constantes**: pasar un `[]` nuevo en cada render redibuja toda la escena.
- **Capa de tendencias** (`XYTrendLayer { id, coeffs, span, color, extend?, label?, emphasis? }`): se dibuja con
  `trendGeometry` de `trend/` con `transpose: false` y los dos mapeos del gráfico, así que una recta en un eje log se ve
  curva y la extensión punteada llega a los bordes. `coeffs` y `span` salen de `evaluateTrend` sobre una serie
  `xIsDepth: false` (ver arriba, «Crossplot»); la etiqueta de dos líneas (ecuación y R²) se construye con
  `trendEquation` y `formatR2` de `trend/format.ts`.
- **Interacción**: tooltip al pasar sobre un punto interactivo, `onPointClick(capa, índice)`, `onSelectRect(DataRect)`
  al arrastrar un rectángulo (en datos; con ejes log e invertidos; `pointsInRect` da los índices adentro) y teclado
  (←/→ recorren los puntos en orden de x, Enter = clic, Esc suelta). Sin `onSelectRect` arrastrar no hace nada.
- Para dibujar fuera de React (otro canvas, exportar a imagen) se usan `axes.ts` y `draw.ts` directamente.

### Exportar como figura (fase 6c-2)

Además de las capas, la figura toma `bars`, `y2` y `colorKey` (barra de color de la tercera curva, `XYColorKey`).

Decisión: [`docs/decisiones/0012-exportacion-de-figuras.md`](../../docs/decisiones/0012-exportacion-de-figuras.md). Pasando
`figureId` y `figureTitle` a `<XYPlot>`, el gráfico se publica en `figures.ts` mientras está montado y aparece en
«Exportar → Figuras → Crossplot con leyenda» (PNG, SVG, PDF) tal como se ve; no hay que tocar el diálogo. Para que la
leyenda lo nombre, dar `name` a las capas (`points`, `lines`, `trends`). `drawXYFigure` agrega título, leyenda (series,
tendencias con ecuación y R², barra de color opcional `XYColorKey`) y créditos; siempre con tema claro.

```tsx
<XYPlot figureId="crossplot-libre" figureTitle="Crossplot libre" points={[{ id: 'p', name: 'Perfil', … }]} … />
```

### Agregar un proveedor de series (MDT, crossplot, plugs de corona…)

Una carpeta de módulo, sin tocar el núcleo: `src/modules/<id>/series.ts` (la app lo descubre sola,
`src/app/trends/providers.ts`; el worker no lo importa).

```ts
import type { TrendSeriesProvider } from '../../plots/trend/series';

export const seriesProviders: TrendSeriesProvider[] = [{
  id: 'mdt',                                    // va en SeriesRef.provider y se guarda: no cambiarlo
  label: 'Presiones MDT',
  list: (ctx) => [{ key: 'todas', label: 'Presiones MDT', group: 'MDT', unit: 'psi' }],
  resolve(ctx, key) {
    const pts = puntosMdt(ctx.interpretation, key);           // de donde los guarde el módulo
    if (!pts) return null;                                    // clave que ya no existe → «sin datos», no rompe
    return {
      ref: { provider: 'mdt', key }, label: 'P',
      x: pts.depth, y: pts.psi, depth: pts.depth,             // x = profundidad (m, creciente)
      xUnit: 'm', yUnit: 'psi', xScale: 'linear', yScale: 'linear',
      xIsDepth: true,                                         // pendiente = gradiente (psi/ft, densidad equivalente)
      pointKey: (i) => pts.ids[i]!,                           // clave estable para excluir un punto
      indexOfKey: (k) => pts.ids.indexOf(k),
      placement: { overlayId: 'mdt' },                        // se dibuja en la pista propia de la superposición 'mdt'
    };
  },
}];
```

- **Serie en profundidad** (`xIsDepth: true`): el visor la dibuja (en la pista que tenga la curva `roleOrKey` o en la
  pista propia `overlayId`), el tramo se busca por bisección y la pendiente se informa como gradiente en unidades de
  campo (`gradientReadings`: psi/ft y g/cm³ para presión, °C/100 m para temperatura, µs/ft por m para DT).
- **Crossplot** (`xIsDepth: false`, p. ej. k vs. φ de plugs): `x` e `y` son las dos variables y `depth` permite
  filtrar por tramo o zona. El visor no la dibuja; el crossplot usa `trendGeometry` con sus dos ejes
  (`transpose: false`) y `evaluateTrend` igual que el visor. `selection.xMin`/`xMax` limitan el ajuste en x.
- Para crear una tendencia sobre una serie que no es una curva del visor, el módulo arranca la herramienta con esa
  serie: `startTrendTool({ kind: 'fit', series: { ref, label, name, color, extend, hint } })` (el arrastre vale en
  cualquier pista y la tendencia nace con ese nombre y color; «Nuevo gradiente» del panel MDT), o la agrega ya hecha
  con `addTrend` (`src/core/state/trends.ts`; ejemplo MDT).
- Opciones de la serie para pistas angostas: `canvasLabel: 'gradient'` (etiqueta de una línea al costado del medio
  del tramo: «0,453 psi/ft · 1,04 g/cm³») y `pickSamples: false` (los puntos los maneja el módulo: el visor no ofrece
  excluirlos con un clic).
- Pista propia en otra unidad que la serie (presión en psi, pista en bar): la capa convierte sola con `track.unit`.
- Contactos: `intersectTrends` (`src/petro/regression.ts`) entre dos tendencias de presión (MDT: `findContacts` en
  `src/modules/mdt/model.ts`).

## Histograma y crossplot libre (fase 7a)

Decisión: [`docs/decisiones/0014-histograma-y-crossplot.md`](../../docs/decisiones/0014-histograma-y-crossplot.md).
Pestañas del dock «Histograma» y «Crossplot», aportadas por `src/modules/histogram/dock.tsx` y
`src/modules/crossplot/dock.tsx` (delgados: conectan los stores con `src/app/plots/connect.tsx`). Los paneles de acá
son de presentación: reciben el contexto del pozo, la configuración y callbacks.

| Archivo | Qué hace |
|---|---|
| `data.ts` | puro: curvas por clave `m:`/`r:` en unidad canónica con la escala de su rol (`resolvePlotCurve`, `plotCurveOptions`, `keyForRole`), filtro por zonas (`zoneFilter`), tramos de profundidad de un conjunto de muestras (`depthRuns`), muestra más cercana |
| `cutoffs.ts` | puro: rol → parámetro del módulo de cutoffs (`cutoffParamFor`), alcance global o de una zona (`cutoffScope`), valor efectivo (`sharedParamValue`), redondeo al paso (`normalizeCutoff`), línea real o libre (`resolveCutoffLine`) |
| `params.ts` | puro (fase 7b): parámetros que se eligen sobre un gráfico (`PLOT_PARAMS`: clave de almacenamiento, `módulo.clave` si no es compartido), alcance (`plotScope`), valor efectivo (`plotParamValue`), acotar y redondear como el slider (`normalizeParam`, `nudgeParam`), escrituras (`paramWrite`), fuente activa (`inactiveDriver`) y líneas de GR limpio/arcilla (`grGuides`, `grWrite`) |
| `link.ts` | pub/sub sin React de lo que se señala en un gráfico (profundidad, tramos de una clase) y de la SELECCIÓN única compartida (máscara de muestras; fase 8b, 0021); lo dibuja la superposición `plot-link` del módulo `crossplot`, que también marca el tramo con Mayús + arrastre |
| `selection.ts`, `useLink.ts` | puro (8b): lazo (punto en polígono en fracciones de eje), tramo del visor → muestras, clases → muestras, máscara → tramos y → puntos de una nube; `usePlotSelection` para leerla desde React |
| `controls.tsx`, `plots.css` | controles compartidos (curva, escala, filtro de zonas, grupos) y el armado del panel (controles · gráfico · panel aparte) |
| `histogram/histogram.ts` | puro: Freedman–Diaconis/Sturges, bordes lineales o log, conteo, %, acumulada, rango robusto, estadísticos (n, media —geométrica en log—, P10/P50/P90), reparto a cada lado de un cutoff |
| `histogram/HistogramPanel.tsx` | panel: curva, escala, clases, zonas superpuestas, normalizar, acumulada, cutoff, estadísticos |
| `crossplot/crossplot.ts` | puro: muestras graficables, rango robusto, nivel de color de la rampa, mediana sobre índices |
| `crossplot/templates.ts` | puro: líneas de las plantillas (densidad–neutrón, Pickett, φ–Sw, GR–Rt) y su definición |
| `crossplot/drag.ts` | puro (fase 7b): punto de matriz ↔ (ρma, offset del neutrón), línea de la matriz del proyecto, imán a las litologías, recta de agua ↔ (Rw, m) al trasladar o rotar, ubicación de sus manijas, Rw entre temperatura de referencia y de formación (Arps, como el motor) |
| `crossplot/pickett.ts` | puro (8b, 0021): ajuste de la recta de agua a la zona acuífera (`fitWaterLine`), valores propios por zona, una recta por zona, escrituras del arrastre con su alcance |
| `crossplot/series.ts` | proveedor de series `crossplot` (tendencias sobre la nube; clave `<x>\|<y>\|<zonas>`), registrado por `src/modules/crossplot/series.ts` |
| `crossplot/CrossplotPanel.tsx` | panel: ejes, color, zonas, plantilla, cutoffs X/Y, tendencias, leyenda, cuadrantes, selección |

Tests: `tests/plots/histogram.test.ts`, `tests/plots/crossplot.test.ts`, `tests/plots-state.test.ts`,
`tests/plots/params-drag.test.ts`.

La configuración de cada gráfico se guarda en el proyecto (`display.plots[pozo]`, `src/core/plots.ts`) con las
recetas de `src/core/state/plots.ts` (`updatePlotConfig`, `setPlotCutoff`): entra en deshacer y viaja con el archivo.

## Parámetros elegidos sobre los gráficos (fase 7b)

Decisión: [`docs/decisiones/0015-parametros-sobre-graficos.md`](../../docs/decisiones/0015-parametros-sobre-graficos.md).

| Gráfico | Elemento | Parámetro |
|---|---|---|
| Histograma de GR (y plantilla GR–Rt) | líneas de GR limpio y de arcilla | `grClean`, `grShale` |
| Densidad–neutrón | punto de matriz (rombo) y la línea que sale de él | `phi-density.rhoMa`, `phi-neutron.matrixOffset` (offset = −NPHI de la matriz) |
| Pickett | recta de agua: trasladar (círculo o la recta) / rotar (cuadrado) | `rw-manual.rwRef` (Rw a `tRef`, convertida desde la Rw de formación a la mediana de TEMP de los puntos visibles) / `m` |

- Mismo alcance, vista previa y deshacer que los cutoffs reales: una zona filtrada → valor de la zona; si no, global.
  Cada movimiento escribe con `commitPlotParams(etiqueta, escrituras, fase)` (`src/app/plots/connect.tsx`) y recalcula
  en vivo; el arrastre entero es **un** Ctrl+Z (gesto: `commit(…, { group })`); Escape vuelve a antes del gesto.
- Si el módulo que usa el parámetro no alimenta la cadena (`inactiveDriver` sobre `result.sources`), la manija queda
  quieta y el panel muestra un aviso con la acción («Usar Rw manual»).
- Para agregar otro: la ida y la vuelta puras en un `.ts` (con test), un `PlotParam` en `PLOT_PARAMS`, y una `XYGuide`
  arrastrable o un `XYHandle` en el panel que convierta la posición en `ParamWrite[]`.
