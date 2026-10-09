# 0005 — Visor multipista

- Estado: aceptada (fase 4a; revisada tras la revisión de arquitectura: arrastre, pistas propias de superposiciones,
  rellenos por valor, escalas log, cachés acotadas, validación al abrir). Ampliada en la fase 4b (D9–D15): pista
  volumétrica, edición de zonas, editor de escalas, animación de carga, minimapa, encabezado de pozo, alternativas y
  elementos de superposición alcanzables con el teclado (cambio aditivo del contrato, D15).
- Alcance: `src/viewer/` (modelo, cálculos, dibujo y componente), `src/core/display.ts` (configuración guardada),
  `src/app/shell/ViewerSlot.tsx` (conexión con los stores) y `src/app/store/viewer.ts` (cursor publicado).
- Lo heredan: la fase 4b (pista volumétrica, encabezado de pozo, minimapa, editor de escalas, edición de zonas),
  las superposiciones de presiones MDT y corona (fase 6), histograma y crossplot conectados (fase 7) y las pistas
  armables (fase 7).

## Contexto

El visor es la pantalla principal: tiene que dibujar decenas de miles de muestras por curva a 60 cuadros por
segundo, verse mejor que Techlog/IP/Geolog sin romper las convenciones de lectura (colores por curva, log para
resistividad, rellenos de cruce, derrumbe) y aceptar que otros módulos dibujen encima sin tocar su núcleo.

## D1. Un canvas para el cuerpo de todas las pistas + un canvas de cursor encima; encabezados en HTML

```
┌ barra del visor (rango visible, escala 1:N, zoom, ver todo) ─────────────────────┐
├ encabezados HTML (CurveLegend + lectura del cursor), grilla con anchos en px ─────┤
├ canvas base: fondo, grilla, zonas, rellenos, curvas, superposiciones   ┐ mismo    │
│ canvas de cursor: línea, puntos sobre las curvas, etiqueta de prof.    ┘ tamaño   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- El paneo y el zoom cambian **todas** las pistas a la vez, así que redibujar por pista no ahorra nada; lo que sí
  cambia solo es el cursor, que va en su propio canvas (mover el mouse no redibuja curvas).
- Los anchos de pista se calculan una vez (`layoutTracks`, puro) y se usan igual para la grilla HTML de
  encabezados y para el canvas: no hay que alinear N elementos.
- Lo que cruza pistas (topes de zona, cursor, futuras líneas de tendencia) se dibuja una sola vez.

Descartado:
- **Un canvas por pista.** N contextos y N buffers por `devicePixelRatio`, elementos que cruzan pistas
  duplicados y sincronización de N redibujos por cuadro. La ventaja (redibujo parcial) no aplica al paneo.
- **Más capas (grilla cacheada en un bitmap aparte).** La grilla depende del viewport; cachearla no ahorra nada
  medible (< 0,2 ms).
- **WebGL.** Rendimiento sobrado, pero texto, trazos rayados y rellenos con transparencia hay que reimplementarlos;
  el canvas 2D alcanza (ver mediciones en `src/viewer/README.md`).
- **OffscreenCanvas en un worker.** Saca el dibujo del hilo principal, pero complica eventos, tema y lectura del
  cursor. Se reconsidera solo si un cuadro pasa de ~8 ms en hardware modesto.

## D2. Reducción de muestras por fila de píxel (M4) sobre fracciones precalculadas

- Cada curva se transforma **una vez** a fracción del ancho de pista (`0` = borde izquierdo, `1` = derecho; log,
  inversión y unidad ya aplicadas) y se guarda en caché por identidad del array y firma de la escala
  (`fractionArray`). En cada cuadro no se calcula ningún logaritmo.
- Si hay más de 1,5 muestras por fila de píxel (eje de profundidad), `decimateRows` recorre las muestras visibles y
  guarda por fila **primera, mínima, máxima, última y media** (algoritmo M4): la línea pasa por primera → mín → máx →
  última de cada fila, así que el dibujo reducido es idéntico píxel a píxel al completo y no se pierde ningún pico
  (importante para el control de calidad). Los rellenos usan la media de la fila.
- **Huecos NaN:** una fila cuyas muestras son todas NaN es hueco y corta la línea; una fila sin muestras (muestreo
  irregular) no corta. Un hueco menor a un píxel no se ve a esa escala (se ve al acercar).
- Con pocas muestras por fila se dibuja la polilínea de las muestras.

- Los límites de fila (qué índices caen en cada fila) se calculan una vez por cuadro con búsqueda binaria y los
  comparten todas las curvas; cada array tiene además un resumen por bloques de 32 muestras (mín, máx, suma,
  cantidad, primera, última) en caché, así una fila de cientos de muestras se recorre por bloques.

- **Cachés acotadas:** `fractionArray` recuerda a lo sumo 4 escalas por array (LRU; alcanza para ir y volver entre
  escalas en el editor de 4b); los resúmenes por bloques y las conversiones de unidad están en `WeakMap` por array
  (se liberan con el array); el dibujante descarta al final de cada cuadro los buffers de fila que ese cuadro no usó.

Costo por cuadro: O(filas · (log n + muestras por fila / 32)) por curva, sin asignar memoria (buffers reusados).
Medido: ≈ 4 ms de media por cuadro con el pozo del TP y ≈ 6 ms con 50 000 muestras (detalle en `src/viewer/README.md`).

Descartado:
- **Saltear muestras (stride).** Pierde picos: un AT10 de 110 ohm·m desaparecería a ciertos zoom.
- **LTTB.** No es exacto al píxel y es más caro por cuadro.
- **Pirámide min/max completa (varios niveles).** O(filas · log n), pero un solo nivel de bloques ya deja la
  reducción por debajo de 0,1 ms por curva con 50 000 muestras; el resto del cuadro es rasterizado. Queda como
  mejora si aparecen pozos de millones de muestras.

**Rellenos:** un polígono por tramo continuo del mismo lado (ida por una curva, vuelta por la otra; en un cruce se
cierra en el punto interpolado y se abre otro), todos los de un color en un `Path2D` con un solo `fill()`. La
primera versión (un cuadrilátero por muestra) costaba 4–5 ms por cuadro solo en rellenos.

## D3. Dónde vive la configuración de pistas

| Qué | Dónde | Por qué |
|---|---|---|
| Plantillas de fábrica por espacio de trabajo | código: `src/viewer/templates.ts` | son parte de la app; se mejoran con cada versión |
| Pistas del usuario por espacio de trabajo (fase 7: pistas armables) | **proyecto**: `Project.display.layouts[espacio]` | es trabajo del usuario sobre ese estudio; tiene que viajar con el archivo |
| Overrides por rol (p. ej. GR 0–200 en todo el proyecto) | proyecto: `Project.display.roles[rol]` | idem |
| Overrides por curva (p. ej. AT10 en azul) | proyecto: `Project.display.curves[pozo][curva]` | los ids de curva son por pozo |
| Viewport, cursor, zona bajo el puntero | estado de interfaz (`useViewer`) | efímero |

- El formato del proyecto pasa a **v3** (migración v2 → v3: `display` vacío). Recetas puras en
  `src/core/state/project.ts`: `setTrackLayout`, `setRoleDisplay`, `setCurveDisplay`. Cuando exista quitar un pozo
  (hoy no hay receta), tiene que borrar también `display.curves[pozo]`. Todo es JSON puro, en `src/core/display.ts`
  (el núcleo no importa del visor).
- `display` vive **fuera de `Interpretation`**: cambiar un color no recalcula el motor ni aparece en los snapshots
  ni en sus diferencias.
- Precedencia de estilo: override de curva → override de rol → opciones de la plantilla → `curveStyle()` (paleta
  del sistema de diseño + `RoleDef.display` del catálogo).

Descartado:
- **`localStorage`.** Se pierde al abrir el proyecto en otra computadora o entregarlo. Sí puede servir en la fase 7
  para una *biblioteca personal* de plantillas reutilizable entre proyectos (copiada al proyecto al usarla).
- **Estado de UI.** Se pierde al cerrar.
- **Dentro de `Interpretation`.** Dispararía cálculos y ensuciaría snapshots y comparaciones.

## D4. Cómo se encuentran las curvas (medidas y calculadas) por rol

`resolveTracks(plantilla, fuentes, overrides)` (puro) arma las pistas a dibujar. Selectores de una pista:

- `{ role }` → las curvas medidas con ese rol **y** la salida activa del módulo que produce ese puerto (si el
  usuario eligió un módulo para `VSH`, se ve la `VSH` calculada; la del archivo también, con su mnemónico).
- `{ curveId }` → una curva puntual del pozo (para plantillas propias).
- `{ unassigned: dimensión }` → curvas medidas **sin rol** de esa magnitud (AT10 y AT30 del TP en la pista de
  resistividad, con la escala de la pista).
- `collect: 'computed' | 'flags'` → la pista se queda con toda curva calculada (o bandera) que no haya ubicado
  ninguna otra pista. Así **un módulo nuevo se ve en el visor sin tocar nada**: VSH, PHIE, SW y PERM ya tienen
  lugar en la plantilla; cualquier rol nuevo cae en «Interpretación» y las banderas (`family: 'flag'`) en su franja.
- Las curvas medidas se convierten a la unidad canónica de su rol (caché por identidad), así los rangos de
  `RoleDef.display` valen para cualquier archivo (NPHI en %, densidad en kg/m³…).
- Pistas con `hideWhenEmpty` (permeabilidad, banderas) no ocupan lugar hasta que exista algo que mostrar; el resto
  muestra un estado vacío que dice qué falta.
- **Medida y calculada del mismo rol en una pista:** rellenos y `xOf(rol)` de las superposiciones usan la
  **calculada activa** (`findCurve`): si el usuario calculó VSH, el sombreado es el de su VSH, no el del archivo. Por
  clave (`m:<id>`, `c:<módulo>:<puerto>`) se pide una curva puntual.
- **Escala pedida inválida:** un override log con mínimo ≤ 0 (GR 0–150 pasada a log, RT con `min: 0`) conserva la
  escala log y reemplaza el mínimo por el primero válido (rol → pista → década por debajo del P1 positivo de los
  datos). Nunca cae a lineal en silencio.
- **Pistas propias de superposiciones** (`kind: 'overlay'`, `overlayId`): se conservan sin curvas, con su escala
  (D7).

## D5. Coordenadas

- `Viewport = { top (m), pxPerM, height (px CSS) }`; `y = (prof − top)·pxPerM`. Profundidad siempre en metros.
- Límites: alejar hasta ver el pozo entero en el alto disponible; acercar hasta 32 px por muestra. `top` se acota
  a `[profMín, profMáx − alto/pxPerM]`. La escala de impresión se informa como `1:N` a 96 ppp.
- En x, cada curva tiene una fracción `f` (D2); `x = xPista + f·anchoPista`. Grilla lineal de 10 divisiones; grilla
  log por décadas (líneas en m·10ᵏ, mayores en 10ᵏ). La grilla de una pista es la escala **efectiva** de su curva de
  arriba (la última de la lista); sin curvas, la de la pista. Si el usuario pasa las resistividades a lineal, la
  grilla deja de ser log.
- Ticks de profundidad "lindos": paso 1-2-5 × 10ᵏ con al menos 56 px entre rótulos y subdivisiones si quedan a más
  de 7 px.

## D6. Valores fuera de escala: recorte + curva de respaldo opcional

- Las curvas se recortan a su pista (`clip`); los rellenos se acotan al borde. Nada se dibuja sobre la pista vecina.
- `wrap: true` (en la plantilla o como override) dibuja la **curva de respaldo** como en la industria: lo que excede
  el máximo vuelve a entrar por la izquierda corrido un ancho de escala (GR 0–150 → respaldo 150–300), más fina y
  translúcida. Está activa por defecto solo en GR (el TP llega a 180 gAPI). En log no se usa: 0,2–2000 cubre las
  resistividades reales; lo que sale se recorta.

## D6 bis. Rellenos: convenciones y comparación por valor

- **GR:** del borde izquierdo a la curva, **arcilla** (el ancho crece con GR, igual que IGR y VSH); de la curva al
  borde derecho, **arena**. Lo mismo en el GR espectral de geología.
- **Densidad–neutrón:** comparación **en pantalla** (`compare: 'screen'`, por defecto): el cruce es una convención
  visual que solo vale en escalas compatibles, y es lo que el intérprete ve.
- **Caliper vs. trépano:** comparación **por valor** (`compare: 'value'`): derrumbe donde CALI > BS aunque el
  editor de 4b cambie la escala de una de las dos (con CALI en 10–30 y BS en 6–16, CALI = 12 in queda a la
  izquierda de BS en pantalla y sigue siendo derrumbe). La geometría se dibuja entre las dos curvas en pantalla; el
  lado y el punto de cruce salen de la diferencia de valores.

## D7. Superposiciones: contrato abierto para otros módulos

`ViewerOverlay` (`src/viewer/overlay.ts`): `{ id, label, layer: 'under' | 'over', track?, draw(frame), hit?(frame,
p), subscribe?(invalidar) }`.

- `draw` recibe el contexto 2D, el tema, el viewport (`yOf`, `depthOf`), las pistas (`xOf(rol | clave | null,
  valor)` y su inversa `valueOf`) y los datos comunes: profundidad, zonas, zona seleccionada, QC y, **en solo
  lectura**, el pozo, la interpretación y las curvas calculadas activos (una superposición de módulo no importa
  `src/app/store`). `frame.invalidate()` pide otro cuadro (vista previa en vivo).
- `hit` devuelve lo que hay bajo el puntero: tooltip, `activate` (clic), `range` + `doubleClick` (doble clic),
  **`drag`** y **`nudge`**:
  - `drag: { cursor?, move(p, start), end(p, start), cancel?() }`. Si al apretar hay un `drag`, el visor no panea:
    captura el puntero y, pasado el umbral de 4 px, llama a `move`; cerca de los bordes (28 px) la vista se desplaza
    sola y vuelve a llamar a `move` con la profundidad nueva; soltar llama a `end`; Escape, a `cancel`. Así se hacen
    sin tocar el núcleo los plugs de corona arrastrables, los topes de 4b y los puntos de una tendencia. **Elegir un
    tramo** es lo mismo: una superposición en modo selección devuelve un `drag` en cualquier punto (`start.depth` y
    `p.depth` son los extremos).
  - `nudge(deltaM)`: un clic o arrastre sobre el elemento lo deja **activo**; mientras lo esté, ↑/↓ lo mueven (paso
    de D8) en vez del cursor; Escape o apretar en otro lado lo sueltan.
- **Pista propia** (`track: { title, scale, unit?, width?, after?, workspaces? }`): el visor agrega una pista
  `kind: 'overlay'` (id `ov:<id>`, `overlayId`) donde pide `after`, con grilla y encabezado (título, extremos y
  unidad) de su escala; la superposición dibuja en esa caja. Presiones MDT, perfiles de temperatura, etc. Las pistas
  propias del usuario (fase 7) pueden incluirlas explícitamente; las de superposiciones que no existen se quitan.
- La lógica del puntero vive en `src/viewer/interaction.ts` (`PointerGestures`, sin DOM, con tests); el componente
  solo traduce eventos.
- Toda llamada a una superposición (`draw`, `hit`, `drag.*`, `activate`, `doubleClick`, `nudge`, `subscribe`) va
  aislada con `guard`: su error se registra y el visor sigue. Los ids son únicos: una de módulo que repite el id de
  otra (o de una incorporada) se ignora con aviso.

- Incorporadas y usadas por la app: **zonas** (bandas, topes con nombre, franja de zonas clicable) y **calidad**
  (tramos con derrumbe o caliper inválido rayados en las pistas con curvas de patín).
- Módulos: `src/modules/<id>/overlay.ts` que exporte `overlays: ViewerOverlay[]`, descubierto solo
  (`src/app/viewerOverlays.ts`, como los paneles a medida). El worker nunca lo importa.

Descartado:
- **Que cada módulo agregue pistas o capas tocando `render.ts`.** Viola "un módulo = una carpeta".
- **Superposiciones como componentes React (SVG/DOM sobre el canvas).** Simples de escribir, pero miles de puntos
  (plugs, selección del crossplot) en DOM no escalan y no comparten el viewport sin re-render.

## D8. Cursor, lectura y accesibilidad

- El cursor vive en el canvas de cursor; los valores se escriben directo en los encabezados (sin re-render de
  React) con `formatNumber` (4 cifras significativas) y la unidad canónica. La profundidad del cursor se publica en
  `useViewer` (`cursorDepth`) para el perfil radial y el crossplot conectado.
- Teclado (visor enfocado): ↑/↓ mueven el cursor **una muestra**, o las necesarias para avanzar al menos 2 px si a
  ese zoom una muestra mide menos (con el pozo entero a la vista, una muestra es 0,1 px y "una muestra" no se
  vería moverse); el cursor queda siempre sobre una muestra, así la lectura es exacta. Mayús ×10. Desplazan si sale
  de la vista. Con un elemento de superposición activo, ↑/↓ lo mueven a él (D7);
  Re Pág/Av Pág desplazan una pantalla; Inicio/Fin van al tope/base; +/− acercan/alejan sobre el cursor; 0 = ver
  todo; Escape cancela un arrastre, suelta el elemento activo o esconde el cursor. Una región `aria-live` anuncia
  (con demora) profundidad y valores. Al enfocar el visor con Tab el cursor aparece en el medio; un clic lo enfoca
  sin mover el cursor (lo maneja el puntero).
- Encabezados en una fila por curva (`CurveLegend layout="inline"`): extremo izquierdo, nombre y lectura sobre el
  trazo, extremo derecho; la unidad va al tooltip y a la lectura accesible. Las banderas usan el nombre corto del rol
  («Arcilla»).
- Mouse: rueda = desplazar; Ctrl+rueda o pinza = zoom centrado en el puntero; arrastre = paneo; clic en la franja
  de zonas (o en el nombre de un tope) = seleccionar la zona (`useUi.editingZoneId`), otro clic la deselecciona.

## D9. Pista volumétrica: una pila genérica por rol (fase 4b)

- Tipo de pista nuevo `kind: 'stack'` con `stack: StackSpec` (JSON en `src/core/display.ts`, se guarda y se valida
  al abrir). Una pila es una lista ordenada (de izquierda a derecha) de componentes: fracción = producto de
  `factors` (valor de un rol o `1 − valor`), un `rest` por nivel (lo que falta para cerrar a 1) y `children` que
  parten a su padre. La de Petrofísica (`VOLUMETRIC_STACK`): arcilla = VSH · matriz = resto · porosidad = PHIE,
  partida en agua = PHIE·SW e hidrocarburo = PHIE·(1 − SW). Geología declara otra pila (mineralogía PE–densidad) sin
  tocar el dibujante.
- Cálculo puro en `src/viewer/stack.ts` (con tests: cierre a 1, recortes, NaN, faltantes), en caché por spec e
  identidad de las entradas (resolver no lo repite si nada cambió). Entradas: la calculada activa gana a la medida
  (en unidad canónica); **nunca IGR como VSH**.
- Reglas: cada factor se recorta a [0, 1]; si un nivel suma más de 1 (VSH + PHIE > 1) se **normaliza** conservando
  proporciones y el resto queda en 0 (la columna no se sale ni cambia de orden; se descartó recortar en orden porque
  favorece arbitrariamente al primero). NaN en el primer nivel = hueco; en un hijo, el padre se ve entero en esa
  muestra. Si falta una entrada, ese componente no se dibuja y el resto se rotula «Resto sin partir» con un relleno
  neutro (`undivided`): con solo VSH se ve arcilla + resto, nunca una matriz inventada. Sin nada calculable, estado
  vacío que dice qué falta y en qué paso se calcula.
- Dibujo: cada capa es un relleno entre dos perfiles de fracción (la misma reducción M4 por fila y `fillBetween`
  que los rellenos de 4a), en color **opaco** (paleta mezclada con el fondo a su opacidad): los hijos tapan
  exactamente al padre y los colores no se ensucian. La leyenda del encabezado lee el volumen de cada componente bajo
  el cursor.

## D10. Edición de zonas sobre el perfil (fase 4b)

- Recetas puras en `src/core/state/zones.ts` (con tests) y `applyZoneEdit` en `project.ts`, que guarda en la
  interpretación: cambiar zonas cambia la firma de geometría del motor y **recalcula los parámetros por zona**.
- Ajuste a la **muestra** más cercana (convención de una columna ZONA: tope = primera muestra, base = última).
- **Frenar, no empujar.** Mover un borde frena en la vecina (queda a una muestra). Empujar en cadena puede deshacer
  trabajo en zonas que no se están mirando, y todavía no hay deshacer. Dos zonas **contiguas** (separadas a lo sumo por
  una muestra, como A–E del TP) comparten el contacto: se mueve como un solo borde y conserva la separación.
  Espesor mínimo 0,5 m (`MIN_ZONE_THICKNESS`) para la zona y para la vecina con contacto.
- **Marcar zona** (botón en la barra del visor y en el panel Zonas; Escape sale): arrastrar crea una zona acotada a
  la zona (o al hueco) donde empezó el arrastre: nunca se superpone ni borra otra. Dentro de una zona la parte en
  tres: arriba queda la original (id y parámetros), en el medio la nueva (`Z1`, `zoneColor`) y abajo un resto
  («C inf.») que **hereda los parámetros** de la original (es la misma roca). Un resto más delgado que el mínimo se
  suma a la nueva. Nombre, color y tipo se editan, y la zona se borra, desde el panel Zonas (`WellPanel`).
- Interacción: superposición `zones-tops` con `hit` → `drag` a ±5 px de una línea (cursor `ns-resize`, vista previa
  con la profundidad y los espesores, Escape cancela, `commit` al soltar con etiqueta en español) y en modo marcar,
  `drag` en cualquier punto. Teclado: cada borde es un `target` (D15).

## D11. Editor de escalas y colores (fase 4b)

- Clic o Enter en el encabezado de una curva → popover (`Popover` del sistema de diseño) anclado a la curva:
  mínimo, máximo, lin/log, invertir, color (`ColorPicker`), trazo, grosor, curva de respaldo, ocultar y restablecer.
- **Alcance explícito**: «esta curva» → `setCurveDisplay` (solo medidas: las calculadas no tienen id de curva) o
  «todas las curvas del rol» → `setRoleDisplay`. Si la curva tiene ajustes propios que tapan un cambio del rol
  (precedencia de D3), el editor lo avisa y ofrece quitarlos.
- Cada cambio válido se guarda al momento (recálculo en vivo; `display` no toca el motor). Lo inválido queda en el
  campo con el motivo (`src/viewer/curveEdit.ts`, con tests): log con mínimo y máximo > 0, mínimo ≠ máximo, mínimo
  < máximo (la inversión es un control aparte) y grosor de 0,5 a 6 px. Pasar a log con mínimo ≤ 0 propone la década
  por debajo de los datos. Una escala se guarda completa (tipo, mínimo y máximo), no campo por campo: así nunca queda
  una combinación que el resolver tenga que corregir.
- Las curvas ocultas dejan un contador en el título de la pista que las vuelve a mostrar.

## D12. Animación de carga (fase 4b)

- Al cargar un pozo (cambia `wellKey`) las curvas se "registran" de arriba hacia abajo en 1 s
  (`LOAD_ANIMATION_MS`, `src/viewer/animation.ts`) con la curva `--ease-standard` y un frente de acento. Más larga
  que las transiciones de la interfaz a propósito: es un gesto de registro, no de un control.
- Se implementa como un recorte del alto en `drawBase` (`FrameInput.reveal`): sin la animación el campo no existe y un
  cuadro normal no paga nada. Cualquier interacción (puntero, rueda, teclado, zoom, minimapa, Tab) la corta en el
  estado final. Con `prefersReducedMotion()` no se anima.

## D13. Minimapa y encabezado de pozo (fase 4b)

- **Minimapa** (`Minimap.tsx`, geometría pura en `minimap.ts`): columna de 42 px a la derecha, fuera del
  desplazamiento horizontal, con el pozo entero: zonas y una curva resumen (GR, o la primera de línea) como mínimo–
  máximo por fila de píxel. El rectángulo de la ventana visible lo mueve el visor en cada cuadro escribiendo estilos
  (`setWindow`, sin re-render). Arrastrarlo navega; un clic en otro lado centra la vista ahí y se puede seguir
  arrastrando. Es un `role="slider"` (↑/↓ un décimo de ventana, Re Pág/Av Pág una ventana, Inicio/Fin).
- **Encabezado** (`WellHeader.tsx`, campos en `wellHeader.ts`): una franja de 30 px con yacimiento, compañía, KB…
  (mnemónicos LAS y nombres en español), intervalo, paso, curvas medidas + calculadas y zonas (clic = mostrarla). Se
  despliega para ver todos los campos; se oculta desde el nombre del pozo en la barra (se recuerda por usuario). Un
  LAS sin metadatos muestra «sin metadatos» y lo que sí se sabe.
- Descartado: el minimapa como pista más (competiría por ancho con las curvas y se desplazaría en horizontal) y el
  encabezado como bloque alto al estilo de los perfiles impresos (le roba alto al perfil en pantalla).

## D14. Alternativas y encabezados en pistas angostas (fase 4b)

- Salidas en comparación (`active: false`): se dibujan en la pista de su rol, debajo de la activa, rayadas y al 60 %,
  con la etiqueta «alternativa» en el encabezado. No alimentan rellenos, `xOf` de superposiciones, pilas ni el
  minimapa: esos siguen a la fuente que alimenta la cadena.
- Encabezados: hasta 4 filas por pista; si hay más, las de abajo se agrupan en una fila «AT10 · AT20 +2» que abre la
  lista completa (también editable). Si todas las curvas de una pista comparten escala (resistividades 0,2–2000) los
  extremos se muestran **una vez** en una fila propia y cada curva queda con todo el ancho para nombre y lectura. En
  pistas de menos de 168 px, mientras hay cursor, los extremos por curva se ocultan y la lectura toma su lugar
  (consulta de contenedor; sin cursor vuelven). Así no se corta el valor y no se agrega alto.

## D15. Cambio del contrato de superposiciones: elementos del teclado (fase 4b)

4a dejó pendiente llegar a un elemento de una superposición solo con teclado: `hit` necesita coordenadas del
puntero, así que sin mouse no había forma de activar un tope o un plug. Se agregan tres campos **opcionales** (nada
existente cambia ni se rompe):

- `ViewerOverlay.targets?(frame): OverlayTarget[]` — `{ depth, hit }` por elemento. El visor crea un botón accesible
  por cada uno, en orden de profundidad después del cuerpo del visor: Tab los recorre; al enfocarlo lo trae a la
  vista y lo deja activo (↑/↓ → `hit.nudge`, Enter → `hit.activate`, Escape vuelve al perfil) y su nombre accesible es
  `hit.label`. El botón se ve solo con foco, como una pastilla sobre el elemento.
- `OverlayHit.key?` — identidad estable del elemento (la misma en `hit` y en `targets`).
- `OverlayFrame.active?` — `{ overlayId, key }` del elemento activo (teclado o último clic/arrastre), para que su dueño
  lo resalte.

Descartado: recorrer elementos con flechas dentro del visor (↑/↓ ya mueven el cursor y el elemento; habría que
inventar un modo), y botones DOM que reemplacen el `hit` (miles de plugs no escalan en DOM; acá solo se crean para
los elementos que la superposición elige exponer, p. ej. topes y bases).

## Consecuencias

- 4b agrega pistas nuevas como `kind` de pista con su dibujante (volumétrica), el minimapa como otro consumidor
  del viewport publicado, el editor de escalas escribiendo en `Project.display` y la edición de topes como una
  superposición con `hit` + `drag` + `nudge`.
- Fase 6: presiones MDT como superposición con pista propia; plugs de corona como superposición arrastrable sobre la
  pista de porosidad (`xOf('PHIE', φ)` / `valueOf`).
- Al abrir un proyecto, `display` se valida (`sanitizeDisplay`): lo inválido se descarta con aviso (toast) y el
  resto se conserva.
- `src/app/shell/trackTemplates.ts` desaparece: las plantillas viven en `src/viewer/templates.ts`.
- 4b: rendimiento medido como en 4a (zoom con Ctrl+rueda, scroll y paneo, 110 cuadros): TP ≈ 3,5 ms de media
  (p95 ≈ 5 ms), 50 000 muestras ≈ 5,8 ms (p95 ≈ 9 ms). La pila volumétrica con datos suma una reducción por borde de
  capa (≈ 8 perfiles), del orden de un relleno de 4a.
- Fase 6 (presiones MDT, plugs de corona) puede exponer sus puntos con `targets` para el teclado.
- Riesgo conocido: mover topes no tiene deshacer todavía (llega con el historial de `commit`); por eso frena y no
  empuja, Escape cancela y el umbral de arrastre es de 4 px.
