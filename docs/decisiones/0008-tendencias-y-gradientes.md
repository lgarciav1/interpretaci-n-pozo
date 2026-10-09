# 0008 — Tendencias y gradientes

- Estado: aceptada (fase 6b-1).
- Alcance: `src/core/trends.ts`, `src/core/state/trends.ts`, `src/core/canonical.ts`, `Interpretation.trends`,
  formato de proyecto v4, `src/plots/trend/` (series, ajuste, dibujo, superposición), `src/app/trends/` (estado del
  modo de edición, panel «Tendencias», proveedores de módulos), `ViewerSlot` y `dockPanels`.
- La matemática (`src/petro/regression.ts`, `src/petro/gradients.ts`) es de otro agente y se usa por sus firmas.

## Contexto

El profesor pide un módulo obligatorio: «trazar una línea de tendencia sobre cualquier curva del visualizador o sobre
cualquier gráfico, eligiendo el tramo o los puntos; ajuste lineal, logarítmico, exponencial o potencial, con ecuación
y R² a la vista y opción de dibujarla a mano; gradientes en las unidades que correspondan (psi/ft, °C/100 m, µs/ft por
metro). Sirve para presiones, temperatura y tendencias de compactación».

Lo heredan tres fases: 6b-2 (presiones MDT: gradientes por fluido con esta herramienta, densidad, contactos donde se
cruzan dos rectas, en una pista propia), 6b-3 (corona: modelo k–φ por regresión sobre un crossplot) y 7 (histograma y
crossplot libre: tendencias sobre cualquier gráfico). Por eso lo central no es «una línea en el visor», sino
**una tendencia como dato del pozo sobre una serie cualquiera**, con un dibujo que no dependa de los ejes.

## D1. La ecuación numérica se muestra (excepción deliberada)

La regla «las ecuaciones no se muestran en la interfaz; solo en el módulo Ecuaciones» es sobre las ecuaciones de los
**métodos** (Archie, Larionov…). La ecuación numérica de un ajuste (`DT = 152·e^(−0,00031·z)`, `y = 0,433·x + 14,7`)
es un **resultado** que el profesor pide ver junto con R²: se muestra en el visor, en el tooltip y en el panel. La
forma general de cada modelo (`y = a + b·x`…) sigue yendo solo al módulo Ecuaciones (`TREND_MODEL_DOCS`).

## D2. Una tendencia es parte de la interpretación del pozo

```ts
interface TrendSpec {
  id: string; name: string; color?: string; visible: boolean;
  series: SeriesRef;                       // { provider: 'curve', key: 'm:DT' } — qué datos
  model: 'linear' | 'log' | 'exp' | 'power';
  mode: 'fit' | 'manual';
  selection: { top?: number; base?: number; zoneId?: string; xMin?: number; xMax?: number; excluded: string[] };
  manual?: [{ x, y }, { x, y }];           // solo mode = 'manual'
  extend: boolean;                         // dibujar la extensión fuera del tramo, punteada
}
```

- Vive en `Interpretation.trends`: es una decisión de interpretación (como una zona o un parámetro), entra en
  snapshots y en deshacer/rehacer, y la usarán módulos (gradientes MDT, modelo k–φ).
- **No recalcula el motor.** La firma de cada módulo no incluye `trends`, así que aunque el motor corriera saldría
  todo de caché; además `engineBridge` compara con `sameEngineInputs` (zonas, parámetros, fuentes, comparar,
  desactivados por referencia) y ni siquiera manda el pedido cuando solo cambiaron las tendencias. El protocolo del
  worker no cambia (la interpretación es JSON; `trends` viaja como un campo más cuando sí hay que calcular).
- **Puntos excluidos por clave estable** (la profundidad redondeada a 0,1 mm para curvas, el id del punto para
  MDT o plugs), nunca por índice: sobreviven a recortes, re-muestreos y a reabrir el proyecto.
- `zoneId`: «usar zona como tramo». Mientras la zona exista, el tramo sigue a la zona (si se mueve un tope, la
  tendencia se reajusta sola); `top`/`base` guardan el último tramo como respaldo si la zona se borra.
- `xMin`/`xMax`: filtro por rango de la variable independiente (crossplots); la fase 6b-1 lo guarda y lo respeta
  en el ajuste, pero no tiene interfaz para elegirlo.
- Recetas puras en `src/core/state/trends.ts` (agregar, actualizar, borrar, duplicar, alternar un punto excluido),
  siempre por `commit` con etiqueta en español («Agregar tendencia», «Mover tramo de la tendencia»).
- **Formato v4.** Migración v3 → v4: `trends: []` en cada pozo y en cada snapshot. Al abrir, `sanitizeTrends`
  descarta con aviso lo inválido (modelo desconocido, tramo no numérico, manual sin dos puntos, ids repetidos), igual
  que `sanitizeDisplay`.

## D3. Series: un contrato y un registro de proveedores

Una tendencia no sabe de dónde salen sus datos; los pide por `SeriesRef { provider, key }` a un **proveedor**:

```ts
interface TrendSeriesProvider {
  id: string; label: string;
  list(ctx): SeriesOption[];                       // lo que se puede elegir en el panel
  resolve(ctx, key): ResolvedSeries | null;        // x, y, depth?, unidades, escalas, pointKey(i), ubicación en el visor
}
```

- `ctx` = pozo, interpretación y curvas calculadas activos + catálogo de roles (todo de solo lectura).
- `ResolvedSeries.xIsDepth`: si la variable independiente es la profundidad (m, creciente). Entonces la pendiente es
  un **gradiente** (`gradientReadings(dy/dz, unidad de y)`), el tramo se busca por bisección y el visor la dibuja.
- `ResolvedSeries.placement`: dónde se dibuja en el visor (`{ roleOrKey }` = la pista que tenga esa curva;
  `{ overlayId }` = la pista propia de una superposición, p. ej. presiones MDT).
- Proveedor incorporado `curve` (`src/plots/trend/series.ts`): toda curva del visor. Claves `m:<curveId>` (medida, en
  la unidad canónica de su rol, con la misma conversión en caché que usa el visor: `src/core/canonical.ts`) y
  `r:<ROL>` (la fuente activa de ese rol: la calculada si hay; sigue al método elegido). x = profundidad, y = valor.
- **Módulos nuevos agregan proveedores sin tocar el núcleo**: `src/modules/<id>/series.ts` que exporte
  `seriesProviders: TrendSeriesProvider[]` (descubierto por `src/app/trends/providers.ts`, como paneles y
  superposiciones). MDT: `provider: 'mdt'`, x = profundidad, y = presión, `placement: { overlayId: 'mdt' }`, claves de
  punto = id de cada medición. Crossplot: `provider: 'crossplot'`, x = curva A, y = curva B, `xIsDepth: false`,
  `depth` para filtrar por tramo o zona.
- Una referencia a un proveedor o una clave que no existen no rompe nada: la tendencia queda «sin datos» en el panel.

## D4. Ajuste en vivo: O(n) por cuadro, sin asignaciones

`evaluateTrend(spec, series, zones, preview?)` (`src/plots/trend/compute.ts`) resuelve el tramo a índices (bisección
si `xIsDepth`; si no, filtro por profundidad y rango de x), traduce los puntos excluidos a un `Set<number>` una vez por
lista (caché por identidad de la lista y de la serie) y llama a `fitTrend` (O(n), sin asignaciones). Devuelve
coeficientes, R², n, descartados, rango ajustado y la pendiente: en el modelo lineal, la pendiente; en los otros, la
pendiente **en el centro del tramo**, rotulada así. El resultado de una tendencia sin cambios se recuerda (caché por
identidad del spec y de la serie): redibujar el visor no reajusta.

Mano alzada: `trendThroughPoints(modelo, p1, p2)`; R² se muestra «—» (una recta trazada a mano no es un ajuste y su
«R²» contra los datos puede ser negativo y confundir). n y los gradientes sí se muestran.

## D5. Dibujo independiente de los ejes

`src/plots/trend/draw.ts` recibe la tendencia y **dos mapeos dato→px** (`x`, `y`) más `transpose` (en el visor la
variable independiente, la profundidad, va vertical y el valor horizontal con la escala lineal o log de la pista; en
un crossplot es al revés). Así sirve igual para el visor, el crossplot y el histograma.

- **Muestreo adaptativo en píxeles**: subdivide el intervalo hasta que el punto medio quede a < 0,35 px de la cuerda.
  Una recta en una pista logarítmica no es recta y se dibuja curva; una lineal en ejes lineales son 2 puntos.
  Se recorta al rango visible antes de muestrear (zoom profundo sobre una tendencia larga no cuesta más) y los
  valores fuera de dominio (ln de x ≤ 0, log de y ≤ 0) cortan el trazo en vez de unir con basura.
- Tramo ajustado sólido (con halo del color de fondo), extensión punteada, manijas en los extremos (en el ajuste,
  sobre la curva a la profundidad del tope y la base; a mano, los dos puntos), etiqueta compacta con ecuación, R² y
  gradiente primario.
- La geometría (`trendGeometry`) es pura y testeada; `drawTrend` solo hace las llamadas al canvas.

## D6. Superposición del visor: pura, compuesta en `ViewerSlot`

`createTrendsOverlays(opts)` (`src/plots/trend/overlay.ts`) devuelve dos superposiciones (`trends-bands`, debajo, y
`trends`, encima) del contrato `ViewerOverlay`. No importa stores: lee las tendencias de `frame.data.interpretation`
y recibe por `opts` el estado del modo de edición, la resolución de series y cómo guardar (como `createZonesOverlay`).
`ViewerSlot` la compone con las incorporadas y le pasa un store de interfaz (`src/app/trends/store.ts`: herramienta
activa, tendencia seleccionada, última curva clicada) y `commit`.

Se descartó ponerla en `src/modules/trends/overlay.ts`: no es un módulo del motor (no calcula curvas ni puertos) y
necesitaría importar stores de la app para su modo de edición, o un registro de módulos con estado.

Interacción:
- **Elegir tramo** (botón «Tendencia» en la barra del visor o «Nueva tendencia» en el panel): en ese modo `hit`
  devuelve un `drag` en cualquier punto de una pista con curvas. La curva es la más cercana al puntero dentro de la
  pista donde se apretó. Durante el arrastre: banda, ajuste y ecuación en vivo (vista previa local +
  `frame.invalidate()`); al soltar, **un solo `commit`** («Agregar tendencia» o «Mover tramo de la tendencia»).
  Escape cancela el arrastre; otro Escape sale del modo.
- **Dibujar a mano**: mismo modo con `mode: 'manual'`; se arrastra de un punto a otro sobre la pista.
- **Manijas**: tope y base del tramo (ajuste) o los dos puntos (a mano) se arrastran (`ns-resize` / `move`), quedan
  activos para ↑/↓ (`nudge`) y son `targets` del teclado (Tab).
- **Excluir puntos**: con una tendencia seleccionada, clic sobre una muestra del tramo (a menos de 6 px de la curva)
  la excluye o la vuelve a incluir; las excluidas se marcan con ×. Con zoom suficiente se ven las muestras.
- **Tooltip** con ecuación, R², n y gradientes; clic sobre la línea la selecciona; doble clic muestra el tramo.

## D7. Panel «Tendencias»

Una entrada en `DOCK_PANELS`. Lista de las tendencias del pozo activo: color, nombre editable, visible, curva,
modelo (4 opciones, lineal por defecto), mano alzada o ajuste; ecuación, R², n, descartados y gradientes en
unidades de campo (rotulados «en el centro del tramo» si el modelo no es lineal). Acciones: nueva, dibujar a mano,
usar zona como tramo, extender, duplicar, borrar, ver el tramo. Estado vacío que dice qué hacer. Todo por `commit`.

## Alternativas descartadas

- **Tendencias en el store de la interfaz o en `display`.** No entrarían en snapshots y MDT/k–φ no podrían
  consumirlas como decisión del pozo.
- **Tendencia como módulo del motor (salida escalar con la ecuación).** Haría pasar cada arrastre por el worker
  (latencia de ida y vuelta por cuadro) y forzaría parámetros escalares para tramos y puntos excluidos. El ajuste es
  O(n) y corre en el hilo principal en < 1 ms con 50 000 muestras.
- **Puntos excluidos por índice.** Se rompen al recortar o re-muestrear el pozo y no sirven para series sin orden.
- **Dibujar la recta con dos puntos en px.** Falla en pistas logarítmicas y en modelos no lineales.
- **Proveedores de series registrados a mano en el núcleo.** Viola «un módulo = una carpeta»; se descubren solos.
