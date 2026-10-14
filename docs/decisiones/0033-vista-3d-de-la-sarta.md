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

- La DOI se mide **desde la referencia que declara la ficha** (D9 a): por defecto desde la pared del pozo (radio de la
  cáscara = radio del pozo + DOI); la inducción de arreglo, desde el eje (radio = DOI). El pozo es el trépano del pozo cargado (mediana de BS; si no hay, del calibre;
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
- **Estados** (primera versión; D9 cambia el aspecto, no la lógica): apagada = cuerpo gris translúcido y sin cáscaras (la formación no cambia de tamaño al apagar);
  planificada sin datos en este pozo = contorno (cuerpo casi transparente con aristas punteadas) y cáscaras más
  tenues; seleccionada = aristas continuas y un leve brillo del color de acento, **sin cambiar el color** (se sigue
  leyendo la familia y si está apagada; la primera versión la pintaba de acento y una densidad seleccionada parecía
  de resistividad); bajo el puntero = aclarada y con el nombre. Al seleccionar, rótulos con el nombre y la DOI de cada
  cáscara («RT · 90 in»), que se corren para no superponerse; los de la regla que chocan se ocultan.
- **Aproximado** en la vista: las cáscaras con DOI sin verificar tienen los bordes punteados (también las de curvas
  que el pozo no tiene, D9 b).
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
- **Centrar en la vista** (botón de la ficha): encuadra la herramienta con sus cáscaras desde el lado del corte. Es la
  única forma de mover la cámara hacia una herramienta: seleccionarla no la mueve (D9 c). Si la
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

## D9. Pulido visual: ilustración técnica, no prototipo (11c, segunda pasada)

La primera versión era correcta pero se leía como prototipo: la formación (un cilindro beige con rayas regulares)
dominaba el cuadro y la sarta ocupaba ~15 %; las herramientas eran cilindros translúcidos de color con bordes
punteados; luz plana; las cáscaras de inducción y laterolog se apilaban abajo en un abanico que tapaba todo. El
objetivo es una **ilustración técnica pulida** (render de producto), no fotorrealismo, todo procedural y sin imágenes.

- **Encuadre**: la vista inicial encuadra la **sarta** (de la cabeza a la última herramienta), no la caja de la
  formación; la formación puede salir del cuadro a los costados. Cámara más baja (elevación ~15°) y de 3/4 (azimut
  corrido del eje del corte) con un campo más cerrado (menos distorsión de perspectiva).
- **Formación como corte de contexto**: sin la pared exterior del cilindro; quedan las dos caras del corte, la tapa y
  la pared del pozo. Las caras y la tapa se **desvanecen** hacia el borde exterior y hacia abajo (la formación es
  contexto, no protagonista) y sus colores se mezclan con el fondo del tema.
- **Formación con datos reales**: en modo datos, el tramo de profundidad dibujado es el que muestra el visor (centrado
  en él, del largo de la sarta a la misma compresión 5:1: las capas tienen su espesor real relativo a las
  herramientas). El color sale de la **litología sugerida** del modelo de facies si el motor la calculó; si no, del
  **GR** (índice de arcilla con P5–P95 del pozo, en cinco clases de arena a lutita), con la paleta de litología de la
  app (`FILL_PALETTE`). Cada capa lleva una textura procedural de su litología (punteado en arenas, laminación en
  lutitas, ladrillo en carbonatos). Contra la pared, en las capas permeables, **revoque** (borde oscuro) y **zona
  invadida sugerida** (degradé del color del filtrado que se apaga hacia adentro, de largo esquemático proporcional a
  la permeabilidad de la clase). Prender o apagar herramientas no cambia la roca: el color sale del pozo, no de la
  sarta. En planificación o sin GR ni facies, una formación neutra con estratos suaves de los tokens.
- **Herramientas de acero**: `MeshStandardMaterial` metálico con un ambiente generado en código (`RoomEnvironment` +
  `PMREMGenerator`, sin imágenes); cuerpos torneados (chaflanes y collares en las uniones); el color de la familia
  queda **solo como anillos identificadores** arriba y abajo de cada herramienta. Patines de polímero oscuro, brazos y
  flejes de acero, cabeza con cuello de pesca. **Apagada**: gris mate opaco (sin reflejos), anillos grises.
  **Planificada sin datos**: contorno de vidrio (borde fresnel del color de contorno, centro casi transparente) y
  anillos punteados: se distingue de prendida y de apagada desde cualquier ángulo. **Seleccionada**: aro de luz del
  color de acento alrededor de la silueta (fresnel), sin cambiar el color.
- **Luz**: luz principal con sombras suaves (PCF con radio; mapa de sombras que se recalcula solo cuando cambia la
  escena, no al mover la cámara) más relleno del ambiente; `ACESFilmicToneMapping`, salida sRGB, antialias. Render a
  demanda como antes.
- **Cáscaras de vidrio**: material propio (fresnel): el borde de la cáscara más marcado que el centro, sin tapas
  macizas (solo el contorno de arriba y de abajo y las trazas sobre las caras del corte). Jerarquía: sin selección,
  todas sutiles; con selección, las de la herramienta elegida fuertes y las demás casi transparentes. Las de la
  elegida pintan además, muy suave, la porción de las caras del corte que investigan (se acumula hacia la pared, donde
  leen todas las curvas).

### Cómo quedó (detalles medidos sobre las capturas)

- **Cámara inicial**: azimut π/4 + 0,3 (la cara en θ = 0 casi de frente, a la izquierda de la sarta; la de θ = π/2 en
  escorzo), elevación 13°, campo vertical 26°. Encuadra de la base de la última herramienta a la regla, con un 14 % de
  aire. La **regla** pasó a la cara que mira de frente (θ = 0) y la **leyenda** arriba a la derecha (a la izquierda
  tapaba la regla); la nota de la formación («Formación 8.066,6–8.085,3 m · color por litología sugerida») abajo a la
  izquierda. Con la ficha abierta se oculta la ayuda de gestos.
- **Formación**: las caras se desvanecen desde la mitad del radio exterior (`rFade`) y en el 18 % de abajo; la tapa,
  antes (de canto y bien iluminada, una tapa ancha se leía como un disco que flota). Colores de litología mezclados
  con el fondo (24 % en claro, 40 % en oscuro) y material al 80 %: la sarta de acero es lo más contrastado del cuadro.
  Textura de las caras de 768 px a lo ancho (granos de 2×2 texeles: los de uno se pierden con el mipmap). Revoque de
  ~1,2 cm y zona invadida de hasta 30 cm × permeabilidad sugerida, **esquemáticos** (no salen de Rxo ni de ningún
  cálculo).
- **Costo**: las caras del corte usan `MeshLambertMaterial` y **no reciben sombras** (cubren media pantalla y el
  filtrado de sombras por píxel era el costo más grande); la sombra de la sarta cae en la pared del pozo, que sí las
  recibe, y en las propias herramientas. Las piezas de cada herramienta se funden por material (3 mallas por
  herramienta en lugar de 7). El mapa de sombras se recalcula solo cuando cambia algún objeto.
- **Selección**: funda de vidrio del color de acento (r × 1,3 + 1,4) alrededor de la herramienta; en una herramienta
  de 10 px de ancho un borde fresnel ajustado no se ve.

### Tres decisiones de la revisión (recomendadas por la orquestación, aceptadas por la usuaria)

- **(a) Referencia de la profundidad de investigación por ficha**: `ToolSheet.investigationFrom: 'wall' | 'axis'`
  (por defecto `'wall'`). La inducción de arreglo se especifica **desde el eje** (las curvas de 10 a 90 in son radios
  de investigación medidos desde el centro del pozo): su cáscara tiene radio = DOI y no radio del pozo + DOI. El dibujo,
  la leyenda («desde el eje») y la ficha respetan la referencia; la regla sigue midiendo desde la pared, que es una
  distancia física sin ambigüedad. Si un pozo es tan ancho que una DOI desde el eje cae dentro del pozo, la cáscara se
  apoya en la pared. Resuelve el punto «Abierto» de la primera versión.
- **(b) Cáscaras de curvas que el pozo no tiene**: se atenúan (más tenues, contorno punteado, rótulo «no está»), igual
  que el «no está» de la ficha. Ejemplo: la inducción del pozo de demostración no tiene AT20.
- **(c) Elegir en la lista no mueve la cámara**: seleccionar una herramienta (en la lista o en la vista) solo la
  resalta y abre la ficha; encuadrarla es una acción explícita con «Centrar en la vista». Una cámara que salta sola al
  recorrer la lista con ↑/↓ marea y hace perder el contexto.

Descartado:
- **Posprocesado (SSAO, bloom, contornos en pantalla)**: más código de three (`EffectComposer` y pasadas), más
  memoria de video y más costo por cuadro en una GPU integrada; las sombras y el fresnel dan la profundidad suficiente.
- **Texturas de imagen (roca, metal cepillado)**: harían crecer el HTML y no responden a los datos del pozo.
- **Formación coloreada por zonas**: las zonas A–E son unidades de interpretación, no litología; el GR y las facies
  dicen qué roca es.
- **Profundidad de la formación fija (mitad del pozo)**: desconectada de lo que la usuaria estaba mirando en el visor.

## Medición

- Pulido visual (D9): `dist/index.html` 5.381.295 → 5.406.064 bytes (**+24,8 kB**, +0,5 %; con gzip 2.426,1 → 2.433,2 kB:
  +7,2 kB). `RoomEnvironment`, `PMREMGenerator` y `mergeGeometries` son de three (ya incluido); las texturas son
  procedurales (canvas), sin imágenes.
- Costo por cuadro, medido en Chromium con **SwiftShader** (WebGL por CPU: sirve para comparar, no es una GPU) a
  1366×768, girando con el teclado: 87 ms antes del pulido → ~150 ms después (sin sombras ni ambiente serían ~100 ms;
  la primera versión del pulido, con caras PBR que recibían sombras, ~200 ms). En una GPU integrada son pocos
  milisegundos; además se dibuja solo a demanda. La textura de la formación (768 × hasta 2048 texeles) se genera una
  vez por cambio de pozo, tema o largo de la sarta, no al girar ni al seleccionar.
- Primera versión: `dist/index.html`: 4.714.604 → 5.375.821 bytes (**+661 kB**, +14 %; comprimido con gzip, 2.259,9 → 2.430,5 kB: +171 kB). Casi todo es three
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

- Resuelto en D9 (a): la referencia de la DOI (eje o pared) la declara cada ficha. Falta confirmar con bibliografía si
  el laterolog y el sónico se especifican desde el eje; hoy van desde la pared.
- La zona invadida y el revoque son esquemáticos; podrían salir de los datos (separación RXO/RT, diámetro de invasión
  de un módulo de tornado) cuando haya un módulo que lo calcule.
- Las herramientas sin largo en la ficha se dibujan con 3 m esquemáticos; con fichas de catálogo de una empresa se
  reemplazan sin tocar la vista.
- Herramientas de puntos (MDT, coronas laterales) en el esquema (0032, abierto).
