# 0016 — Pistas armables y plantillas propias

- Estado: aceptada (fase 7b, función Z).
- Alcance: recetas puras de pistas y plantillas (`src/core/state/tracks.ts`), tipos y validación al abrir
  (`src/core/display.ts`: `TrackSpec.hidden`, `DisplaySettings.trackTemplates`), catálogo de herramientas y curvas
  (`src/viewer/catalog.ts`), modo de edición del visor (`src/viewer/WellViewer.tsx`, `src/viewer/layoutEdit.tsx`),
  panel «Armar pistas», selector de plantillas y arrastre (`src/app/tracks/`), conexión en `ViewerSlot.tsx` y la
  columna izquierda de `App.tsx`.
- Parte de: 0005 (D3 ya decidió que las pistas del usuario viven en `Project.display.layouts[espacio]`), 0006
  (deshacer), 0012 (figuras) y 0013 (tamaño de interfaz).

## Contexto

El plan pide «elegir una herramienta o curva de un catálogo y arrastrarla para armar la pista; crear pistas nuevas y
guardar plantillas propias». Hasta 7a las pistas eran las de fábrica (`BUILTIN_LAYOUTS`) y la receta
`setTrackLayout` existía pero nadie la usaba. Hace falta: catálogo, arrastrar y soltar con indicadores, una vía
equivalente sin mouse, reordenar, quitar, cambiar anchos, plantillas con nombre, restablecer, todo con deshacer y
guardado en el proyecto, y sin romper las convenciones de lectura (colores por curva, log en resistividad, rellenos).

## D1. Se edita el visor en el lugar (modo «Armar pistas»), con el catálogo al costado

El botón «Pistas» de la barra del visor abre el panel **Armar pistas**, que ocupa la **columna izquierda** (reemplaza a
«Datos del pozo» mientras se arma: no le quita ancho al perfil, que en una notebook de 1366 px ya es angosto), y pone
el visor en modo de edición: los encabezados de pista muestran una manija (arrastrar = reordenar; clic = menú), las filas de curva se
pueden arrastrar entre pistas y cada pista tiene un borde derecho para cambiar el ancho. Mientras se arrastra, una capa
sobre el visor marca los destinos: la **columna** de una pista (soltar = agregar ahí; sobre una fila = insertar en ese
lugar) y los **espacios entre pistas** (una barra de acento con «Pista nueva»). Las pistas que se ocultan solas
cuando están vacías (`hideWhenEmpty`: Porosidad · Sw, Permeabilidad, Banderas) se ven en modo edición con borde
punteado y «aparece cuando haya curvas», para poder moverlas o quitarlas.

- Lo que se ve al editar es exactamente lo que queda: los mismos anchos, colores y escalas del perfil.
- Arrastrando una pista (o una herramienta), toda la columna de una pista lleva al espacio más cercano (mitad
  izquierda = antes, derecha = después): no hace falta apuntar a la franja de 22 px.
- Escape (o el mismo botón) termina; el selector de plantillas de la barra está siempre a mano.
- Descartado: **el catálogo como panel dentro del visor**: con los laterales abiertos a 1366 px el perfil quedaba en
  ~340 px y todas las pistas en su ancho mínimo.
- Descartado: **un editor esquemático aparte** (columnas de tarjetas en un diálogo, como el editor de plantillas de
  Techlog/IP). Es otra representación que hay que aprender y no muestra el resultado hasta cerrar.
- Descartado: **HTML5 drag and drop nativo.** Cambiar el DOM en `dragstart` (mostrar la capa de destinos) cancela el
  arrastre en Chrome, la imagen fantasma no se puede estilar bien, no anda con pantallas táctiles y `dataTransfer` no
  se puede leer durante `dragover`. Se usa un arrastre propio con eventos de puntero (`src/app/tracks/dnd.ts`): umbral
  de 4 px, fantasma propio, destino por `elementFromPoint` sobre atributos `data-drop-*`, desplazamiento horizontal
  automático cerca de los bordes y Escape para cancelar. El visor solo pinta los destinos y avisa qué se tocó: no
  conoce el catálogo ni los stores.

## D2. Catálogo agrupado por herramienta, con la herramienta completa como primer elemento

`buildTrackCatalog` (puro, con tests) arma grupos fijos — Rayos gamma · SP, Caliper · trépano, Resistividad,
Densidad · neutrón, Sónico, GR espectral, Resonancia magnética, Curvas calculadas, Banderas, Otras curvas del pozo —
más **Pistas especiales** (profundidad con la franja de zonas, columna volumétrica, Interpretación que junta las
calculadas, Banderas y las pistas propias de las superposiciones, p. ej. presiones MDT).

- Cada grupo tiene una **herramienta** (la pista completa de fábrica: curvas, escala y rellenos de convención) y sus
  **curvas** sueltas. Una curva lleva su rol (`{ role }`), su estilo de plantilla (GR con curva de respaldo) y los
  rellenos que le son propios (GR: arcilla/arena; caliper: derrumbe con el trépano; RHOB/NPHI: cruce; SW: hidrocarburo;
  VSH/IGR: arcilla). Así una curva suelta en una pista nueva se ve como en la de fábrica.
- Color y escala salen de `curveStyle()` (la misma fuente que el visor): la fila muestra el trazo con su color y
  rayado, y el rango «0,2 – 2000 · log» o «0,45 – −0,15» (invertida).
- **Deshabilitadas:** las curvas medidas que el pozo no tiene (rol sin curva asignada). Las calculadas están
  habilitadas si algún módulo produce ese puerto, con la marca «Sin calcular» si todavía no hay resultado: armar la
  plantilla antes de calcular es normal. Las curvas medidas sin rol aparecen por mnemónico (`{ curveId }`); las de
  resistividad, en su grupo.
- Los roles que declaren módulos nuevos caen en su familia o en «Otras»: el catálogo crece sin tocarlo.
- Búsqueda sin acentos sobre mnemónico, rol, nombre y grupo; cada fila dice si ya está en alguna pista.

## D3. Qué es «una curva» al moverla: la entrada de la plantilla, no la curva resuelta

Una pista guarda **selectores** (`{ role }`, `{ curveId }`, `{ unassigned }`), no curvas. Mover la fila «NPHI» mueve
la entrada `{ role: 'NPHI' }` (con la medida y la calculada de ese rol, que son el mismo concepto). Reglas:

- **Soltar desde el catálogo agrega** (una pista puede repetir una curva que está en otra, como en la industria);
  **arrastrar una fila mueve**. Si la pista de destino ya tiene ese selector, se reubica en vez de duplicarse.
- Fila que vino de un grupo (`{ unassigned: 'resistivity' }` con AT10, AT20…): al moverla o quitarla, el grupo se
  **expande** en entradas `{ curveId }` del pozo activo (mismo orden y estilo) y se opera sobre la entrada de esa
  curva. Las demás no se mueven.
- Fila que tomó un recolector (`collect: 'computed'`, sin entrada propia): moverla agrega `{ role }` en el destino
  (los selectores explícitos ganan al recolector); no se puede quitar (se oculta con el editor de la curva).
- **Rellenos:** los de una sola curva (`edge`, `baseline`) viajan con ella y se quitan con ella; los de dos curvas
  (`between`) se copian al destino si ahí quedan las dos, y en el origen quedan latentes (el resolvedor no dibuja un
  relleno sin sus curvas), así devolver NPHI a su pista restituye el cruce.
- Pistas de superposición (MDT): quitarlas las marca `hidden` (si se borraran, `withOverlayTracks` las volvería a
  agregar); el catálogo las vuelve a mostrar. `hidden` es un campo opcional nuevo de `TrackSpec`.
- Las pistas aceptan lo que pueden dibujar: curvas en pistas de curvas, banderas en la de banderas; profundidad,
  columna volumétrica y superposiciones no aceptan curvas (el destino se ve deshabilitado).

## D4. Recetas puras sobre la lista de pistas, una entrada de historial por gesto

`src/core/state/tracks.ts` (sin React, con tests): `addTrack`, `moveTrack`, `removeTrack`, `addCurveToTrack`,
`moveCurveEntry`, `removeCurveEntry`, `expandGroupEntry`, `setTrackWidth`, `renameTrack`, `updateLayout` y las de
plantillas. Trabajan sobre la **lista materializada** que se ve (las propias o las de fábrica + las pistas de
superposiciones, `withOverlayTracks` sin contexto), por id de pista, nunca por índice de lo dibujado (lo dibujado
omite pistas vacías). Cada gesto es un `commit` con etiqueta propia en español («Mover NPHI a Pista 2», «Crear
pista GR», «Cambiar ancho de Sónico», «Aplicar plantilla «Mi plantilla»»), así Ctrl+Z deshace exactamente un paso.
El ancho se previsualiza en el visor mientras se arrastra el borde y se guarda al soltar (una sola entrada).

## D5. Plantillas propias en el proyecto, con nombre y por espacio de trabajo

`DisplaySettings.trackTemplates?: TrackTemplate[]` con `{ id, name, workspace, tracks, savedAt }`.

- Guardar con un nombre que ya existe en ese espacio **reemplaza** sus pistas (se avisa en el diálogo). Aplicar copia
  las pistas a `layouts[espacio]`; restablecer borra `layouts[espacio]` (vuelve la de fábrica). Renombrar y borrar
  desde el panel. Todo con deshacer.
- El selector de la barra muestra cuál está aplicada comparando las pistas (JSON canónico): «De fábrica», el nombre
  de la propia, o «Personalizadas» si se tocó algo después de aplicar.
- **Formato del proyecto: sin cambio de versión.** Los dos campos son opcionales: un proyecto anterior se abre sin
  plantillas y sin pistas ocultas (valores por defecto) y `sanitizeDisplay` valida lo nuevo al abrir (plantillas sin
  nombre o con pistas inválidas se descartan con aviso; ids repetidos también). Una versión vieja de la app que abra
  un proyecto nuevo ignora los campos que no conoce. **Consecuencia aceptada:** si ese proyecto se abre y se vuelve a
  guardar con la app anterior, se pierden las plantillas propias y las pistas de superposición quitadas vuelven a
  aparecer (las pistas armadas sí se conservan). Se prefirió esto a subir la versión, que impediría abrirlo del todo.
- Al abrir también se acota el ancho de cada pista a 0,4–4 (con aviso) y se descartan, con aviso, las plantillas con
  nombre repetido en un mismo espacio; una fecha de guardado inválida se descarta y la plantilla se conserva.
- Descartado: **biblioteca personal en `localStorage`** compartida entre proyectos. Útil, pero no viaja con el archivo
  (el TP se entrega como proyecto) y duplica la validación; queda para después, como copia al proyecto al usarla.
- Descartado: **plantillas globales para cualquier espacio.** Las de Geología y Petrofísica tienen pistas distintas;
  se listan las del espacio activo.

## D6. Sin mouse

- Catálogo: cada fila y cada herramienta tiene el botón «Agregar a pista…» (menú con las pistas que la aceptan y «En
  una pista nueva»): el botón «+» de cada fila, que se alcanza con Tab, abre ese menú.
- Pista: la manija del encabezado es un botón con menú (mover a la izquierda/derecha, más ancha/angosta, renombrar,
  quitar) y atajos con la manija enfocada: Alt+←/→ mueve la pista, Alt+Mayús+←/→ cambia el ancho, Supr la quita.
- Curva: botón con menú en cada fila (subir, bajar, mover a cualquier pista o a una nueva, quitar) y atajos con la
  fila enfocada: Alt+↑/↓ reordena, Alt+←/→ la pasa a la pista vecina.
- Cada acción se anuncia en una región `aria-live` («NPHI movida a Pista 2»).

## D7. Tamaño de interfaz y figuras

- Panel, filas, manijas, destinos y fantasma se miden con tokens y `--ui-scale` (0013): escalan con los tres niveles.
- La figura del perfil (0012) ya resolvía `layoutFor(espacio, display.layouts)`: usa las pistas armadas sin cambios.
  Las pistas ocultas no se dibujan (`resolveTracks` las salta) ni aparecen en la elección de pistas de la figura.

## Consecuencias

- `resolveTracks` gana la opción `keepEmpty` (modo edición: las pistas `hideWhenEmpty` vacías se resuelven con
  `latent: true`) y salta las `hidden`. Sin la opción, el visor y las figuras se comportan como antes.
- `withOverlayTracks` respeta las pistas de superposición ocultas (no las vuelve a agregar).
- `layoutTracks` gana la opción `weightedMin` (solo el visor en pantalla): cuando las pistas no entran y el visor se
  desplaza en horizontal, todas quedaban en el mínimo y cambiar el ancho no se veía; ahora una pista de ancho k > 1 mide
  al menos k × el mínimo. Las más angostas que 1 no bajan del mínimo legible. Las figuras no cambian.
- Las superposiciones del visor de la app se movieron a `src/app/shell/viewerOverlayList.ts`: las comparten el visor
  y las acciones de «Armar pistas» (las pistas propias de superposiciones son parte de la lista que se edita).
- Historial: cada gesto es una entrada. Como en el resto de la app (0006), pulsaciones seguidas con la misma etiqueta
  (Alt+→ tres veces sobre la misma pista) se agrupan en una.

- Un módulo nuevo aparece en el catálogo por su rol (familia) y, si declara pista propia, en «Pistas especiales»,
  sin tocar el catálogo.
- Riesgo: las plantillas guardan `{ curveId }` cuando se expande un grupo; en otro pozo con otros mnemónicos esas
  entradas no encuentran curva y la pista queda con el estado vacío que lo dice (no se rompe nada).
