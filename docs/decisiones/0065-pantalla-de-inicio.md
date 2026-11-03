# 0065 — Pantalla de Inicio con la sarta 3D y entrada al pozo

- Estado: propuesta (rama `claude/inicio-cinematografico`, a revisar en el PR).
- Alcance: pantalla de Inicio (`src/app/home/`), arranque (`src/app/main.tsx`), acceso desde la barra superior y la
  paleta, extensión del renderizador de la sarta (`src/app/toolString/render3d.ts`).
- Parte de: 0032 (sarta: modelo y derivación), 0033 (vista 3D: escena pura, renderizador, formación), 0004 (sistema de
  diseño).

## Contexto

La app arrancaba directo en el espacio de trabajo con un pozo sintético cargado. Se pidió una primera pantalla con la
sarta de perfilaje 3D como protagonista, que invite a explorarla y a entrar al pozo con una transición breve hacia el
visor, sin duplicar la lógica de la sarta y sin romper el HTML único sin internet.

Acordado con la usuaria antes de empezar: (1) arrancar **sin pozo**, con Inicio como puerta de entrada; (2) Inicio
como **capa encima** del espacio de trabajo, que queda montado e inerte; (3) la entrada completa solo la primera vez
en la sesión y una breve las siguientes.

## D1. Inicio es una capa, no una ruta

`HomeRoot` se monta al lado del armazón (`App.tsx`), con `position: fixed` y `z-index: var(--z-home)` (50: arriba del
dock y los separadores, abajo de menús, diálogos y avisos). El armazón **no se desmonta**: visor, dock, inspector,
profundidad, zoom y pestañas quedan como estaban. Mientras Inicio tapa, el armazón está `inert` y `aria-hidden`; el
atributo lo pone una suscripción al store (`useHomeCover`), sin re-renderizar el armazón (medido: re-renderizarlo
costaba más que todo el resto del cierre). Los diálogos de carga y los avisos son portales en `body`: funcionan sobre
Inicio.

Estado en `src/app/home/store.ts` (interfaz, no se guarda): `phase` (`open` → `entering` → `leaving` → `closed`), `via`
(arranque o regreso) y `fullEntrySeen`. La cámara y la línea de tiempo viven en el renderizador. Con `phase: 'closed'`
Inicio está desmontado: no hay lienzo, bucle ni escuchas.

Descartado: **pantalla que reemplaza al armazón** (pierde el estado local del visor y obliga a re-montarlo al entrar:
el visor no estaría «listo para usar» al terminar la transición).

## D2. Arranque y acciones

- Sin pozo (arranque normal): «Cargar pozo» (principal; abre el diálogo de carga existente), «Abrir proyecto»
  (`pickProjectFile`) y «Ver demostración» (`loadDemoWell`, extraído del comando de la paleta para usarlo en los dos
  lados).
- Con pozo: «Entrar al pozo» (principal), «Cargar otro pozo», «Abrir proyecto» y «Explorar sarta» (cierra Inicio y abre
  el configurador de 0033 con la herramienta elegida seleccionada: la selección es la misma, `useToolStringUi`).
- Cargar un pozo, abrir un proyecto o ver la demostración **desde Inicio deja Inicio abierto**, ahora con la sarta de
  ese pozo y «Entrar al pozo»: la entrada no se reproduce sola (lo pide el brief) y así la sarta que se ve es la del
  pozo recién cargado. Esto ajusta lo conversado antes de empezar («al cargar se va directo al espacio de trabajo»): con
  esa regla, al abrir la app sin pozo la entrada al pozo casi nunca se vería. Queda a confirmar en el PR.
- Volver: la marca de la barra superior es el botón **Inicio** (con la barra compacta se lee «Inicio» junto a la
  marca) y la paleta tiene «Ir a Inicio». Al volver se cierra el configurador si estaba abierto (una sola vista 3D a la
  vez) y aparece con un fundido de 280 ms; la entrada no se repite en reversa.
- `?inicio=no` (y `?muestras=N`) arranca como antes, en el espacio de trabajo con el pozo de demostración: lo usan los
  scripts de `scripts/qa/` y las pruebas de rendimiento del visor.
- No hay «proyectos recientes»: el repo no los guarda y no se inventó almacenamiento.

Nombre del producto: el que ya tenía la barra y el `<title>`, «Interpretación de pozo».

## D3. La sarta: la misma derivación y el mismo renderizador

- Con pozo, la sarta sale de `useToolStringView()` (la misma caché y derivación que el configurador), el pozo y el
  calibre de `boreholeDiameter`, la formación de `wellColumn` (movida de `ToolStringView.tsx` a
  `toolString/wellColumn.ts` para usarla en los dos lados) y la escena de `buildToolStringScene`. El rótulo dice
  «Sarta de <pozo>» y si es derivada de las curvas o planificada.
- Sin pozo, una **composición de demostración** (`demoString.ts`: GR, densidad con calibre, neutrón, sónico, inducción
  con SP, en orden típico), rotulada «Demostración · Composición de demostración · no corresponde a ningún pozo
  cargado». Nunca se presenta como la sarta de un pozo.
- Explorar no cambia nada del proyecto: girar, seleccionar y pasar el puntero son estado de interfaz. La escena no toca
  el motor; solo se reconstruye su descripción (pura) cuando cambian la selección, el puntero, el tema o el pozo.
- `ShowcaseRenderer` (`home/showcase3d.ts`) **hereda** `ToolStringRenderer`: mismas geometrías, materiales, selección
  por rayos y liberación. Para eso la base ganó, sin cambiar su comportamiento por defecto: miembros `protected`, un
  grupo `content` del que cuelga la escena, `RendererOptions` (partes opcionales —regla, cáscaras, rótulos—, tope de
  densidad de píxeles, suavizado, sombras, fondo transparente), `onContextLost` y `draw()`. Las convenciones de 0033 se
  conservan: radios a escala real, largos comprimidos 5:1 (se dice en pantalla).

Descartado: **un segundo renderizador propio de Inicio** (duplicaría materiales y geometrías) y **opciones de
presentación dentro de la clase base** (mezclaría la lógica del configurador con la de Inicio).

## D4. Dirección de arte

- La sarta **acostada** (cabeza a la izquierda: se lee de arriba hacia abajo como un texto), apenas inclinada y con la
  cabeza hacia la cámara: en perspectiva (FOV 34°) la cabeza se ve más grande que la cola, profundidad sin exagerar
  medidas. Vertical, una sarta de decenas de metros y ~10 cm de diámetro es una aguja aun comprimida 5:1; acostada ocupa el ~60 % de la
  pantalla de escritorio.
- Fondo con profundidad en CSS (gradiente radial y sombra de apoyo que sigue a la caja de la sarta); el lienzo es
  transparente. Luz lateral desde arriba a la izquierda y contraluz desde atrás a la derecha; sin sombras proyectadas
  (no hay superficie que las reciba hasta que aparece la formación). Claro: exhibición de estudio (exposición 1,12,
  ambiente 1). Oscuro: pieza iluminada sobre fondo profundo (contraluz más fuerte y frío, relleno bajo).
- El violeta queda para la acción principal, la selección (el aro de vidrio de 0033, el borde de la ficha breve y la
  fila de herramientas) y el foco. Sin partículas, neón ni tarjetas de métricas.
- Ficha breve al seleccionar (nombre, qué mide —`ToolDef.description`—, curvas del pozo o, en la demostración, las que
  registra) con un enlace a la ficha completa del configurador. Debajo de la sarta, una fila con las herramientas
  (botones con el color de familia): sirve de leyenda y de selección por teclado.

## D5. Interacción

- Giro automático alrededor del eje de la sarta, una vuelta cada 90 s. El primer gesto (arrastrar, rueda o flechas
  con la escena enfocada) lo detiene para el resto de la visita. Sin giro con `prefers-reduced-motion`.
- Arrastrar gira la cámara alrededor del centro (sin desplazamiento lateral; acercar con límites). Clic selecciona.
- Escape: con la ficha abierta, la cierra; si no, entra directo al espacio de trabajo (con pozo). Durante la entrada,
  la salta.

## D6. Entrada al pozo

Una línea de tiempo en el renderizador (`enter(toolId, ms)`), con una sola curva por tramo:

1. 0–60 %: la sarta pasa de acostada a vertical y su giro vuelve a una vuelta entera (el corte de la formación mira a
   la cámara final).
2. 3–55 %: la cámara se acerca a la herramienta elegida (o a la primera de arriba si no hay ninguna), desde el lado del
   corte; el corrimiento de la proyección que la ubicaba a la derecha vuelve a cero.
3. 55–100 %: la cámara retrocede y sube (24°) hasta ver la tapa de la formación entera y el pozo con la sarta adentro;
   la formación aparece entre el 45 y el 85 %. Es la **misma formación de 0033** (capas por litología sugerida o GR,
   o neutra) y el texto dice «Corte conceptual del pozo: capas derivadas de los perfiles» (o solo «Corte conceptual»
   cuando es neutra).
4. Fundido del DOM hacia el espacio de trabajo, que ya responde (deja de estar inerte al empezar el fundido).

Duraciones (`ENTRY_TIMING`): completa 2,2 s + 0,52 s de fundido (la primera vez en la sesión); breve 0,7 + 0,24 s;
movimiento reducido o sin escena 3D: solo fundido de 0,14 s; saltar o Escape: inmediato. «Saltar animación» está a la
vista (con foco) durante la entrada.

Robustez: la entrada se ignora si no está en `open` (clics repetidos); `Promise.race` con un tope (recorrido + 1,5 s)
por si la escena no avanza; si la pestaña se oculta a mitad, la entrada termina en el acto (sin cuadros no avanzaría);
si la escena falla o se pierde el contexto, se entra igual. El tiempo sale de `performance.now()` en cada cuadro, no de
la marca del cuadro (misma base que el inicio de la línea de tiempo).

Descartado: **la entrada en reversa al volver** (lo pide el brief) y **una infraestructura de superficie** (fuera del
alcance de esta entrega).

## D7. Rendimiento y recursos

- El bucle existe solo mientras hay giro o entrada, y nunca con la pestaña oculta (`visibilitychange`). En reposo
  después de un gesto, render a demanda como el configurador.
- Densidad de píxeles hasta 1,5 (configurador: 2). Escena simple (sin suavizado, 1 píxel por píxel CSS) con ≤ 4
  núcleos, ≤ 4 GB declarados o puntero grueso, o con `?escena=simple`.
- Al cerrar: se detiene en el acto (`stop()`: bucle, línea de tiempo, escuchas) y se libera 120 ms después (`dispose`
  de la base: geometrías, materiales, texturas, ambiente, controles, contexto). Medido con SwiftShader: liberar el
  contexto bloquea ~0,9 s (`forceContextLoss`) más ~0,4 s al sacar el lienzo; diferirlo deja que el espacio de trabajo
  se pinte antes. En una GPU real es del orden de milisegundos.
- Sin WebGL 2, con error al iniciar o con el contexto perdido: **esquema 2D** en SVG hecho con la misma descripción de
  la escena (diámetros exagerados ×4, dicho en pantalla), que también selecciona; todas las acciones siguen andando.

## Medición

Entorno: contenedor Linux, Chromium de Playwright 1.56 sin pantalla, WebGL por **SwiftShader** (CPU), sobre
`dist/index.html` abierto por `file://`. Los tiempos sirven para comparar y para ver que no hay bucles; no representan
una GPU.

- Tamaño: `dist/index.html` 6.250.730 → 6.286.005 bytes (**+35,3 kB**, +0,56 %); con gzip -9, 2.700.555 → 2.709.287
  bytes (+8,7 kB). three ya estaba incluido; no hay imágenes, fuentes ni texturas nuevas.
- Cuadros con el giro automático, 1440×900: ~28 cuadros/s sin pozo y ~17–20 con el pozo de demostración (con
  SwiftShader; los primeros segundos después de cargar un pozo bajan a ~2 porque el motor comparte la CPU).
- Sin bucle: 0 pedidos de cuadro por segundo después de un gesto, con la pestaña oculta y en el espacio de trabajo
  después de entrar.
- Cierre (clic → Inicio desmontado), medido en la página: saltar 0,38 s, Escape 0,33 s, movimiento reducido 0,46 s,
  entrada breve 2,4 s (0,94 s nominales: cada cuadro con la formación tarda cientos de ms con SwiftShader).
- `scripts/qa/inicio.cjs`: 48 verificaciones (todas ok) y las capturas de `docs/capturas/inicio/`. El recorrido del TP
  (`scripts/qa/recorrido-tp.cjs`, con `?inicio=no`) sigue pasando: 10 pasos, 0 errores.

No probado: GPU real, Firefox, Safari, dispositivos táctiles reales, lectores de pantalla.

## Consecuencias

- La app arranca sin pozo. Los scripts de QA usan `?inicio=no`; quien abra el HTML ve Inicio.
- `ToolStringRenderer` es extensible por herencia; cambiar sus miembros `protected` afecta a Inicio.
- Puntos de extensión para iteraciones siguientes (sin implementar): la línea de tiempo de `enter` es una función de
  `k` (se le pueden sumar pasos, p. ej. animar una herramienta o la invasión); `RendererOptions.parts` permite mostrar
  las cáscaras de DOI en Inicio.

## Abierto

- Confirmar en el PR el ajuste de D2 (cargar desde Inicio deja Inicio abierto).
- Medir en una notebook con GPU integrada.
