# ADR 0085 · Lupa sobre el perfil (F17)

## Contexto

Con el pozo entero a la vista (1:10.000 a 768 px de alto) no se leen los detalles de un tramo: un cruce
densidad–neutrón de 2 m mide menos de un píxel. Acercar el visor pierde la vista general. F17 pide un recuadro que
siga al puntero con ese tramo a escala de detalle (1:200), sin salir de la vista general, a 60 cuadros por segundo con
el pozo del TP, con las mismas escalas, rellenos y superposiciones que el visor.

## Decisión

1. **Mismo renderer, otro viewport.** La lupa no dibuja nada propio: `LoupePainter` (`src/viewer/loupeView.ts`) arma
   un `FrameInput` con el viewport de detalle y llama a `ViewerRenderer.drawBase` y, encima, a `drawCursor` (que
   ganó `clear = false` para dibujarse en el mismo canvas). Hereda escalas (log en resistividad), rellenos, pilas,
   banderas, estilo clásico/moderno, cortina y todas las superposiciones registradas (zonas, tendencias, notas, MDT,
   corona, calco…) sin tocarlas. Tiene su propia instancia del renderer: sus buffers no compiten con los del visor.
2. **Escala de impresión real.** `pxPerMeterForScale(200)` a 96 ppp, la misma cuenta del selector de escalas y de las
   figuras: a 1:200 un metro mide 5 mm con el zoom del navegador al 100 %. La rueda recorre 1:50, 1:100, 1:200, 1:500
   y 1:1.000 (Ctrl+rueda sigue siendo el zoom del visor).
3. **Sin deformar en horizontal.** Las pistas conservan su ancho del visor. La lupa mide el 40 % del ancho visible
   (240–640 px) y 320 px de alto, con la columna de profundidad fija a la izquierda y, a continuación, las pistas que
   rodean al puntero: la ventana arranca en un borde de pista y contiene entera la pista bajo el puntero
   (`loupeStart`, `loupeColumns` en `src/viewer/loupe.ts`, puras y testeadas). Un encabezado de 20 px muestra la
   escala sobre la profundidad y el título de cada pista.
4. **Posición.** A la derecha del puntero (a la izquierda si no entra), centrada en su altura, siempre dentro del área
   visible del visor (`placeLoupe`). No toma el puntero (`pointer-events: none`). Sobre el visor general, un
   rectángulo de acento marca el tramo y las pistas que muestra (`loupeMark`, mínimo 4 px de alto).
5. **Mismo cuadro que el cursor.** No hay un requestAnimationFrame aparte: `paint()` del visor dibuja la lupa cuando
   redibuja el cursor, es decir, solo cuando cambia el puntero (o el cursor de teclado, el aumento, el desplazamiento
   horizontal o el cuadro base). Sin cursor, el recuadro se oculta.
6. **Tecla L.** Ninguna acción usa letras sueltas (solo «?» y combinaciones con Ctrl). Se registra con
   `useCommandSource` como acción del grupo «Visor» con atajo propio: la capa global la ignora al escribir en un
   campo o con un diálogo abierto, y aparece en la paleta («lupa», «detalle», «1:200») y en la hoja de atajos junto con
   la rueda y Esc. Esc la cierra antes que cualquier otro uso de Esc del visor (escucha en captura mientras está
   abierta), salvo que haya un diálogo o menú abierto.
7. **Interfaz pura.** Abierta o no es estado de React del visor; el aumento y la posición viven en refs. Nada va al
   proyecto ni al motor.

## Alternativas descartadas

- **Ampliar el canvas base con `drawImage`.** Barato, pero a 1:10.000 el canvas base es una reducción M4 (varias
  muestras por píxel): ampliarlo muestra píxeles, no el detalle de las muestras.
- **Un segundo `WellViewer`.** Reutiliza todo, pero monta encabezados React, gestos y minimapa por un recuadro que no
  se toca; redibujar sus props a cada movimiento del puntero cuesta mucho más que un `drawBase`.
- **Encoger todas las pistas al ancho de la lupa.** Se ve el juego completo, pero a 40 % del ancho las pistas quedan
  de 40–60 px: rótulos ilegibles y curvas apretadas. La ventana 1:1 alrededor del puntero es lo que hace una lupa.
- **requestAnimationFrame propio.** Dos cuadros pedidos por movimiento; el del cursor ya existe y llega en el mismo
  momento.

## Rendimiento

Medido con `scripts/qa/lupa.cjs` (Chromium de Playwright sin GPU, 1366 × 768, DPR 1, pozo del TP a escala de pozo
completo): dibujo de la lupa 0,8–0,9 ms de media (p95 1,3 ms); con un `pointermove` por cuadro durante 4 s, 58–60
cuadros por segundo (p50 y p95 de 16,7 ms) contra 60 sin lupa; con el mouse real de Playwright, 56–59. La máquina
compartida varía de corrida en corrida; los cuadros largos que quedan no coinciden con los cambios de columnas.

Dos hallazgos de la medición:

- **El visor redibujaba el canvas base en cada movimiento del puntero** (antes de la lupa): la superposición
  «Perfil radial fijado» (`src/modules/invasion-step/overlay.ts`) se suscribía a todo `pin.ts`, que avisa en cada
  movimiento del cursor. Ahora se suscribe solo a la profundidad fijada y al pozo (`subscribePinnedDepth`). Mover el
  puntero sin lupa pasó de 30 a 60 cuadros por segundo en el mismo entorno.
- **`will-change: transform` en el recuadro empeoraba**: una capa compuesta más costaba ~2 ms por cuadro de capas y
  commit; repintar el recuadro es más barato. Leer `scrollLeft`/`clientWidth` en cada cuadro forzaba recálculo de
  estilos: el desplazamiento horizontal se lee en el evento `scroll` y la lupa se dibuja antes de escribir las lecturas
  en el DOM.

## Consecuencias

- Una superposición nueva aparece sola en la lupa. Su `draw` corre una vez más por cuadro mientras la lupa está
  abierta: debe recortar a `frame.viewport` (lo hacen todas las actuales).
- `drawBase` asigna algunos objetos por cuadro (pistas para las superposiciones, `Path2D` de rellenos); la lupa no
  agrega más: reusa su viewport, su `FrameInput` y sus columnas, que solo se rearman al cruzar a otra pista.
- La lupa no recibe clics: para editar un tope a 1:200 hay que acercar el visor.
