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
