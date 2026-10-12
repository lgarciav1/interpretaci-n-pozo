# 0015 — Parámetros elegidos sobre los gráficos (fase 7b, función Q)

- Estado: aceptada (fase 7b).
- Alcance: `src/plots/params.ts` (nuevo), `src/plots/crossplot/drag.ts` (nuevo), `XYHandle` y manijas 2D en
  `src/plots/xy/` (`layers.ts`, `XYPlot.tsx`, `axes.ts`, `xy.css`), paneles `HistogramPanel` y `CrossplotPanel`,
  `src/plots/data.ts` (`engineInputData`), `src/plots/controls.tsx` (`DriverCallout`), `src/app/plots/connect.tsx`
  (escritura por gesto, fuentes activas, «Usar …»), agrupado por gesto en `src/core/state/history.ts` y
  `src/app/store/project.ts`. Sin cambios en el visor multipista ni en el formato de proyecto.

## Contexto

La interpretación clásica elige parámetros mirando gráficos: GR limpio y GR de arcilla en el histograma de GR, el punto
de matriz en el densidad–neutrón y la recta de agua en el Pickett. La 7a dejó las líneas calculadas con los parámetros
del proyecto (0014, D7) y el mecanismo del cutoff real (0014, D3: alcance, vista previa en vivo, deshacer, teclado).
Falta que arrastrar esas líneas **sea** cambiar el parámetro, con recálculo en vivo de Vsh, φ, Sw, pay, sumario y visor.

## D1. Un elemento arrastrable = una función pura de sus parámetros y su inversa

Cada elemento tiene en `.ts` puro la ida (parámetros → posición en datos, la que ya dibujaba la plantilla) y la vuelta
(posición en datos → parámetros). El paso px ↔ datos lo hace el mismo mapeo que dibuja el gráfico (`xyMapping`) más
`movePointPx`, que conserva el desplazamiento entre el puntero y la manija (agarrar la recta lejos de su manija la
traslada sin saltos) y acota la manija al área. En ejes log un desplazamiento en px es un factor en datos, así que
trasladar una recta en log–log la mantiene recta.

| Elemento | Parámetros (clave de almacenamiento) | Ida → vuelta |
|---|---|---|
| Líneas de GR limpio y de arcilla (histograma de GR; plantilla GR–Rt) | `grClean`, `grShale` (compartidos, módulo `igr`) | guía vertical en x = valor ↔ x |
| Punto de matriz (densidad–neutrón) | `phi-density.rhoMa`, `phi-neutron.matrixOffset` | (NPHI, RHOB) = (−offset, ρma) ↔ offset = −NPHI, ρma = RHOB |
| Recta de agua, trasladar (Pickett) | `rw-manual.rwRef` | recta Sw = 1 por (Rt, φ) con m fija: Rw = Rt·φ^m / a → Rw de referencia (D3) |
| Recta de agua, rotar (Pickett) | `m` (compartido) | pivote en el corte con φ = 1 (Rt = a·Rw, fijo): m = (log(a·Rw) − log Rt) / log φ |

- **Offset ↔ NPHI de la matriz.** `phi-neutron` calcula φN = NPHI + offset (`neutronPorosity`, `src/petro/porosity.ts`),
  así que la matriz (φN corregido = 0) está en NPHI = −offset. Verificado en los tests con la función del motor.
- **La línea que sale de la matriz** es la del proyecto: los puntos donde la φ por densidad y la neutrónica corregida del
  motor coinciden (ρb = ρma − φ·(ρma − ρf), NPHI = φ − offset, con ρf de `phi-density`). Sus marcas cada 0,1 leen la
  porosidad del motor. Las rectas fijas de arenisca, caliza y dolomía quedan como referencia; el punto **se pega** a
  sus matrices si cae a menos del 1,5 % del eje (imán, `snapMatrixToLithology`).
- **Manijas del Pickett**: la de trasladar en el medio del tramo visible de la recta (en log), la de rotar cerca del
  extremo de φ baja. Si la recta quedó fuera del gráfico, la de trasladar va al centro (arrastrarla la trae). Durante el
  arrastre la manija sigue al puntero sobre la recta ya redondeada.
- **Acotar y redondear** como el slider del inspector (`normalizeParam` = `positionToValue` de `src/ui/scale.ts`): rango
  `min`–`max`, paso contado desde `min` en lineal y desde 0 en log (Rw). Las flechas usan `stepValue` (un paso; Mayús
  ×10). Además GR limpio queda al menos un paso por debajo de GR de arcilla.
- **Claves de almacenamiento**: los parámetros no compartidos se guardan como `módulo.clave` (`paramStorageKey`), no con
  la clave sola; `PLOT_PARAMS` lo resuelve en un solo lugar y un test lo fija.

Descartado: **un componente de gráfico especial para cada caso.** Las manijas son una capa genérica de `XYPlot`
(`XYHandle`): sirven para cualquier parámetro futuro que se elija sobre un gráfico x–y.

## D2. Alcance, vista previa y deshacer: los de la 7a

- **Alcance**: la regla de los cutoffs (0014, D3). Con exactamente una zona en el filtro del gráfico se lee y se escribe
  el valor de esa zona; si no, el global. Cada rótulo lo dice: «GR limpio global · 30,0 gAPI», «Matriz zona C ·
  2,65 g/cm³», «Rw global · 0,045 ohm·m a 24 °C», «m global · 2,00».
- **Vista previa en vivo**: cada movimiento escribe el parámetro (`commitPlotParams`) y el motor recalcula: Vsh, φ, Sw,
  pay, sumario y las pistas del visor cambian mientras se arrastra. Un movimiento que cambia dos parámetros (la matriz)
  es un solo `commit`.
- **Deshacer**: etiqueta del slider del inspector para un solo parámetro («Cambiar Rw», «Cambiar GR de arena
  limpia»), «Mover el punto de matriz» para la matriz.

### D2.1. Agrupado por gesto (cambio de núcleo, aditivo)

El agrupado de 0006 (misma etiqueta y menos de 800 ms) partía un arrastre con una pausa larga en varias entradas
(riesgo aceptado en 0014, D3). Ahora `commit(label, receta, { group })` acepta el id de un **gesto**: los cambios con la
misma etiqueta y el mismo gesto se funden sin límite de tiempo; un gesto siempre abre su propia entrada. `connect.tsx`
abre el gesto con el primer `preview` y lo cierra con `commit`; **Escape** (`cancel`) llama a `cancelGroup`, que vuelve
exactamente al proyecto de antes del gesto y quita su entrada (antes se escribía el valor inicial y quedaba una entrada
vacía). Las flechas mandan solo `commit` sin gesto, así que las teclas seguidas se agrupan por la ventana de 800 ms, como
el slider. Vale también para los cutoffs reales de la 7a. Verificado en Chromium: un arrastre con una pausa de 1,2 s es
un solo Ctrl+Z.

## D3. Rw: de la temperatura de formación a la de referencia

El parámetro es `rw-manual.rwRef`, Rw a la temperatura de referencia `tRef`. El motor la lleva a cada muestra con Arps
(`correct ? arpsResistivityC(rwRef, tRef, T) : rwRef`, `src/modules/rw-manual`), con T de la curva TEMP que alimenta el
módulo (`temp-gradient` o una medida). La recta del Pickett, en cambio, vive en condiciones de formación.

**Elección:** la temperatura representativa de los puntos visibles es la **mediana** de esa curva TEMP en los puntos
del gráfico (`engineInputData` + `representativeTemperature`), y la recta usa Rw_f = Arps(rwRef, tRef → T_rep), con la
misma función del motor. Al arrastrar, la Rw de formación leída se convierte de vuelta con la inversa exacta (Arps es una
razón: Arps(Rw_f, T_rep → tRef)), se acota y se redondea al paso y se escribe `rwRef`. Escribir y releer da la misma
recta (test con el motor). Sin corrección por temperatura (`correct = false`) Rw_f = rwRef.

- La recta se dibuja **desde los parámetros** (no desde la mediana de la curva RW como en la 7a): así la ida y la vuelta
  son exactas. Con un solo valor de Rw en los puntos visibles (una zona, o global sin valores propios por zona) coincide
  con la mediana de RW (con un número par de muestras la mediana promedia dos temperaturas vecinas: diferencia
  despreciable).
- El rótulo muestra los dos: «Rw global · 0,050 ohm·m a 24 °C» y «0,00803 ohm·m a 262 °C (formación)».
- Descartado: **T de la profundidad media.** Con un gradiente lineal da casi lo mismo, pero no respeta una TEMP medida ni
  el filtro de zonas; la mediana sobre los mismos puntos es la que corresponde a «la Rw que se lee en el gráfico».
- Descartado: **escalar `rwRef` por el cociente de medianas de RW.** No necesita TEMP, pero esconde la conversión de
  temperatura que la consigna pide explícita y falla si la RW activa no sale de `rw-manual`.

## D4. Fuente activa: avisar y ofrecer la acción, nunca cambiar en silencio

Si el módulo que usa el parámetro no es la fuente activa de su puerto (`result.sources`), mover el elemento no cambiaría
el resultado. `inactiveDriver(fuentes, puerto, módulo)` lo detecta y el panel:

- deja la manija **visible pero quieta** (borde punteado, `aria-disabled`) y muestra un aviso (`DriverCallout`) con la
  fuente activa y una acción explícita: «Usar Rw manual» (`RW` ← `rw-manual`), «Usar porosidad por densidad» (`PHID`),
  «Usar porosidad neutrónica» (`PHIN`), «Usar índice de arcilla por GR» (`IGR`);
- la acción es un `commit` (deshacer) que elige el módulo como fuente con `setSource` (y lo activa si estaba
  desactivado);
- con Rw de otra fuente, la recta de agua usa la mediana de la curva RW activa (como la 7a) y **rotar sigue
  funcionando** (m lo usan todos los métodos de saturación).

## D5. Accesibilidad y tamaño de interfaz

- Manijas en el DOM (`role="slider"`, `aria-roledescription="manija arrastrable"`, `aria-label` con qué cambia y cómo,
  `aria-valuetext` con el valor y la unidad), con Tab y flechas (dirección en pantalla: en el eje de densidad invertido,
  ↑ baja ρma). Rótulo visible con valor y alcance; su lado preferido es el que no suele tener datos (debajo de la matriz;
  abajo a la izquierda de la recta de agua) y se da vuelta cerca de un borde.
- Las líneas de GR son guías de la 7a con `removable: false` (Supr no las quita) y paso del parámetro.
- Medidas con `--ui-scale` y textos con tokens: verificado en Compacto, Normal y Grande.
- Las manijas no salen en las figuras exportadas; las líneas que mueven sí (son capas `lines`/`guides`).

Corregido de paso: las manijas del DOM (también las de cutoff de la 7a) se ubicaban con el mapeo del último dibujo, que
todavía no corrió cuando cambian los ejes (otra plantilla u otra curva): quedaban en el lugar viejo hasta un cambio de
tamaño. Ahora `XYPlot` calcula el mapeo en el render con los ejes actuales.

## Verificado y no verificado

- Tests: `tests/plots/params-drag.test.ts` (claves de almacenamiento, alcance, acotar/redondear, GR px ↔ valor, offset ↔
  NPHI con la función del motor, línea de la matriz contra φD y φN del motor, px ↔ (ρma, offset) con eje invertido,
  imán, recta de Pickett ↔ (Rw, m) ida y vuelta en px, Rw entre temperaturas con el motor, fuente activa, deshacer por
  gesto y cancelar).
- Chromium con el pozo de demostración (scripts y capturas en `/tmp/claude-0/pwscripts/7b-q/`): arrastrar GR limpio de
  30 a 46,5 gAPI cambia el sumario y la pista del visor; mover la matriz a (NPHI 0,05; 2,52 g/cm³) baja φ y el pay; trasladar
  la recta de agua (Rw 0,050 → 0,109 a 24 °C) y rotarla (m 2,00 → 2,37) cambian Sw; un Ctrl+Z deshace cada arrastre (con
  pausa de 1,2 s incluida) y deja el sumario igual al inicial; Escape vuelve sin dejar entrada; flechas en cada manija;
  aviso con «Usar Rw manual» al elegir Rwa como fuente; Compacto, Normal y Grande sin desplazamiento de página.
- No verificado: lectores de pantalla reales con las manijas 2D; Firefox y Safari; tacto.

## Pendiente

- ~~Rw con valores propios por zona y alcance global: la recta usa la Rw global y la escribe; las zonas con valor propio
  no cambian (igual que los cutoffs). Podría avisarse en el rótulo.~~ Hecho: aviso en el rótulo y una recta por zona (0021).
- Matriz con las cartas CP-1 tabuladas (curvas) en vez de rectas de mezcla, y un imán hacia esas curvas.
- Recta de agua con Rw de otra fuente: ofrecer «copiar esta Rw a la manual» antes de cambiar la fuente.
- Recta de agua y línea de la matriz en la capa de interacción durante el arrastre: hoy cada movimiento redibuja la
  escena (≈ 25 ms con 5 810 muestras, 0014 D6), además del recálculo del motor.
