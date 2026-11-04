# 0066 — Distribuciones por zona (boxplots comparados)

- Estado: propuesta (rama `claude/distribuciones-por-zona`, V1).
- Alcance: pestaña «Distribuciones» del dock (`src/modules/zone-distribution/`), dibujo y armado puro
  (`src/plots/distribution/`), configuración guardada (`src/core/plots.ts`, tipo `distribution`), acceso desde el panel
  del Sumario y la paleta, ícono `boxplot` del sistema de diseño.
- Parte de: 0007 (sumario por zona), 0014 (gráficos del dock y su configuración), 0026 (comparación de snapshots),
  0012 (figuras exportables). Motor: `src/petro/distribution.ts` (ya hecho y testeado; no cambia).

## Contexto

El sumario por zona da un número por zona (media). Para decidir si una zona es homogénea, si un cambio de parámetros
movió toda la distribución o solo la media, o cómo se compara con otro pozo, hace falta ver la dispersión. Inspirado en
el resumen de zonas de wellerlogs.com, pero integrado: mismas curvas que el histograma, mismos colores de zona que el
visor, comparación con snapshots y pozos del proyecto, y el visor va a la zona con un clic.

## D1. Qué se dibuja

Una fila por zona en orden de profundidad, con la franja del color de la zona; dentro, un carril por serie. Caja
P25–P75, línea de mediana (trazo grueso que sobresale), bigotes P10–P90 con remate y la media como rombo hueco (se
distingue de la mediana aunque coincidan). Con una sola serie las cajas toman el color de la zona (trazo con contraste
asegurado sobre el fondo, relleno con el color original); con varias, el color de cada serie. Eje compartido arriba,
pegajoso al desplazar, con la unidad; los ticks son los del gráfico x–y (`axisTicks`), así la grilla de cada fila
coincide con el eje.

## D2. Estadística: la del motor, coherente con el sumario

`intervalDistribution` sobre los tramos de muestras de cada zona (`layoutZones`, la misma regla que el motor). La media
y la escala salen de `suggestDistributionStat` por rol: Sw ponderada por volumen poral, φ/Vsh por espesor, k media
geométrica en eje log. Si para Sw falta φe, se usa la media por espesor y se avisa en el control. Percentiles
ponderados por espesor (Hazen con pesos iguales). Sin dato → «sin dato», nunca 0.

## D3. Filtro de muestras y opciones que el motor rechazaría

Toda la zona / reservorio neto / pay neto (`NET_RES`, `NET_PAY` activos), «Solo zonas de reservorio» (`kind`) y
«Excluir derrumbe» (`IND_WASHOUT`, activado por defecto). Si falta la bandera o el indicador, la opción queda
deshabilitada y el filtro efectivo cae a «toda la zona»; el panel nunca llama al motor con una entrada faltante. Si una
serie comparada no tiene las banderas, su celda dice «sin banderas netas» en vez de tirar.

## D4. Series: actual, snapshots y otros pozos

- «Actual»: el contexto de series del pozo activo (`usePlotContext`, el mismo del histograma).
- Snapshots del pozo activo: el pedido de `snapshotRunRequest` en el motor de comparación (`snapshotRunner`, 0026):
  mismo worker, misma caché; elegir el mismo snapshot en el diálogo de Snapshots o en la cortina no recalcula. Spinner
  en el chip mientras calcula.
- Otros pozos del proyecto: la interpretación actual de ese pozo, con el mismo `IsolatedRunner` y una clave
  `well:<id>` (`entryPreparationPlan` + `toEngineWell`, como un snapshot). No hizo falta tocar el núcleo. Zonas
  emparejadas por nombre (sin mayúsculas, acentos ni espacios de más); una zona que no está dice «la zona no está».
  La propiedad `m:<curva>` se traduce por rol o mnemónico; `r:<ROL>` vale igual. Borde punteado para distinguirlos.

Solo se calculan las series elegidas, y solo mientras la pestaña está a la vista (`PlotDockGate`).

## D5. Avisos concretos, no un cartel

Debajo del nombre de cada zona: n y espesor usado, % del espesor filtrado excluido por derrumbe y % sin dato (en tono
de advertencia desde 20 %). El tooltip repite eso por serie con P10/P50/P90 y la media (y la geométrica para k). Un
único aviso arriba si la interpretación no tiene ningún parámetro elegido (`params` vacío: todo por defecto); es la
única señal limpia disponible, se descarta avisar por parámetro.

## D6. Interacción

Leyenda de zonas clicable (oculta/muestra; se guarda). Clic en una fila o en el nombre de la zona →
`useTrendsUi.requestRange(tope, base)`. Pasar sobre una fila marca la zona en el visor (`setPlotLink({ hoverRuns })`).

## D7. Exportar

- CSV de estadísticas (zona, serie, propiedad, filtro, derrumbe, media usada, n, espesor, P10…P90, media, geométrica,
  excluido, sin dato, observación) y CSV de topes (zona, tope, base, espesor, tipo). Coma como separador y punto
  decimal, como los demás exportadores; números a 10 cifras significativas para no arrastrar el ruido de coma flotante.
- PNG/SVG/PDF: la vista se registra con `registerXYFigure` y dibujo propio (`plot`), así aparece en Exportar → Figuras
  («Crossplot con leyenda») con título, leyenda de series y del glifo, y créditos.

## D8. Celular primero

Consultas de contenedor (en em: siguen al tamaño de interfaz). Angosto: controles arriba, nombre y avisos de la zona
arriba de su fila, todo a lo ancho; desde 30em los nombres pasan a una columna a la izquierda; desde 34em los controles
en dos columnas; desde 44em los controles van a una columna lateral. Canvas por fila con `useCanvas` (devicePixelRatio,
tema y tamaño de interfaz). Verificado a 390 px sin desborde horizontal.

## D9. Configuración guardada

`WellPlots.distribution` (`DistributionConfig`): propiedad, filtro, «solo reservorio», «excluir derrumbe», series
elegidas y zonas ocultas; saneamiento en `sanitizeDistribution`. `PlotConfigOf<K>` y `defaultPlotConfig(kind)`
reemplazan el condicional de dos tipos que había en `state/plots.ts` y `connect.tsx`.

## Qué se reusa

Motor de distribuciones, `plotCurveOptions`/`resolvePlotCurve`, `plotContextOf`, `computedCurves`, `snapshotRunner`,
`axisTicks`/`niceRange`/`axisFraction`, `registerXYFigure`, `useCanvas`, `csvCell`/`numText`, `downloadFile`,
`ControlGroup`/`CurveSelect`, `Chip`, `SegmentedControl`, `Checkbox`, `Callout`, el tooltip de `xy.css`.

## Queda para V2

- Cutoff arrastrable sobre el eje (escribiendo el parámetro real, como el histograma).
- Plugs de corona como serie.
- Selección cruzada con el visor (marcar un tramo y ver su caja; resaltar en la fila las muestras seleccionadas).
- Histogramas apilados (violines) por zona.
- Barra P90/P50/P10 del volumen (incertidumbre) en la misma vista.
- Separar visualmente los carriles por serie con su nombre al costado cuando hay ancho.
