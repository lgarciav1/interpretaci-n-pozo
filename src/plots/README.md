# src/plots

Gráficos fuera del visor (histogramas y crossplots, fase 7) y herramientas que se dibujan sobre cualquier gráfico.
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
líneas, guías y tendencias. Lo usa el crossplot k–φ de la corona; la fase 7 (crossplot libre, histograma) lo hereda. No
sabe nada de plugs ni de curvas.

| Archivo | Qué hace |
|---|---|
| `axes.ts` | puro: `XYAxis`, `axisFraction` / `fractionValue` (dato ↔ fracción, lineal, log e invertido), `xyMapping` (dato ↔ px), `axisTicks` (1-2-5 o décadas), `niceRange`, `plotRectFor`, `nearestPoint`, `dataRectFromPx`, `pointsInRect` |
| `draw.ts` | canvas sin React: `drawFrame` (marco, grilla, rótulos, títulos), `drawPoint`, `drawDataLine`, `drawXYTrend` (capa de tendencias de `trend/`) |
| `XYPlot.tsx` | componente: capas, tooltip, clic, selección por rectángulo y teclado |
| `xy.css` | estilos del contenedor y del tooltip |

Tests: `tests/plots/xy-geometry.test.ts`.

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
  compact?)` reserva el lugar de los rótulos y los títulos.
- **Capas**: `points` (`XYPointLayer`: `color` fijo o por punto —color por una tercera curva o por capa—, `variant`
  lleno/vacío/tachado, `cloud` para una nube tenue de miles de puntos no interactiva, `interactive` y `label` para el
  tooltip y el teclado), `lines` (`XYLineLayer`: cortan en los NaN), `guides` (`XYGuide`: línea vertical u horizontal con
  rótulo; los cutoffs de la fase 7) y `trends`.
- **Capa de tendencias** (`XYTrendLayer { id, coeffs, span, color, extend?, label?, emphasis? }`): se dibuja con
  `trendGeometry` de `trend/` con `transpose: false` y los dos mapeos del gráfico, así que una recta en un eje log se ve
  curva y la extensión punteada llega a los bordes. `coeffs` y `span` salen de `evaluateTrend` sobre una serie
  `xIsDepth: false` (ver arriba, «Crossplot»); la etiqueta de dos líneas (ecuación y R²) se construye con
  `trendEquation` y `formatR2` de `trend/format.ts`.
- **Interacción**: tooltip al pasar sobre un punto interactivo, `onPointClick(capa, índice)`, `onSelectRect(DataRect)`
  al arrastrar un rectángulo (en datos; con ejes log e invertidos; `pointsInRect` da los índices adentro) y teclado
  (←/→ recorren los puntos en orden de x, Enter = clic, Esc suelta). Sin `onSelectRect` arrastrar no hace nada.
- Para dibujar fuera de React (otro canvas, exportar a imagen) se usan `axes.ts` y `draw.ts` directamente.

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
