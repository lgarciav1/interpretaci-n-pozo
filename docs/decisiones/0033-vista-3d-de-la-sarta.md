# 0033 — Configurador de la sarta con vista 3D (fase 11c)

- Estado: aceptada (fase 11c).
- Alcance: pantalla de la sarta (`src/app/toolString/`): lista para armar, vista 3D que se gira, se mueve y se acerca,
  ficha técnica al seleccionar; fichas con los valores de la investigación (`src/core/toolSheets.ts`); colores de la
  escena en los tokens (`src/ui/tokens.ts`, grupo `scene`); dependencia `three`.
- Parte de: 0032 (núcleo de la sarta: modelo, recetas, disponibilidad), 0004 (sistema de diseño), 0016 (la columna
  izquierda de «Armar pistas» como precedente).

## Contexto

La 11a dejó la sarta manejable solo desde la paleta de comandos. Lo acordado con la usuaria: **se arma en una lista y
se mira en 3D** (no se arrastran piezas dentro del 3D); el punto didáctico de la vista es la **profundidad de
investigación**: tiene que leerse de un vistazo que la microrresistividad lee centímetros y la inducción profunda más de
un metro. Una sarta real mide ~30 m de largo y ~10 cm de diámetro, y la inducción profunda mira ~2,3 m dentro de la
formación: ninguna proyección a escala real deja ver las tres cosas a la vez.

## D1. Dónde vive: un modo del armazón, como «Armar pistas»

Botón **Sarta** en la barra del visor (junto a «Pistas») y comando «Abrir la sarta» en la paleta (grupo «Sarta»). Al
abrirla:

- La **columna izquierda** pasa a ser la lista de la sarta (igual que el catálogo de «Armar pistas», 0016 D1: no le
  quita ancho al centro). Los dos modos se excluyen: abrir uno cierra el otro.
- El **centro** (visor y dock) queda tapado por la vista 3D, con la **ficha** como panel a la derecha de la vista
  cuando hay una herramienta seleccionada (si el centro mide menos de 760 px, la ficha se superpone a la vista). Visor y
  dock **siguen montados** debajo (`inert`, `visibility: hidden`): al volver conservan la profundidad, el zoom y la
  pestaña, y ya muestran las curvas con la sarta nueva.
- El **inspector** (derecha) no cambia: al apagar la densidad se ve en vivo cómo las insignias de los módulos pasan a
  «no disponible», que es la consecuencia que la vista quiere enseñar. La ficha y el pie de la lista lo repiten
  («36 de 45 módulos disponibles»).
- Escape cierra la ficha y, si no hay, la pantalla; también la X de la lista y «Volver al perfil».
- Primera versión probada: el 3D solo en el lugar del visor, con el dock abajo. En una pantalla de 950 px de alto la
  vista quedaba de ~470 px y la sarta era ilegible; se tapa también el dock.

Descartado:
- **Diálogo a pantalla completa**: tapa el inspector y el efecto de la sarta sobre los módulos deja de verse.
- **Pestaña del dock**: 260 px de alto no alcanzan para una vista 3D que se gira.
- **Ficha en el inspector**: el inspector es colapsable y es justo donde se ven las insignias de disponibilidad.
- **Lista y 3D juntos en la columna izquierda**: 292 px para una vista 3D es un sello postal.

## D2. Escala: radios a escala real, largos comprimidos 5:1, regla radial

Una unidad de la escena = 1 cm **en dirección radial**: radios de herramientas, pozo, patines y profundidades de
investigación están a escala real **entre sí**. En dirección axial, 1 m de herramienta = 20 cm de escena (compresión
uniforme 5:1): una sarta de 30 m mide 6 m de escena, algo más que el diámetro de la cáscara de la inducción profunda
(~4,8 m en un pozo de 8,5 in), así la vista inicial muestra las dos cosas con proporciones de pozo. La compresión es la
misma para todas las herramientas: sus largos relativos son reales (la RMN de 16 m es seis veces la espectral de
2,6 m). Se probó 10:1 primero: la sarta del pozo de demostración quedaba como un disco ancho y bajo, con las cáscaras
como platos; 5:1 se lee como un pozo.

- La DOI se mide **desde la pared del pozo** (definición de `ToolSheet.investigation`, 0032): la cáscara de una curva
  tiene radio = radio del pozo + DOI. El pozo es el trépano del pozo cargado (mediana de BS; si no hay, del calibre;
  si no, 8,5 in marcado «esquemático»).
- **Regla de escala radial** sobre la cara del corte (10 cm, 50 cm, 1 m, 2 m) y una leyenda fija: «Radios y
  profundidades de investigación a escala real · largos comprimidos 5:1».
- **Escala de piezas sin dato** (no son números de la ficha y no se presentan como tales): espesor del patín, ancho de
  los flejes, cabeza de cable de 1,2 m, piezas chicas (electrodo del SP sin resistividad, calibre sin densidad,
  temperatura) de 1 m.
- Medidas faltantes en la ficha: largo genérico de 3 m y diámetro de 3,625 in, marcados **esquemático** en la ficha y
  en el rótulo; nunca se presentan como dato.

Descartado:
- **Escala radial logarítmica**: entra todo, pero la microrresistividad y la inducción parecerían comparables; engaña
  justo sobre lo que la vista enseña.
- **Todo a escala real**: la sarta es una aguja de 30 m y 9 cm; con la cáscara de 4,8 m de diámetro, la herramienta
  ocupa 2 px.
- **Herramientas engordadas** (radio exagerado y DOI real): la DOI se mide desde la pared; si la pared se mueve, la
  relación herramienta–DOI deja de ser cierta.
- **Compresión no uniforme** (raíz del largo, largo fijo por herramienta): legible, pero inventa proporciones entre
  herramientas.

## D3. La escena es una descripción pura; three.js solo la dibuja

`buildToolStringScene(entrada)` (`src/app/toolString/scene.ts`, sin three ni DOM) recibe la sarta resuelta (0032 D8),
las fichas, el diámetro del pozo, la selección y los colores del tema, y devuelve primitivas: cuerpos (cilindros con
desplazamiento lateral), patines, brazos, flejes de centralizador, anillo del SP, cáscaras y bandas de DOI, ambiente
(formación con un cuarto recortado, pared, lodo, cable) y la regla. `render3d.ts` traduce esas primitivas a mallas.
Así la geometría, las escalas y el mapeo de fichas se prueban con Vitest sin WebGL, y cambiar de tema o de selección
es reconstruir una descripción barata (decenas de primitivas).

- **Render a demanda**: se dibuja cuando cambian la cámara (evento `change` de los controles), la escena o el tamaño
  (`ResizeObserver`); no hay bucle continuo. Píxeles por punto acotados a 2. Al desmontar se liberan geometrías,
  materiales, controles y el contexto (`renderer.dispose()` + `forceContextLoss()`).
- **Sin WebGL** (o si crear el contexto falla): un mensaje en lugar de la vista; la lista y la ficha siguen andando.

Descartado:
- **Componentes React por pieza (react-three-fiber)**: una dependencia más y un reconciliador para ~60 mallas que se
  reconstruyen juntas.
- **Mutar la escena en el lugar** con cada cambio de estado: rápido, pero la escena deja de ser testeable y cada gesto
  tiene que saber qué mallas tocar.

## D4. three.js, versión exacta, importando solo lo necesario

`three@0.186.1` (publicada el 24/9/2026) con versión exacta y `@types/three@0.186.0` en desarrollo. Se importan
nombres sueltos de `three` (el empaquetador descarta el resto) y `OrbitControls` de `three/examples/jsm/controls/`.
Todo queda dentro del HTML único: funciona con `file://` sin internet.

Descartado:
- **WebGL a mano**: órbita, paneo táctil, selección por rayo y transparencias ordenadas son cientos de líneas propias
  para mantener.
- **Babylon.js**: más pesado y con más maquinaria de la que se usa.
- **SVG isométrico o CSS 3D**: sin órbita libre real y con transparencias pobres; las cáscaras anidadas no se leen.

## D5. Qué se dibuja

- **Pozo en corte**: formación alrededor con un cuarto recortado (las caras del corte con estratos suaves), pared del
  pozo, lodo translúcido y el cable que sube desde la cabeza.
- **Herramientas**: un cilindro por herramienta con el diámetro y el largo de la ficha, de arriba a abajo en el orden
  de la lista, coloreado por familia (gamma verde, nucleares rojizo, resistividad azul, acústica violeta, RMN verde
  azulado, condiciones del pozo gris). Montaje: **patín** (densidad, microrresistividad) = cuerpo corrido hacia la
  pared, patín curvo contra ella y brazo hasta la pared opuesta; **excentralizada** = cuerpo apoyado contra la pared;
  **centralizada** = en el eje, con un centralizador de flejes arriba. Todo lo apoyado va del lado del corte, para que el
  contacto se vea.
- **Piezas fijas** (no seleccionables; al pasar el puntero dicen qué son): cabeza de cable y centralizadores.
- **SP**: anillo de electrodo sobre la primera herramienta de resistividad (inducción o laterolog) de la sarta; si no
  hay ninguna, un electrodo corto esquemático en su lugar de la lista. **Calibre**: es el brazo de la densidad cuando
  la densidad está en la sarta (seleccionarlo resalta el brazo); si no está, una sección corta con su brazo. El
  calibre multibrazo (entubado) no va.
- **Profundidad de investigación**: una cáscara cilíndrica translúcida por curva (`investigationByRole`; si la ficha
  no la tiene por curva, una con `investigation.typical`), del color de la curva en el visor (`curveStyle`), de la
  altura de la herramienta y visible en el cuarto recortado. El rango mínimo–máximo de la ficha es una **banda difusa**
  (degradé de opacidad que se apaga hacia los extremos). Sin dato de DOI (SP, temperatura), sin cáscara.
- **Estados**: apagada = cuerpo gris translúcido y sin cáscaras (la formación no cambia de tamaño al apagar);
  planificada sin datos en este pozo = contorno (cuerpo casi transparente con aristas punteadas) y cáscaras más
  tenues; seleccionada = aristas continuas y un leve brillo del color de acento, **sin cambiar el color** (se sigue
  leyendo la familia y si está apagada; la primera versión la pintaba de acento y una densidad seleccionada parecía
  de resistividad); bajo el puntero = aclarada y con el nombre. Al seleccionar, rótulos con el nombre y la DOI de cada
  cáscara («RT · 90 in»), que se corren para no superponerse; los de la regla que chocan se ocultan.
- **Aproximado** en la vista: las cáscaras con DOI sin verificar tienen los bordes punteados.
- **Simplificación aceptada**: las cáscaras de las herramientas de patín son cilíndricas completas aunque el patín lee
  solo su lado del pozo (lo que se enseña es la profundidad radial).

## D6. Interacción y accesibilidad

- **Cámara** (`OrbitControls`): arrastrar gira, botón derecho o dos dedos mueven, rueda o pellizco acercan. Botón
  **Vista inicial** (y tecla Inicio). Con la vista enfocada: flechas giran, + y − acercan. Con
  `prefers-reduced-motion` la vista inicial salta sin animación.
- **Selección sincronizada**: clic en la vista selecciona y abre la ficha; la lista marca la misma fila (y al revés).
  Clic en el vacío deselecciona.
- **Lista** (fuente de verdad, accesible por teclado): cada fila es un botón que selecciona; interruptor prendida /
  apagada (`setToolOn`); arrastre por la manija con eventos de puntero (como 0016, sin drag and drop nativo) y
  **Alt+↑/↓** para reordenar (`moveTool`); ↑/↓ recorren las filas; en planificación, **Supr** o el botón quitan y
  «Agregar herramienta» suma.
- **Centrar en la vista** (botón de la ficha): encuadra la herramienta con sus cáscaras desde el lado del corte. Si la
  usuaria no movió la cámara, la vista inicial se reencuadra sola al cambiar el tamaño (abrir la ficha, la ventana) o
  la sarta (agregar o quitar).
  Cada acción es un `commit` (Ctrl+Z la deshace) y se anuncia en una región `aria-live`.
- **Modo** datos / planificación con un control segmentado: pasar a planificación con un plan vacío copia la sarta de
  los datos (`startPlanning(…, 'data')`); «Empezar de cero» la vacía.

## D7. Ficha

Panel con: qué mide, curvas que entrega (con su color y si este pozo las tiene), profundidad de investigación por curva
y su rango, resolución vertical, montaje, largo y diámetro, limitaciones, fuentes y **qué módulos habilita**
(`modulesEnabledBy`), o, si no habilita ninguno, por qué. Los campos de `unverified` llevan la marca «aproximado»; las
medidas genéricas, «esquemático»; lo que la ficha no tiene, «sin dato». Valores en pulgadas con su equivalente en cm.
Sin ecuaciones.

## D8. Colores desde los tokens

`ThemeTokens.scene` (claro y oscuro): fondo, formación y estratos, pared, lodo, metal, cable, patín, apagada, contorno,
regla y tintes de familia. Las cáscaras usan el color de la curva (`curveStyle`, 0004 D4). La escena se reconstruye al
cambiar el tema (`useResolvedTheme`).

## Medición

- `dist/index.html`: 4.714.604 → 5.375.821 bytes (**+661 kB**, +14 %; comprimido con gzip, 2.259,9 → 2.430,5 kB: +171 kB). Casi todo es three
  (el renderizador WebGL y sus shaders no se pueden descartar); el resto de la pantalla son ~25 kB. Abre con `file://`
  sin internet.
- Verificado en Chromium (Playwright, SwiftShader) sobre `dist/index.html` con el pozo de demostración, en claro y
  oscuro: vista inicial, inducción con sus cinco cáscaras, ficha de la densidad, densidad apagada (36 de 45 módulos),
  planificación con laterolog sin datos; sin WebGL (mensaje, la lista y la ficha andan), teclado (Alt+↓, Enter, Supr,
  Escape), arrastre por la manija y deshacer. Sin errores de consola.

## Consecuencias

- `TOOL_SHEETS` deja de estar vacía: `tests/tool-sheets.test.ts` compara cada número con el JSON de la investigación.
- Los comandos de la paleta del grupo «Sarta» quedan como atajos; se suma «Abrir la sarta».

## Abierto

- La DOI de la inducción suele darse como radio desde el **eje** del pozo, no desde la pared; la app usa la definición
  única de la ficha (desde la pared). La diferencia es el radio del pozo (~11 cm en 8,5 in): visible en la curva de
  10 in, despreciable en la de 90 in. Si la cátedra lo pide, un campo `from: 'axis' | 'wall'` en `SheetQuantity`.
- Las herramientas sin largo en la ficha se dibujan con 3 m esquemáticos; con fichas de catálogo de una empresa se
  reemplazan sin tocar la vista.
- Herramientas de puntos (MDT, coronas laterales) en el esquema (0032, abierto).
