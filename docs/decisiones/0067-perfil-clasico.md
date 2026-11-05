# 0067 — Perfil clásico como estilo de fábrica del visor

- Estado: aceptada (la usuaria decidió que el perfil clásico es el estilo de fábrica; el anterior queda como «Moderno»).
- Alcance: `src/viewer/` (estilos, dibujo, encabezados, profundidad, escalas, menú contextual, medir), `src/ui/curves.ts`
  (variante de paleta), `src/ui/components/` (leyenda clásica, menú contextual, ícono de regla), `src/core/display.ts` y
  `src/core/state/project.ts` (estilo guardado), `src/core/state/zones.ts` (crear un tope), `src/app/` (selector, menú,
  figuras). Amplía la 0005 (visor multipista); no cambia el contrato de superposiciones salvo un campo opcional.
- Referencia visual: las convenciones de lectura de los perfiles impresos (y de wellerlogs.com como ejemplo de visor
  moderno sobrio). Se tomaron convenciones, no código ni marca.
- Capturas antes/después: `docs/capturas/perfil-clasico/`.

## Contexto

El visor de fábrica (fases 4–8) tiñe cada zona sobre todas las pistas, usa rellenos saturados (verde, beige) y líneas
de 1,5–1,75 px. A escala de pozo completo las curvas se vuelven manchas y las rayadas o punteadas, «confeti». Los
encabezados cortan títulos («DENSIDAD · NE…») y omiten la unidad. La lectura de un intérprete entrenado en perfiles
impresos pide lo contrario: fondo blanco, líneas finas y oscuras con su convención por curva, topes como líneas, un solo
relleno apagado en el GR y encabezados «mínimo · MNEMÓNICO unidad · máximo».

## D1. Un estilo es una capa de dibujo, no una plantilla de pistas

`src/viewer/look.ts` define `ViewerLook` con los interruptores de dibujo (zonas, paleta, trazo por densidad, tramas,
encabezados, TVDSS, calidad, grilla por décadas, fondo, ancho mínimo de pista) y dos estilos: `classic` (de fábrica) y
`modern` (el anterior, sin cambios). Cada estilo trae su plantilla de fábrica (`FACTORY_LAYOUTS`):
`BUILTIN_LAYOUTS` (clásico) y `MODERN_LAYOUTS` (la de siempre).

- **Guardado:** `Project.display.look` (`'modern'`; el de fábrica no se guarda). `sanitizeDisplay` lo valida y avisa si
  no lo reconoce. `setViewerLook` es una receta pura y se aplica con `commit` (Ctrl+Z la deshace).
- **Proyectos guardados:** un proyecto con pistas propias (`display.layouts[espacio]`) las conserva con cualquier estilo;
  solo cambia el dibujo. Uno sin pistas propias se abre con la plantilla de fábrica del estilo (el clásico).
- **Selector:** el botón de plantillas («De fábrica ▾») suma un grupo «Estilo» (Perfil clásico · Moderno) arriba del de
  «Pistas». Con «Moderno» el botón lo dice («De fábrica · Moderno»).
- **Pureza y compatibilidad:** `resolveTracks(…, { look })`, `FrameInput.look`, `OverlayFrame.look` y
  `ViewerFigureInput.look` son opcionales; ausentes significan «Moderno». Los tests y figuras de antes no cambian; la
  app pasa siempre el estilo del proyecto (pantalla, figuras exportadas y la cortina antes/después).

Descartado:
- **Estilo como otra plantilla de pistas** (como «Petrofísica esencial»). Cambiar el estilo borraría las pistas propias
  o exigiría duplicar cada plantilla en dos estilos.
- **Estilo por usuario en `localStorage`.** Las figuras y el proyecto entregado se verían distinto en otra computadora.
- **Un tema de tokens nuevo.** El estilo no es solo color (zonas, trazo, tramas, encabezados); los tokens siguen siendo
  claro y oscuro y el clásico suma uno (`viewer.gridDecade`).

## D2. Zonas sin teñir las pistas

Clásico (`overlays/zones.ts` con `frame.look === 'classic'`): cada tope es una línea de 1 px del color de la zona (2 px
la seleccionada) que cruza todo el perfil; el nombre va en texto de 10 px junto a la línea, en la primera pista de
curvas, con un halo del fondo para leerse sobre las curvas, y queda fijo arriba mientras la zona está a la vista. Junto a
la columna de profundidad, una franja de 6 px con el color de la formación. La línea se oscurece lo justo para contraste
2,2:1 con el fondo (`ensureContrast`), el texto 4,5:1. La edición (arrastrar topes, teclado, marcar zona, clic en la
franja o el rótulo) es el mismo código con los dos estilos; solo cambia la caja del rótulo.

El rayado de calidad del pozo (derrumbes) deja de cubrir las pistas de curvas: queda en una franja de 10 px junto a la
barra del borde derecho de la pista afectada (`overlays/qc.ts`), con el mismo tooltip.

## D3. Paleta clásica: líneas finas por convención, rellenos apagados

`CLASSIC_CURVE_PALETTE` y `CLASSIC_FILL_PALETTE` (`src/ui/curves.ts`) cambian sobre la paleta de siempre:

- Grosor 1 px por defecto y 1,25 como máximo (profunda RT y somera RS/RA10, para que la punteada se vea). El grosor de
  una plantilla también se acota; el que elige el usuario (override de rol o de curva) manda.
- Convención: GR verde oscuro `#17663a`; resistividad profunda roja sólida, media azul a rayas, somera verde punteada;
  RHOB rojo, NPHI azul a rayas; PE magenta; DT violeta; CALI negro a rayas; BS gris punteado. En oscuro, los mismos
  tonos aclarados. Un test exige contraste ≥ 4,5:1 contra el fondo de pista en claro y en oscuro.
- Calculadas (VSH, PHIE, SW, BVW, PERM) y banderas, en tonos menos saturados.
- Rellenos: arcilla oliva desaturado (`#8f8a62`, alfa 0,42), cruce de gas ocre apagado, agua azul grisáceo,
  hidrocarburo verde salvia, derrumbe gris.

Plantilla clásica: en Correlación un solo relleno, hacia la arcilla (sin arena); en Interpretación solo el de VSH (dos
rellenos superpuestos oscurecían la pista).

## D4. Encabezados completos, con unidad y sin cortes

`CurveLegend layout="classic"` (`src/ui/components/CurveLegend.tsx`): una fila «mínimo · MNEMÓNICO unidad · máximo» en
monoespaciada de 10 px (`--font-mono`, pila de fuentes del sistema: sin descargas) y debajo la muestra del trazo a todo
el ancho, con su color, grosor y patrón. La lectura del cursor aparece sobre la muestra; «alternativa», también. Cada
curva muestra sus extremos aunque compartan escala (el agrupado de extremos de «Moderno» se apaga). Si el nombre y la
unidad no entran, pasan a dos líneas; nunca se cortan. «ohm·m» se abrevia «Ω·m». Los títulos de pista van en minúscula
y en hasta dos líneas (sin cortar palabras); los nombres de banderas largos («Posible roca generadora») también; la fila
«+N» dice «+3 curvas» sin la lista cortada (la lista completa sigue en su ventana y en el tooltip). En el perfil clásico
el ancho mínimo de una pista es 92 px (104 en «Moderno»): las once pistas de Petrofísica entran a 1366 px sin
desplazamiento horizontal.

## D5. Fondo blanco y grilla por décadas

Todas las pistas en blanco (también la de profundidad) y grilla gris clara. En las pistas log, la línea de década usa
`viewer.gridDecade` (más marcada) y las subdivisiones 2–9 `gridMinor` (tenues). En oscuro, el equivalente sobrio de los
mismos tokens.

## D6. Profundidad en MD y TVDSS

El modelo de pozo guarda solo MD. `src/viewer/depthColumns.ts`:

- **Elevación de referencia** del encabezado: KB (EKB, KB, ELEV_KB…), si no DF (EDF), si no la del punto permanente
  (EREF, EPD). En pies se pasa a metros. **Sin elevación no hay TVDSS** y la columna no se muestra (nunca vacía): es el
  caso del pozo del TP (CSV sin encabezado).
- **Desviación:** una curva de inclinación (DEVI, INCL, HDEV…, en grados, todos los valores en 0–90) se integra con la
  tangente balanceada, ΔTVD = ΔMD·(cos I₁ + cos I₂)/2, suponiendo el pozo vertical hasta la primera muestra; un hueco
  repite el último valor. Sin curva, vertical: TVDSS = MD − elevación. La curva se reconoce por mnemónico porque el
  catálogo de unidades no tiene ángulos.
- **Dibujo:** con TVDSS la pista de profundidad pasa de 76 a 112 px: MD a la izquierda (texto oscuro) y TVDSS a la
  derecha (gris). Los rótulos TVDSS son valores redondos (el mismo paso que la MD) ubicados en la MD donde la TVDSS los
  alcanza (`tvdssTicks`), así cada número queda a su profundidad verdadera aunque el pozo esté desviado. En caché por
  pozo (`wellTvdss`). El menú contextual y «Medir» informan también la TVDSS y el espesor vertical.

## D7. Patrón de trazo según las muestras por píxel

`strokeMode(muestrasPorPíxel, trazo, estilo)` (`look.ts`), con la densidad = muestras visibles / alto en px:

- **Patrón (rayada, punteada) hasta 1 muestra por píxel** (`DASH_MAX_SAMPLES_PER_PX = 1`). Un patrón se gasta a lo largo
  del camino de la línea (6 px de raya + 4 de hueco a 1 px; 1,2 + 2,6 el punteado). Con a lo sumo una muestra por fila
  la polilínea avanza al menos 1 px hacia abajo por vértice y la raya acompaña a la curva. Con más, la reducción M4
  dibuja primera → mín → máx → última dentro de la misma fila: el camino va y vuelve en horizontal y el patrón se gasta en
  esos zigzags («confeti»). En el pozo del TP (paso 0,1524 m), patrón desde ≈ 1:580 hacia el detalle (1:500 y 1:200).
- **Sólida por encima**, con el color de la convención para distinguirla (la muestra del encabezado conserva el patrón).

Descartado: medir la «tortuosidad» de cada curva en cada cuadro (camino / alto) para decidir. Es adaptativo, pero una
curva cambiaría de patrón al desplazar la vista (parpadeo) y cuesta una pasada más por curva.

## D8. Pozo completo: banda mínimo–máximo y media

Con **3 o más muestras por píxel** (`ENVELOPE_MIN_SAMPLES_PER_PX`), la curva se dibuja como banda clara (alfa 0,28 del
color de la curva) de mínimo a máximo de cada fila y, encima, la línea fina de la media de la fila. Con tres o más
muestras por fila el zigzag M4 cubre todo su rango y la línea se vuelve una mancha del ancho de la variación local; la
banda muestra lo mismo (mín y máx de la fila: ningún pico se pierde, lo exige el control de calidad) y la media deja leer
la tendencia. Entre 1 y 3 muestras por fila la línea M4 todavía se lee como línea. TP: banda a partir de ≈ 1:1700.

- Usa los MISMOS buffers M4 de la reducción (D2 de la 0005): no hay cálculo extra por curva. La banda se arma directo
  desde los buffers (un polígono por tramo continuo, sin la lógica de cruces de `fillBetween`) y la media tiene un
  vértice por fila (la línea M4 tenía cuatro).
- La media (no la mediana): la mediana exigiría ordenar las muestras de cada fila en cada cuadro; la media ya está en
  el resumen por bloques. En escalas log es la media de las fracciones (la geométrica de los valores).

## D9. Tramas litológicas en las pilas

`src/viewer/lithology.ts`: mosaicos `TilePattern` (los mismos de `fills.ts`, en caché por lienzo) por relleno: arena con
puntos, arcilla con rayas horizontales cortas, caliza con ladrillos, dolomía con ladrillos de juntas inclinadas, marga,
creta, anhidrita y sal con cruces, toba con «v», basamento con aspas. Carbón lleno y los fluidos lisos. Se aplican en
las pistas `stack` (Litología de Petrofísica, Mineralogía de Geología) encima del color de la capa, con un trazo del
mismo color oscurecido (en oscuro, hacia el fondo: tenue, no brillante).

- **Zoom:** opacidad 1 hasta 1:1500, 0 desde 1:5000 y rampa logarítmica entre las dos (`patternOpacity`): se leen como en
  un perfil impreso a 1:200 y no ensucian la vista de pozo completo.
- **Fase:** el mosaico acompaña a la profundidad al desplazar (`patternPhase`): sin esto la trama queda quieta en la
  pantalla mientras los datos se mueven.
- **Costo:** en pantalla y PNG la capa se rellena una segunda vez con el `CanvasPattern` como `fillStyle` (sin
  recortes); en SVG, recorte + mosaico declarativo (`fillTiledRect`), como la columna sedimentológica.

## D10. Porosidad con el relleno clásico de BVW

Plantilla clásica, pista «Porosidad · Sw» (mismo id y curvas que «Moderno»): entre PHIE y BVW, hidrocarburo (por valor:
donde BVW < PHIE, el volumen PHIE − BVW = φ·(1 − Sw)); entre BVW y cero, agua (línea base en 0). PHIE y BVW comparten
la escala del catálogo (0,4 → 0) y SW queda encima con la suya (1 → 0), sin relleno. Reemplaza el relleno de
hidrocarburo de Sw (los bloques azules) en la vista de fábrica. Se descartó separar Sw en otra pista: sumaba ancho y,
a 1366 px, desplazamiento horizontal.

## D11. Selector de escalas de impresión

El rótulo 1:N de la barra pasa a ser un menú (`printScale.ts`): 1:200, 1:500, 1:1000, 1:2000 y 1:5000 con su equivalencia
en papel («50 cm cada 100 m» = 10 000 / N cm) y «Ajustar al pozo». La escala es la de la pantalla a 96 ppp (la misma
cuenta que `scaleRatio` y que las figuras exportadas). Una escala que el pozo no admite (más alejada que «ver todo» o más
cercana que el zoom máximo de 32 px por muestra) queda deshabilitada con el motivo. Elegir una acerca o aleja sobre el
cursor (o el centro). Los botones + y − siguen. Está en los dos estilos.

## D12. Menú contextual del perfil y «Medir»

Clic derecho sobre el perfil (`ContextMenu` de `src/ui`, el mismo teclado que `Menu`): encabezado con MD (y TVDSS), zona
y la lectura de la curva más cercana; luego

- **Copiar profundidad y lecturas:** MD, TVDSS y una línea por curva a la vista, separadas por tabulador (se pegan en una
  planilla como dos columnas). Portapapeles del navegador; si no hay permiso, un campo temporal.
- **Crear un tope en esa profundidad:** `addTopAt` (`src/core/state/zones.ts`), la misma receta de «marcar zona»: la zona
  donde cae se parte (arriba queda la original; la nueva hereda sus parámetros) o, en un hueco, nace una zona hasta la
  siguiente. Respeta el espesor mínimo y se deshace con Ctrl+Z.
- **Editar la pista:** abre el editor de escala y color que ya existe para la curva más cercana al puntero, anclado a su
  fila del encabezado.
- **Medir un intervalo:** no había herramienta: `overlays/measure.ts` (superposición propia del visor, sin React). Armada,
  el próximo arrastre marca un tramo con tope, base, espesor y, si hay TVDSS, el espesor vertical; queda a la vista hasta
  Escape.
- **Exportar lo visible como PNG:** la figura de `figure.ts` (plantilla «pistas») con el tramo y la escala de la pantalla
  a 150 ppp.

Mayús + clic derecho deja el menú del navegador. Teclado: con el visor enfocado, la tecla Menú o Mayús+F10 abre el menú en
la profundidad del cursor; la primera opción toma el foco, Escape lo cierra y vuelve al perfil.

## Consecuencias

- Módulos obligatorios: presiones MDT (pista propia y contactos), puntos de corona y tendencias son superposiciones y no
  cambian; se verificó la pista de presión del TP con el estilo clásico. Ningún punto del estilo chocó con ellos.
- Una superposición de módulo puede leer `frame.look` para adaptar su dibujo; no está obligada.
- Rendimiento (Chromium sin GPU, 1600 × 1000, `deviceScaleFactor` 1, 140 cuadros de zoom con Ctrl+rueda, scroll y
  paneo; tres corridas): ver la tabla de `src/viewer/README.md`. El clásico queda dentro del ruido de «Moderno».
- Tests: `tests/viewer/perfil-clasico.test.ts` (umbral de punteadas, banda, MD/TVDSS, escalas, tramas, estilo guardado,
  BVW, paleta, menú contextual, tope, zonas). Los tests de recetas de pistas que ejercitan rellenos de dos curvas usan
  `MODERN_LAYOUTS` (la plantilla de antes); los que describen la fábrica, la clásica.
- Pendiente: los encabezados de la figura exportada conservan su formato (nombre, unidad y escala en filas); la banda
  mín–máx y el trazo por densidad sí se aplican en la figura.
