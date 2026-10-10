# 0012 — Exportación de figuras (PNG, SVG, PDF)

- Estado: aceptada (fase 6c-2).
- Alcance: `src/io/export/figures/` (grabador SVG, escritor PDF, PNG con ppp, dimensionado, plantillas),
  `src/viewer/figure.ts` y `figureInput.ts` (figura del perfil), `src/plots/xy/figure.ts` y `figures.ts` (figura y
  registro de gráficos x–y), `src/app/export/` (sección «Figuras» del diálogo «Exportar»). No cambia el formato de
  proyecto ni el dibujo en pantalla.

## Qué

Figuras listas para el informe del perfil multipista (con superposiciones: zonas, calidad, tendencias, MDT, corona) y
de los gráficos x–y (crossplot k–φ y los que vengan, con tendencias y ecuación): PNG de alta resolución, SVG vectorial
y PDF de una página A4. Cuatro plantillas: figura completa del perfil, solo pistas seleccionadas, perfil + sumario por
zona y crossplot con leyenda.

## Decisiones

- **Mismo dibujo, otro contexto.** `ViewerRenderer.drawBase` y `drawXYScene` reciben el contexto 2D como parámetro, así
  que PNG y PDF dibujan sobre un canvas fuera de pantalla y SVG sobre un contexto «grabador». No se duplicó dibujo: lo
  exportado es lo que se ve. Único refactor de pantalla: el cuerpo del dibujo de `XYPlot` pasó a `drawXYScene`
  (`plots/xy/draw.ts`) y los tipos de capa a `layers.ts`; `XYPlot` lo llama igual que antes.
- **Grabador SVG** (`svg.ts`, `path.ts`): implementa lo que usa el dibujo (trazados, `arc`, `roundRect`, rellenos con
  alfa, rayas, `clip` anidado, degradado lineal, texto con rotación, `save/restore`). Cada operación es un elemento con
  `transform`; `clip()` abre un `<g clip-path>` hasta el `restore()`; los colores salen como hex + `*-opacity`; el texto
  es `<text>` con la fuente de los tokens y la línea de base resuelta con `dy` en `em` (no con `dominant-baseline`).
  Lo no implementado (`drawImage`, `strokeText`) falla con TypeError; las superposiciones están aisladas con `guard`.
- **`Path2D` durante la exportación.** El dibujo del visor hace `new Path2D()` y el nativo no se puede leer, así que
  `withSvgPath2D` lo reemplaza por `SvgPath2D` solo mientras dura el dibujo (síncrono) y lo restaura siempre.
- **96 ppp como unidad de diseño.** La figura se dibuja en px CSS: «1:200» es la escala real al imprimir al 100 % y el
  texto mide lo mismo que en pantalla. El PNG multiplica por `ppp/96` y escribe el chunk `pHYs` (el navegador no lo hace:
  sin él, 300 ppp se abre en Word como 96 ppp, tres veces más grande). El ancho en cm define el ancho del layout (las
  pistas se reparten ese ancho, mínimo 104 px por pista), no una ampliación.
- **Siempre tema claro, sin interacción.** `FIGURE_THEME = THEMES.light`; sin cursor, sin animación (`reveal`), sin zona
  seleccionada ni elemento activo. Las manijas de las tendencias salen con `createTrendsOverlays({ presentation: true })`
  (opción nueva, aditiva). La app arma superposiciones propias (`figureSources.ts`): zonas sin edición, calidad,
  tendencias en modo figura y las de los módulos.
- **Sin pistas vacías.** Sin elección, se omiten las pistas sin curvas y las pilas sin datos (un perfil sin interpretar no
  muestra «Litología» vacía); con «solo pistas seleccionadas» manda el usuario. La de profundidad siempre va.
- **Encabezado de pista en el marco** (`trackHeaderRows`): título, curvas con unidad y extremos de escala (invertidas
  incluidas), una sola fila de escala y unidad si varias curvas la comparten (resistividades), capas de la pila y banderas.
- **Tamaño y límites del raster.** Lado máximo 16 384 px y 120 Mpx. Si la resolución pedida no entra, el PNG baja a la
  mayor que entra y lo dice (diálogo y aviso); si ni a 96 ppp entra (pozo entero a 1:100) se rechaza antes de dibujar
  y se sugiere escala menor, tramo corto o SVG. El todo-el-pozo a 1:500 sale a ~217 ppp.
- **PDF escrito a mano** (`pdf.ts`, sobre `fflate`): PDF 1.4, Helvetica WinAnsi para el texto (título, subtítulo, datos
  del pozo y pie son texto real, seleccionable), la figura como imagen RGB con FlateDecode, `xref` con desplazamientos
  exactos. Una página A4, vertical u horizontal. Sin tablas de caracteres fuera de WinAnsi: φ→«phi», Ω→«ohm».
- **PDF y escala.** La escala elegida se respeta si el tramo entra; si no, se ajusta a la página, y si además las pistas
  no entran a lo ancho toda la figura se achica y el pie declara la escala IMPRESA (`pxPerM · zoom`).
- **Gráficos x–y: registro, no acoplamiento.** Un `XYPlot` con `figureId`/`figureTitle` se publica en
  `plots/xy/figures.ts` mientras está montado; el diálogo lista lo que hay a la vista. El crossplot libre y el histograma
  de la fase 7 se vuelven exportables pasando esas dos props. Hoy: «Crossplot k–φ de los plugs» (panel Corona).
- **`EXPORT_KINDS`** suma `figure`; el diálogo tiene dos secciones («Datos del pozo», «Figuras»).

## Alternativas descartadas

- **SVG con una biblioteca (canvg, svg.js, canvas2svg).** Dependencias nuevas y el build es un único HTML; el subconjunto
  de la API que usa el dibujo es chico y se prueba con goldens.
- **Reimplementar el dibujo para SVG.** Se desviaría del de pantalla en cada cambio del visor.
- **PDF vectorial.** Posible a futuro (el grabador ya sabe los trazados), pero el PDF es una página de informe y la
  imagen a 300 ppp alcanza; el SVG cubre lo vectorial.
- **JPEG en el PDF.** Es más chico pero con artefactos en trazos finos; Flate es lossless y se verifica en Node.
- **Varias páginas de PDF para el pozo entero a escala fija.** Fuera de alcance: una página, con ajuste.
- **Medir texto con aproximación en el navegador.** Se mide con un canvas real (`measureText`); la aproximación es solo
  para Node/tests.

## Verificado y no verificado

- Tests (`tests/figures/`): goldens del grabador, escritor y lector de PDF propio, `pHYs`, dimensionado, plantillas, el pozo
  del TP a SVG (XML bien formado), figura x–y con degradado, modo figura sin manijas, exportación completa con un raster falso.
- Chromium real (app compilada, pozo de demo): PNG (2 355 × 16 343 px, 217 ppp), SVG y PDF descargados; el PDF lo leen
  `pdfinfo`, `pdftoppm` y `pypdf`. Capturas en `docs/capturas/fase-6c-2/`.
- No verificado: Word, InDesign, Illustrator, Inkscape, Acrobat; Firefox y Safari; la baseline del texto SVG fuera de
  Chromium (se resuelve con `dy`, no con `dominant-baseline`).

## Pendiente

- La tabla del sumario tiene muchas columnas: en vertical se recortan los textos; conviene horizontal o elegir columnas.
- Histograma (fase 7) y crossplot libre: quedan exportables al pasar `figureId`; la barra de color por tercera curva
  (`XYColorKey`) está en el dibujo, falta que lo declare el crossplot.
- Pozo entero a escala fija mayor que lo que entra: solo SVG (o varias exportaciones por zona).
- Leyenda de zonas y encabezados siguen el idioma y unidades de la app (m, no pies).
