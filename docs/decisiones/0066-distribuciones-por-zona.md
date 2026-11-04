# 0066 — Distribuciones por zona (boxplots comparados)

- Estado: V1 mergeada; V2 (cutoff sobre el eje y selección por rango, D10–D14) en `claude/distribuciones-v2`.
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
«Excluir derrumbe» (`IND_WASHOUT`, apagado por defecto: así la media coincide con el sumario por zona, que no excluye derrumbe; activado, el control lo avisa). Si falta la bandera o el indicador, la opción queda
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

## V2 — interacciones

Rama `claude/distribuciones-v2`. Lo puro en `src/plots/distribution/interact.ts` (tests en
`tests/plots/distribution-interact.test.ts`); las capas DOM en `marks.tsx`.

### D10. Cutoff sobre el eje: qué línea y con qué alcance

- Si el rol de la propiedad tiene cutoff (`cutoffParamFor`: VSH, PHIE, SW, PERM), la línea ES el parámetro compartido
  del módulo `cutoffs` y se dibuja siempre (no hace falta «mostrarlo», a diferencia del histograma: en este panel el
  cutoff es la lectura principal). Se escribe con la misma receta que el histograma, `commitParamCutoff` (misma
  etiqueta que el slider del inspector, interruptor de k activado en el mismo alcance y el mismo deshacer).
- Alcance. El histograma tiene UNA línea y su alcance sale del filtro de zonas (una sola zona → esa zona; si no, el
  global). Acá cada fila ya es una zona, así que se usa la misma regla fila por fila: la marca de la fila lee y escribe
  el valor de ESA zona (`sharedParamValue` con su id: override o global) y la manija del eje lee y escribe el global.
  Es la semántica del histograma aplicada a cada zona, no una distinta. Una zona sin valor propio sigue al global
  (manija hueca) y se mueve con él durante el arrastre; con valor propio (manija rellena, «propio ≥ 0,09» bajo el
  nombre) no. Volver una zona al global se hace en el inspector (no hay receta de «quitar override» desde gráficos).
- k con interruptor (`permCutoffOn`): desactivado, línea gris punteada y sin sombra; arrastrarla lo activa en ese
  alcance (lo hace `commitParamCutoff`), igual que el histograma.
- Propiedades sin cutoff de módulo: «Agregar línea libre» (en la mediana), guardada en `DistributionConfig.cutoffs`
  (clave de curva → número, saneado en `sanitizeDistribution`; un `true` no aplica: el real se dibuja siempre). No
  cambia la petrofísica; el % es el del espesor filtrado por debajo de la línea (≤, como el histograma).
- El eje incluye los cutoffs (`distributionAxis(…, extra)`): con «Reservorio» las cajas de φ quedan todas a la derecha
  del corte y sin esto la manija quedaría fuera del eje. Durante el arrastre el eje se congela (como el histograma con
  las líneas de GR) para que no se mueva bajo el puntero.

### D11. % que pasa: mismos pesos y mismas muestras que la caja

`cutoffPassFraction` recorre las muestras con las reglas de `intervalDistribution` (`forEachUsed`): filtro, derrumbe
excluido si se pide, sin dato fuera, y el peso de los percentiles (espesor; h·φ para Sw por volumen poral; k por
espesor con k > 0). Corte inclusivo como el motor (`src/petro/cutoffs.ts`). Sin muestras → «—», nunca 0.

Desvío deliberado del texto literal «% del espesor filtrado»: si el filtro elegido YA aplica ese cutoff (reservorio
neto con Vsh, φ o k; pay neto con cualquiera), el % sobre él da 100 % por construcción después de cada recálculo, y
durante el arrastre oscilaría entre la vista previa y 100 %. En esos casos se mide sobre el nivel de arriba que no lo
aplica (`passBaseFilter`): Sw sobre el reservorio neto, Vsh/φ/k sobre toda la zona. Con Sw el peso es h·φ (el de
la caja): el % es la fracción del volumen poral del reservorio que es pay, no el N/G del pay por espesor (que es el
sumario); por eso el texto dice «volumen poral» o «espesor» según la propiedad. El control lo
dice («El % que pasa es de toda la zona: el filtro ya aplica este cutoff») y el tooltip de cada %. Las cajas siguen
con el filtro elegido, así que se ve cómo la distribución del reservorio se achica al subir el corte.

El pay neto por zona sale de la tabla `ZONE_SUMMARY` del último resultado del motor (por nombre de zona, como las
tarjetas de zona), sin recalcular nada en el panel.

### D12. Vista previa y commit

Mismo patrón que el histograma: cada movimiento del puntero escribe el parámetro con fase 'preview' (el motor
recalcula en vivo: banderas, sumario, pista del visor) y una vista previa local mueve la línea y el % sin esperar al
motor; al soltar, 'commit'; Escape durante el arrastre, 'cancel' (vuelve al valor de antes). El gesto entero es UNA
entrada de deshacer (`commitPlotParams` agrupa por gesto). El pay neto se actualiza cuando llega el resultado.

Teclado: la manija es `role="slider"` enfocable; las flechas mueven con el paso del slider del inspector
(`paramStep`: φ 0,005; Vsh y Sw 0,01; k sin paso, 1 % del eje log, redondeado a 3 cifras; libre, 1 % del eje) como
vista previa; Enter confirma, Escape vuelve al valor de antes del primer toque y salir de la manija confirma. Es
distinto del histograma (allí cada flecha es un 'commit' agrupado por la ventana de 800 ms): se eligió así para que
Enter/Escape tengan sentido y el recorrido con flechas sea un solo deshacer. Mayús = 10 pasos.

Problema encontrado y resuelto en el dock: el puente del motor pone el resultado en null con cada cambio de
parámetro (los parámetros son parte de la clave del contexto), así que durante el recálculo no hay calculadas, φe
«desaparece», la propiedad caía a la primera curva (BS) y la manija arrastrada se desmontaba. `useHeldContext`
(dock) sostiene el último contexto con resultado del mismo pozo y profundidad, con la interpretación nueva, hasta que
llega el resultado o un error. No cambia datos; evita el parpadeo. (El histograma y el crossplot tienen el mismo
parpadeo con curvas calculadas; queda anotado como riesgo, no se tocó acá.)

### D13. Selección por rango: fuente `'distribution'`

Arrastrar en horizontal sobre las cajas (fuera de las manijas) define [a, b]. La máscara son las muestras usadas
(mismas reglas que la caja: zonas visibles, filtro, derrumbe, sin dato) con valor en [a, b] (`rangeMask`), sobre la
serie actual; `makeSelection('distribution', …, { kind: 'range', curve, curveLabel, min, max })`. Se amplió
`SelectionSource` y `SelectionDetail` en `src/plots/link.ts` y `selectionTitle` («PHIE 0,0951–0,132 en las
distribuciones»); el visor, el histograma y el crossplot no distinguen la fuente (solo leen la máscara y
`detail.kind` para lo propio), así que la muestran sin más cambios (revisados todos los usos). Durante el arrastre la
banda y el % se calculan localmente; la selección compartida se arma al soltar (el visor y el crossplot no recalculan
en cada movimiento).

- Se dibuja como banda con el acento sobre todas las filas y una barra en el eje; por zona, «sel. 54 %» del espesor
  filtrado (ponderado como la caja; 0 % atenuado).
- Selección de otra fuente (lazo, tramo del visor, clases del histograma, rango de otra propiedad): por zona, la
  distribución de las muestras seleccionadas (`intervalDistribution` sobre `maskedRanges`, mismo filtro y pesos) como
  una barra fina DENTRO de la caja de la serie actual: P25–P75 rellena, bigotes P10–P90 y mediana calada. Se eligió
  sobre un carril aparte porque comparte el eje y la fila con la caja de la zona (se lee como un «bullet chart»: la
  caja queda visible alrededor y la mediana de la zona sobresale) y no cambia el alto de las filas.
- Escape (en cualquier lugar, como en los demás gráficos) o «Quitar selección» la borran. Escape durante el arrastre
  descarta el rango en curso y deja la selección anterior.

### D14. Gestos

- Clic sin arrastre en una caja: el visor va a la zona (como en la V1). Umbral de arrastre horizontal: 4 px con
  mouse, 10 px con toque (`pointerType`), así un toque no selecciona por accidente.
- Las filas tienen `touch-action: pan-y`: el desplazamiento vertical del panel sigue funcionando con el dedo y el
  arrastre horizontal es la selección. Las manijas tienen `touch-action: none` y un área de toque de 22 px (40 px con
  puntero grueso; la del eje se agranda con un pseudo-elemento) aunque lo visible sea una píldora de 8 × 16 px.
- Las marcas son capas DOM sobre los canvas (posición por fracción del eje en CSS, `--zd-pad` = el margen de
  `laneX`): un arrastre no redibuja ninguna caja; los canvas se redibujan solo cuando cambian las celdas (cuando el
  motor recalcula). El mapeo puntero → valor es `laneValue` (inversa de `laneX`, acotada al eje; en log, en décadas).
- En angosto, el eje reserva el borde de 3 px de la zona que tienen las filas: antes la grilla del eje quedaba
  corrida 3 px respecto de las cajas.
- La figura exportada incluye la línea del cutoff de cada zona.

### Cambios fuera de `src/plots/distribution/` y `src/modules/zone-distribution/`

- `src/core/plots.ts`: `DistributionConfig.cutoffs` (líneas libres) y su saneado: es configuración guardada.
- `src/plots/link.ts`: fuente `'distribution'`, detalle `range` y su título: la selección compartida es una sola.
- Tests: `tests/plots-state.test.ts` (la configuración de fábrica tiene `cutoffs: {}`).

## Queda para después

- Volver una zona al global desde el panel (hoy, en el inspector).
- Plugs de corona como serie.
- Histogramas apilados (violines) por zona.
- Barra P90/P50/P10 del volumen (incertidumbre) en la misma vista.
- Separar visualmente los carriles por serie con su nombre al costado cuando hay ancho.
