# 0066 — Distribuciones por zona (boxplots comparados)

- Estado: V1 mergeada; V2 en `claude/distribuciones-v2`: interacciones (cutoff sobre el eje y selección por rango,
  D10–D14) y datos (corona como serie, histogramas apilados y volumen in situ, D15–D21).
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

## V2 — datos

Lo puro en `src/plots/distribution/`: `corePlugs.ts` (plugs del pozo), `plugs.ts` (estadística de la corona), `hist.ts`
(vista de histogramas) y `volume.ts` (lectura de las tablas de volumen e incertidumbre). Tests en
`tests/plots/distribution-v2b.test.ts`. El dock (`src/modules/zone-distribution/dock.tsx`) solo los conecta con los
stores. (Los `.ts` de `src/modules/` no pueden importar `src/plots` ni stores: los carga el worker; por eso lo puro de
esta parte vive en `src/plots/distribution/`, que ya lee definiciones de módulos como `src/plots/cutoffs.ts`.)

### D15. Corona como serie: qué plugs y con qué propiedad

- Plugs: los INCLUIDOS de todos los conjuntos de corona del pozo (decisión del usuario o propuesta de calidad,
  `plugStatuses`), con la profundidad CORRIDA (`shiftedDepth`: la misma que dibuja el visor). Un chip «Corona» (serie
  `#core`, saneada en `DistributionConfig.series`) aparece solo si hay plugs y la propiedad tiene equivalente.
- Mapeo por ROL de la curva elegida, nunca por mnemónico (`corePropertyOf`): φ ↔ PHIE, PHIT, PHIE_NMR y PHIT_NMR (los
  mismos roles sobre los que el visor dibuja los plugs); k ↔ PERM; densidad de grano ↔ RHOMAA (densidad de matriz
  aparente: no hay rol RHOG; en el visor la densidad de grano va sobre RHOB solo por legibilidad, pero RHOB no es la
  misma magnitud). Sw, Vsh, GR, etc. no tienen corona.
- Unidad: la de la columna de corona (los lectores ya la normalizan a v/v, mD y g/cm³). Si difiere de la de la curva y es
  la misma magnitud se convierte (`convertArray`) y se avisa; si es otra magnitud, no hay chip.
- Base de φ: el modelo de corona NO guarda si la φ del laboratorio es total o efectiva. Lo único que hay es la curva
  contra la que el conjunto la correlaciona (ajuste «curva de correlación» del panel Corona, por defecto PHIE). El
  tooltip lo dice siempre; si la propiedad elegida es de la otra base (PHIT contra un conjunto calibrado con PHIE, o al
  revés) el aviso pasa a tono de advertencia y se repite bajo los chips. En el TP la φ de corona (≈ 0,20 en B) queda
  muy por encima de PHIE (≈ 0,10): la diferencia es del dato, no del panel, y es justo lo que esta vista deja ver.

### D16. Plugs → zonas, filtro y tolerancia

- Cada plug se ata a la muestra de perfil más cercana a su profundidad corrida (`nearestSample`): tolerancia de UN paso
  de muestreo (0,1524 m en el TP), la misma que usa el resto de la app para ubicar una profundidad sobre el perfil. Más
  lejos (arriba o abajo del perfil, o en un hueco) queda «fuera del perfil»: no entra en ninguna zona y se cuenta en el
  texto de ayuda de la serie.
- Zona: la de esa muestra (los tramos de `layoutZones`, la misma regla que las muestras de perfil). Equivale a «la zona
  que contiene la profundidad corrida» salvo en el medio paso del borde, donde manda la regla de las muestras, así un
  plug nunca cae en una zona distinta de la de la muestra con la que se lo filtra.
- Filtro reservorio / pay: la bandera NET_RES / NET_PAY de esa muestra (con pay = reservorio y pay, como el motor). Si
  falta la bandera, «sin banderas netas», como las demás series.
- Derrumbe: NO se aplica a los plugs. El indicador de derrumbe marca muestras de PERFIL afectadas por el pozo; el plug
  se midió en el laboratorio. «Excluir derrumbe» sigue valiendo para las series de perfil.

### D17. Estadística de los plugs y n mínimo para la caja

- Los plugs son puntos, no espesores: `intervalDistribution` del motor con peso 1 por plug (Hazen con pesos iguales,
  idéntico a `weightedQuantiles` con pesos 1; test). Media aritmética para φ y densidad de grano; geométrica para k (eje
  log, coherente con la serie del perfil; k ≤ 0 cuenta como «sin valor»). No se duplica ningún cálculo.
- Con n < 5 plugs en una zona (`CORE_MIN_BOX`) se dibujan solo los puntos (sin caja ni rombo: una caja de 3 plugs
  engaña) y el n va en tono de advertencia. Con n ≥ 5, caja con los puntos tenues detrás (desplazamiento vertical
  determinista para separar valores iguales): se ve la dispersión real del laboratorio.
- n de plugs por zona bajo el nombre («corona: n 90 plugs (12 fuera del filtro)») y en el tooltip; el CSV de
  estadísticas lleva la fila «Corona» sin espesores y con la observación «plugs de corona, pesos iguales».
- Color: el de la primera corona en el visor (`RUN_COLORS`), distinto del acento de «Actual».

### D18. Vista «Histogramas»

- Conmutador «Cajas | Histogramas» (grupo «Vista»), guardado en `DistributionConfig.view` (`'box' | 'hist'`, saneado).
- Clases: el criterio del histograma del dock (`src/plots/histogram/histogram.ts`). Eje: `autoRange` (percentil 0,5 al
  99,5 ensanchado un 8 %) sobre TODAS las muestras usadas de las filas visibles y de todas las series (más los cutoffs,
  para que su manija se pueda agarrar), con extremos lindos; cantidad de clases por Freedman–Diaconis (Sturges si el
  IQR es 0) entre 5 y 80; bordes de extremo a extremo del eje, iguales en log10 para k y las resistividades. Cada clase
  cae en el mismo lugar en todas las filas. (En la vista de cajas el eje sigue siendo P10–P90.)
- Peso: el de la caja, muestra por muestra (`forEachUsed`): espesor; h·φ para Sw; los plugs, 1 cada uno.
- Normalización (decisión revisada y aceptada): cada serie se lleva a fracción de su propio peso y se dibuja escalada a
  SU pico (como un «ridgeline»). Se probó primero escalar la fila a su pico común: los plugs (90 valores en pocas clases) aplastaban al
  perfil en la misma fila. Así una zona fina se lee igual que una gruesa y las formas se comparan; las alturas entre
  series no, y por eso el tooltip da la fracción de cada serie en la clase bajo el puntero.
- Dibujo: contorno escalonado (sin suavizar: es un histograma); la primera serie rellena con el color de la zona (una
  serie) o el suyo (varias), las demás solo contorno (otros pozos punteado). Mediana como línea vertical y media como
  rombo hueco sobre la base, como en las cajas. La corona con menos de 5 plugs: puntos sobre la base.
- El cutoff, la banda de selección, el % que pasa, el clic → visor y el arrastre de rango son capas DOM y gestos que no
  dependen de la vista: siguen igual (verificado en el navegador). La caja fina de una selección de otra fuente va arriba
  de la fila.

### D19. Franja del volumen in situ

- «Volumen in situ por zona» (casilla en «Vista», `DistributionConfig.volume`). Solo de la serie «Actual» (si no está
  elegida, no se muestra).
- Determinista: tabla VOLUMETRICS del módulo `volumetrics` del último resultado (ya en MMbbl y Bcf; por nombre de zona,
  como el pay del sumario). Incertidumbre: la copia del Monte Carlo que guarda el panel del módulo `uncertainty`
  (tabla UNCERTAINTY, `p90Field`/`p50Field`/`p10Field` por id de zona y totales). Convención SPE-PRMS del módulo: P90
  = estimación baja, P10 = alta. No se recalcula nada.
- Por zona: punto del determinista y, si la incertidumbre está calculada, barra P90–P10 con marca en P50, en una escala
  0–máximo compartida por fluido (petróleo y gas separados, cada uno con su unidad). Sello o sin hidrocarburo: texto.
  Arriba del gráfico, los totales y el estado: «Calcular incertidumbre» si no se corrió; «Incertidumbre desactualizada ·
  Recalcular» con la barra en gris si cambió algo después (misma regla que el panel del módulo: firma de dependencias o
  generación del resultado).
- El enlace abre el módulo en el inspector (su paso del flujo, «Volumen», como «Todos los módulos») y no lo activa: el
  Monte Carlo se corre con su botón. Ancho: una tercera columna; angosto: una franja bajo cada fila.

### D20. Figura

La figura exportada (`registerXYFigure`) sigue la vista: título «Histogramas de …» o «Distribución de …», filas con
histogramas o cajas, la serie «Corona» en la leyenda con su glifo. La franja de volumen no entra en la figura (es un
dato de otro módulo con su propia exportación).

### D21. «Perfil en plugs»: la comparación equivalente

- Problema: la caja «Actual» de una zona usa TODA la zona; la corona, solo el tramo cortado. En el TP, la corona 1
  cubre ~27 m (7813–7841 m) de los 181 m de B: ahí DPHI (ρma 2,65–2,68) da 0,19–0,21 y PHIE_CMR 0,18, igual que la
  corona, pero la caja de toda B baja a ~0,10 por las arcillas que no se cortaron. Comparar corona contra la zona entera
  sugiere un error de perfil que no existe.
- Serie automática «Perfil en plugs» (`#core-log`, chip propio, saneado): la curva elegida de la serie «Actual» evaluada
  en las MISMAS muestras a las que se ata cada plug (D16: `nearestSample`, un paso de tolerancia), solo de los plugs con
  valor de corona válido, con peso 1 por plug, la misma media que la corona (aritmética φ, geométrica k), el mismo
  filtro (bandera de esa muestra) y la misma regla de n < 5. El derrumbe se aplica como en las otras series de perfil
  (afecta a la lectura del perfil, no al plug), así que con «Excluir derrumbe» su n puede ser menor que el de la corona.
- Se activa junto con la corona (al prender «Corona» se agregan las dos; al apagarla, las dos) y se puede apagar sola.
  Estilo: el acento del perfil con borde punteado.
- Las dos comparaciones quedan a la vista a propósito: corona contra «Perfil en plugs» mide el desacuerdo corona–perfil
  en las mismas profundidades (calibración: matriz, arcilla, base de φ); «Perfil en plugs» contra «Actual» muestra
  cuánto representa el tramo cortado a la zona (si los plugs sirven para caracterizarla).
- Tooltip de las dos series y de la fila en modo histogramas: «Corona − perfil en plugs: +0,012 v/v» (para k, también
  el cociente, que es lo que se lee en el eje log). CSV: fila «Perfil en plugs» con la observación correspondiente.

### Cambios fuera de `src/plots/distribution/` y `src/modules/zone-distribution/` (V2 — datos)

- `src/core/plots.ts`: `DistributionConfig.view` y `.volume`, serie `#core` en el saneado: es configuración guardada.
- `src/modules/uncertainty/snapshots.tsx` (nuevo) y `panel.tsx`: la copia del Monte Carlo vivía en un store privado del
  panel y es la única copia (el panel apaga `calculate` al llegar el resultado, así que el resultado del motor ya no la
  tiene). Se movió tal cual a un archivo propio para leerla desde las distribuciones; el panel no cambia de
  comportamiento.
- Tests: `tests/plots-state.test.ts` (la configuración de fábrica tiene `view` y `volume`).
- `src/app/shell/freeModuleView.ts` (nuevo): la constante `FREE_MODULE_VIEW` sale de `Inspector.tsx` (que la sigue
  reexportando) para que `FlowBar.tsx` y el dock de las distribuciones (enlace «Calcular incertidumbre») la importen
  sin ciclo de imports. Sin cambio de comportamiento.

## Queda para después

- Volver una zona al global desde el panel (hoy, en el inspector).
- Separar visualmente los carriles por serie con su nombre al costado cuando hay ancho.
- Guardar en el modelo de corona la base de φ del laboratorio (total / efectiva) para avisar con certeza.
- Totales de volumen en la figura exportada.
