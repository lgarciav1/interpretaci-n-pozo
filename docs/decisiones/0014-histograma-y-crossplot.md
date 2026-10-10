# 0014 — Histograma y crossplot libre (fase 7a)

- Estado: aceptada (fase 7a).
- Alcance: `src/plots/histogram/`, `src/plots/crossplot/`, `src/plots/` (`data.ts`, `cutoffs.ts`, `link.ts`,
  `controls.tsx`, `plots.css`), ampliaciones de `src/plots/xy/` (barras, eje derecho, guías arrastrables, nube densa,
  búsqueda por grilla), `src/core/plots.ts` y `src/core/state/plots.ts` (configuración guardada), `src/app/plots/`
  (conexión con los stores), módulos `src/modules/histogram/` y `src/modules/crossplot/` (pestañas del dock,
  superposición y proveedor de series). Formato de proyecto v6.

## Contexto

Dos módulos obligatorios del profesor:

- **Crossplot libre:** cualquier curva contra cualquier otra en dos clics, color por una tercera curva o por capa,
  cutoffs arrastrables en X e Y, filtro por capa.
- **Histograma:** cualquier curva, cutoff arrastrable, superposición de histogramas de varias capas.

Además, las tendencias (0008) deben poder usarse sobre cualquier gráfico. Ya existían el gráfico x–y base (0010, D6),
las tendencias con proveedores de series, el dock con pestañas de módulos y la exportación de figuras (0012). «Capa» =
zona del pozo.

## D1. Dos pestañas del dock, aportadas por módulos; el código del gráfico en `src/plots/`

`src/modules/histogram/dock.tsx` y `src/modules/crossplot/dock.tsx` exportan `dockPanels` (se descubren solos: no se
tocó el núcleo ni la lista de la app). Son delgados: conectan los stores (`src/app/plots/connect.tsx`) con los paneles
de presentación `HistogramPanel` y `CrossplotPanel` (`src/plots/*/`), que no conocen los stores. Lo puro está en `.ts`
con tests: binning y estadísticos (`histogram.ts`), muestras graficables y color (`crossplot.ts`), plantillas
(`templates.ts`), serie para tendencias (`series.ts`), curvas y zonas (`data.ts`), cutoffs (`cutoffs.ts`).

- `PlotDockGate` monta el panel solo con su pestaña a la vista y el dock abierto: un gráfico oculto no recalcula con
  cada slider, y «Exportar → Figuras» ofrece lo que se ve.
- El panel se arma en tres columnas (controles · gráfico · panel aparte con estadísticos y lecturas). Con el dock
  angosto (consulta de contenedor en `em`) el panel aparte baja a la columna de controles; la leyenda (barra de color,
  zonas, series) va siempre debajo del gráfico para que no quede escondida.
- Con nueve pestañas, el dock angosto deja con solo ícono las no elegidas (el nombre sigue siendo el nombre accesible y
  el `title`): `Tabs` ahora rotula con `.ui-tabs__label` y `shell.css` lo oculta visualmente por debajo de 74 em.

## D2. Configuración en el proyecto: `display.plots[pozo]`

Curvas elegidas (`m:<curva>` o `r:<ROL>`, las mismas claves que las series de tendencias), escalas (auto/lineal/log),
ejes invertidos, rangos fijos (plantillas), color, zonas filtradas, plantilla, opciones del histograma y cutoffs
libres. Es trabajo del usuario y viaja con el archivo, como las pistas: vive en `Project.display.plots`, **por pozo**
(las zonas y las curvas medidas son del pozo), fuera de `Interpretation` (no recalcula el motor ni entra en snapshots) y
entra en deshacer por `commit` (`updatePlotConfig`, `setPlotCutoff`). Sin configuración guardada vale la de fábrica
(`defaultHistogram`, `defaultCrossplot`); la curva `null` se resuelve al mostrar (GR en el histograma; NPHI–RHOB en el
crossplot) sin escribir el proyecto. Al abrir, `sanitizePlots` descarta lo inválido. Formato v6; un archivo v5 se abre
sin `plots` (valores por defecto).

- Descartado: **en `Interpretation`.** Entraría en snapshots y obligaría a comparar más campos en `sameEngineInputs`.
- Descartado: **una sola configuración para todos los pozos.** Las zonas filtradas y los cutoffs libres son del pozo.

## D3. Cutoff arrastrable: real o libre

- Curva con rol `VSH`, `PHIE` o `SW` → la línea **es** el cutoff del módulo `cutoffs` (`vshCutoff`, `phiCutoff`,
  `swCutoff`). Arrastrarla escribe el parámetro compartido con `setParam` y la **misma etiqueta que el slider del
  inspector** («Cambiar Porosidad mínima»): cada movimiento recalcula en vivo (pay, sumario, pista del visor) y los
  cambios seguidos se funden en una entrada de deshacer (agrupado de 800 ms de 0006). El valor se acota al rango del
  parámetro y se redondea a su paso, como el slider; las flechas mueven un paso (Mayús ×10).
- **Alcance:** con exactamente una zona en el filtro del gráfico se lee y se escribe el valor de esa zona; si no, el
  global. El rótulo junto a la línea lo dice («Cutoff global · 0,08», «Cutoff zona C · 0,10») y su segundo renglón da
  el % de muestras que pasan.
- Cualquier otra curva → **línea libre**: se guarda en la configuración del gráfico (`cutoffs[curva] = valor`), no toca
  la petrofísica y muestra el % de muestras de cada lado. Durante el arrastre la vista previa es local; un `commit` al
  soltar.
- Siempre se agrega (botón), se mueve con el mouse (sobre la línea o su manija) y el teclado (la manija es un
  `role="slider"` con Tab, flechas y Supr para quitarla) y se quita. En el crossplot, con los dos cutoffs, el panel
  aparte muestra el % de puntos en cada cuadrante (resaltado el que pasa si los dos son reales).
- Mapeo y alcance en `src/plots/cutoffs.ts` (`cutoffParamFor`, `cutoffScope`, `sharedParamValue`, `resolveCutoffLine`).

Riesgo aceptado: una pausa de más de 800 ms con el botón apretado abre otra entrada de deshacer (igual que el slider).

## D4. Conexión con el visor

- **Gráfico → visor:** `src/plots/link.ts` (pub/sub sin React) y la superposición `plot-link`
  (`src/modules/crossplot/overlay.ts`): punto bajo el puntero en el crossplot → línea y rombo en su profundidad;
  clase bajo el puntero en el histograma → tramos de esas muestras; selección por rectángulo del crossplot → tramos
  (ensanchados medio paso, huecos de una muestra unidos) hasta «Limpiar». Clic en un punto lleva el visor a esa
  profundidad. Las marcas no salen en las figuras exportadas (la superposición no dibuja sin `data.commit`).
- **Visor → gráfico:** el crossplot lee `useViewer.cursorDepth` (lo que preveía 0005) y resalta el punto de esa
  profundidad con anillo y cruz en la capa de interacción, sin redibujar la nube.

## D5. Histograma

- Clases automáticas por **Freedman–Diaconis** (h = 2·IQR·n^(−1/3)), Sturges si el IQR es 0, acotadas a 5–80; a mano
  3–200. Rango del percentil 0,5 al 99,5 ensanchado un 8 % (sin pasar de los extremos): una lectura espuria no aplasta
  el histograma; lo que queda afuera se informa.
- **Escala log** según el rol (la convención del visor: resistividades y permeabilidad), con clases iguales en log10;
  se puede forzar lineal o log.
- **Superposición por zona** con el color de cada zona (relleno tenue + contorno escalonado) y **normalización a %**
  de cada serie (por defecto: sin normalizar, zonas de distinto espesor no se comparan). Acumulada opcional en un eje
  derecho 0–100 %.
- **Estadísticos** (n, media, P10, P50, P90; media geométrica en escala log) en el panel aparte, nunca sobre el
  gráfico. P10 = percentil 10 (el 10 % queda por debajo), no la convención de excedencia de reservas.

## D6. Crossplot libre

- X, Y y color con selectores agrupados (medidas y calculadas activas); intercambiar ejes; escala log automática según
  el rol; invertir cada eje.
- Color por tercera curva: rampa **viridis** (`SEQUENTIAL_PALETTE`, nueva en el sistema de diseño) cuantizada en 32
  niveles entre los percentiles 2 y 98, con barra de color; o por zona (leyenda con los colores de zona); o uno solo.
- Rango automático robusto (percentiles 1–99, «lindo»); una curva sin negativos no muestra eje negativo.
- **Tendencias** sobre los puntos visibles: proveedor `crossplot` (clave `<x>|<y>|<zonas>`) con la infraestructura de
  0008, ajuste lineal/log/exp/potencial con ecuación y R² dibujados en el gráfico; se editan en el panel «Tendencias».
  La tendencia queda atada a las zonas filtradas al crearla.
- **Rendimiento:** nube densa dibujada en lotes por color (círculos hasta 12 000 puntos; cuadraditos por encima),
  búsqueda del punto bajo el puntero con una grilla (`pick.ts`), y dos canvas (escena e interacción): mover el puntero
  o el cursor del visor no redibuja la nube. Medido en Chromium sin GPU: 5 810 muestras, redibujo completo ≈ 25 ms;
  50 000 muestras, puntero ≈ 25 ms por movimiento y cambio de color ≈ 0,6 s (incluye recalcular colores y rangos).

## D7. Plantillas

Un menú configura ejes, escalas, rangos y líneas guía; las líneas se calculan en vivo con los parámetros actuales.
Matemática pura en `templates.ts`, con tests contra valores conocidos.

| Plantilla | Ejes | Líneas | Fuente |
|---|---|---|---|
| Densidad–neutrón | NPHI (−0,05–0,45) vs. RHOB (1,9–2,9, invertida), color por GR | Arenisca (2,65; −0,02), caliza (2,71; 0) y dolomía (2,87; +0,01) hasta el agua dulce (1,0; 1,0), marcas cada 0,1 de φ | Schlumberger (1989), *Log Interpretation Principles/Applications*, tabla de minerales (CNL en unidades de caliza); mezcla lineal de volúmenes (Asquith y Krygowski, 2004, cap. 4). **Aproximación lineal**: las líneas de la carta CP-1 son curvas (sobre todo la dolomía). |
| Pickett | Rt (log) vs. PHIE (log, 0,01–1), color por VSH | Sw 100, 50, 30 y 20 %: Rt = a·Rw/(φ^m·Sw^n) | Pickett (1966), JPT 18(11); Asquith y Krygowski (2004), cap. 6. a, m, n del alcance (zona si hay una sola filtrada); Rw = mediana de la curva RW en los puntos visibles (ya corregida por temperatura) o, si falta, la Rw conocida del módulo `rw-manual`. |
| φ–Sw (Buckles) | PHIE (0–0,4) vs. SW (0–1), color por VSH | BVW = 0,02…0,10 (Sw = BVW/φ) | Buckles (1965), J. Can. Pet. Tech. 4(1); Asquith y Krygowski (2004), cap. 6. |
| GR–Rt | GR vs. RT (log) | GR de arena limpia y de arcilla (`grClean`, `grShale`) | Parámetros del paso Arcilla. Elegida sobre Vsh–φ porque deja listas las líneas que la fase 7b va a arrastrar. |

**Preparado para la fase 7b** (no implementado): arrastrar el punto de matriz, la recta de agua de Pickett o las
líneas de GR limpio/arcilla será cambiar el parámetro de la función que dibuja la línea (`densityNeutronLine(lith)`,
`pickettLine(sw, archie)`, guías de GR) con el mismo mecanismo de guías arrastrables de D3.

## D8. Exportar

Los dos gráficos pasan `figureId`/`figureTitle` a `XYPlot` («histograma», «crossplot-libre»). La figura dibuja barras,
eje derecho, líneas de plantilla rotuladas (sin `strokeText`, que el grabador SVG no tiene), guías con rótulo y la barra
de color de la tercera curva (`XYFigureSource.colorKey`, que 0012 dejaba pendiente).

## D9. Tamaño de interfaz

Medidas del panel en CSS con `--ui-scale`; el gráfico ocupa el alto del panel (`height="fill"`); rótulos de guías,
de líneas y del eje derecho reciben el factor `ui` del canvas y las figuras dibujan con 1. Verificado en los tres
niveles a 1366 × 768 sin desplazamiento de página.

## Ampliaciones de la base x–y (aditivas)

`XYBarLayer`, `XYLineLayer.y2/label/labelAt`, `XYGuide.id/draggable/detail/step`, `XYPointLayer.dense/alpha`, props
`y2`, `bars`, `highlight`, `selection`, `onGuideChange`, `onGuideRemove`, `onPointHover`, `onPointLeave`,
`onBarHover`, `barLabel`, `colorKey` y `height: 'fill'`; rótulos de ejes log en potencias de 10 lejanas (10⁻⁶). El
crossplot k–φ de la corona sigue igual.

## Alternativas descartadas

- **Un componente de gráfico propio para el histograma.** Reusar `XYPlot` da ejes, grilla, guías, exportación y
  tamaño de interfaz iguales al crossplot; solo hizo falta la capa de barras.
- **Cutoff real con un solo `commit` al soltar.** El pay no se vería cambiar durante el arrastre; el pedido es
  recálculo en vivo, igual que el slider.
- **Selección por lazo.** El rectángulo de `XYPlot` alcanza para marcar tramos en el visor; el lazo queda pendiente.
- **WebGL para la nube.** El canvas 2D en lotes alcanza para el pozo del TP y para 50 000 muestras; WebGL complicaría
  la exportación (que reusa el mismo dibujo).

## Verificado y no verificado

- Tests: `tests/plots/histogram.test.ts`, `tests/plots/crossplot.test.ts`, `tests/plots/xy-interaction.test.ts`,
  `tests/plots-state.test.ts`, `tests/figures/xy-figure.test.ts` (SVG de histograma y crossplot).
- Chromium real con el pozo de demostración: histograma de PHIE por zonas con su cutoff; arrastrar el cutoff de PHIE de
  0,08 a 0,185 bajó el pay neto del sumario (zona C: 46,8 → 31,4 m); teclado (← un paso); crossplot densidad–neutrón por
  GR, Pickett, tendencia exponencial; cursor del visor ↔ punto; selección por rectángulo → tramos; exportar lista los
  gráficos; claro y oscuro; Compacto, Normal y Grande sin desplazamiento de página.
- No verificado: lectores de pantalla reales con la manija de cutoff; Firefox y Safari.

## Pendiente

- Selección por lazo y «excluir del ajuste los puntos del rectángulo» para las tendencias del crossplot.
- ~~Arrastre de matriz, recta de agua y líneas de GR (fase 7b).~~ Hecho: 0015.
- Líneas de litología curvas (cartas CP-1 tabuladas) en vez de rectas de mezcla.
- Rangos de ejes editables a mano (hoy: automáticos o los de la plantilla).
- ~~Que el arrastre de un cutoff real garantice una sola entrada de deshacer aunque se pause más de 800 ms.~~ Hecho:
  agrupado por gesto (0015, D2.1).
