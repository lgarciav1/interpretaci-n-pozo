# 0021 — Gráficos conectados al perfil y Pickett interactivo (fase 8b, funciones F y G)

- Estado: aceptada (fase 8b).
- Alcance:
  - **F:** `src/plots/selection.ts` (nuevo, puro), `src/plots/link.ts` (selección única), `src/plots/useLink.ts` (lectura
    desde React), `XYPlot` (lazo, capa intermedia de resaltado, clic en una clase, `onEscape`), `HistogramPanel`,
    `CrossplotPanel`, `controls.tsx` (`SelectionSummary`), superposición `plot-link` (`src/modules/crossplot/overlay.ts`),
    `ViewerSlot` (ficha y Escape), `uiSync.ts` (otro pozo limpia), `src/modules/crossplot/commands.ts`, receta
    `excludeTrendPoints`/`includeAllTrendPoints` (`src/core/state/trends.ts`) y `OverlayPointer.shiftKey`
    (`src/viewer/overlay.ts`, `WellViewer.tsx`).
  - **G:** `src/plots/crossplot/pickett.ts` (nuevo, puro), `CrossplotPanel` (rectas por zona, zona acuífera, vista previa),
    `waterLineHandles` con posiciones (`drag.ts`), `CrossplotConfig.pickettWaterZones` (`src/core/plots.ts`, aditivo y
    validado al abrir), `XYHandle.labelOnActive`, `XYPointLayer.ring` y `XYLineLayer.preview` (`src/plots/xy/`).
- Parte de: 0014 (histograma y crossplot, D4 conexión con el visor), 0015 (parámetros sobre los gráficos), 0008
  (tendencias), 0005 (visor y superposiciones). Sin cambios en el motor ni en el formato de proyecto (el campo nuevo es
  opcional: un archivo anterior se abre igual y uno nuevo abierto por una versión anterior lo ignora).

## F. Gráficos conectados

### D1. Una sola selección, compartida, como máscara sobre las muestras del pozo

La 7a tenía tres cosas sueltas: el punto bajo el puntero, la clase bajo el puntero y el rectángulo del crossplot (tramos
fijos), cada una con su forma en `link.ts`. Ahora la **selección** es una sola, venga de donde venga:
`PlotSelection { source, depth, mask, count, runs, detail }`, con `mask` = `Uint8Array` de las muestras del pozo.

- **Por qué una máscara**: es lo único que entienden igual los tres lados. El visor la dibuja como tramos (`maskRuns`,
  medio paso a cada lado y huecos de una muestra unidos, como el rectángulo de la 7a), el crossplot la convierte en
  puntos de SU nube (`cloudMask`) y el histograma la cuenta con sus clases. No depende de los ejes ni del filtro del
  gráfico que la creó: un lazo en el densidad–neutrón se sigue viendo al pasar al Pickett o al histograma de GR. Antes la
  selección se soltaba al cambiar de ejes; ahora se conserva (solo el contorno del lazo deja de dibujarse si los ejes ya
  no son los mismos).
- **Una sola activa entre todas las fuentes**: elegir en otro lado reemplaza. Se lee de un vistazo («lo marcado es
  esto») y el visor no tiene que distinguir colores por fuente. `detail` guarda lo propio de cada fuente (formas del
  crossplot y sus ejes, clases y bordes del histograma, tramo del visor) para redibujarla y para **sumar** con Mayús.
- **Validez por pozo**: la selección guarda la identidad del array de profundidad; con otra (otro pozo, otra
  importación) no vale (`selectionFor`) y `uiSync` la limpia.
- Es estado de interfaz: no se guarda ni pasa por `commit` (no entra en deshacer).
- Descartado: **una selección por fuente que conviva** (crossplot, histograma y visor a la vez). Habría que mostrar en
  el visor tres juegos de tramos y explicar cuál es cuál; la intersección o la unión serían una operación más para el
  usuario. Si alguna vez hace falta («estos puntos Y este tramo»), se agrega como operación sobre máscaras.
- Descartado: **guardarla en el proyecto**. Es exploración; ensuciaría el historial y el archivo.

### D2. Crossplot: herramienta Rectángulo | Lazo, visible; Mayús suma

Un selector de dos opciones en el bloque «Selección» del panel aparte (recuerda la última en la sesión). Arrastrar elige
con la herramienta activa; **Mayús** al soltar suma a la selección vigente (unión de máscaras).

- El lazo se traza en px (un vértice cada 3 px, `simplifyPath` a 2 px al soltar) y se guarda en DATOS (sobrevive a un
  cambio de tamaño); el punto en polígono (`pointInPolygon`, regla par-impar) se evalúa en **fracciones de eje**, el
  espacio en que se dibujó: vale con ejes log e invertidos. Prefiltro por la caja del polígono.
- Descartado: **Alt + arrastre para el lazo**. No se descubre, y en Linux el gestor de ventanas toma Alt + arrastre.
- Descartado: **lazo siempre** (sin rectángulo). El rectángulo sigue siendo lo más rápido para «todo lo de la derecha del
  cutoff».

### D3. Histograma: clic en una clase; Mayús + clic suma o quita

Clic (sin arrastre) en una clase selecciona sus muestras dentro del filtro de zonas (`binsMask`: [borde, siguiente), la
última cerrada, igual que el conteo). Mayús + clic agrega la clase o la quita si ya estaba, mientras la selección sea de
ese histograma con las mismas clases (otra curva u otro binning empiezan una nueva). Las clases elegidas se marcan con
una franja y borde punteado en la capa intermedia.

### D4. Visor: Mayús + arrastre marca un tramo

En el visor el arrastre ya es paneo, arrastre de topes y de elementos de superposiciones; «Marcar zona» y «Tendencia»
son modos con botón. **Mayús + arrastre** en cualquier pista marca un tramo; al soltar pasa a ser la selección. La
superposición `plot-link` (la de mayor orden) lo ofrece desde su `hit` solo con Mayús, así que con Mayús gana a topes y
tendencias y sin Mayús no cambia nada de lo que ya existía.

- Hizo falta que el puntero de las superposiciones sepa si Mayús está apretada: `OverlayPointer.shiftKey` (aditivo; el
  visor lo toma de `pointerdown`/`pointermove`). Mayús no tenía uso con el puntero en el visor (solo ×10 en el teclado).
- Descubrible: con Mayús apretada el cursor pasa a cruz y el tooltip lo explica; los paneles del histograma y del
  crossplot lo dicen en su texto de ayuda; la hoja de atajos («?») lo lista; la ficha «Sel.» de la barra lo recuerda.
- Descartado: **un cuarto botón de modo** en la barra del visor. La barra ya se compacta por etapas (0013) y serían tres
  clics por tramo; queda como alternativa si se pide para tacto (hoy en tacto no hay Mayús: pendiente).
- Descartado: **arrastrar en la pista de profundidad**. Choca con el paneo (es el lugar natural para agarrar el perfil) y
  queda pegado a la franja de zonas, donde un clic edita la zona.

### D5. Cómo se ve en cada lado

- **Visor**: tramos tenues con marca en el borde (los de la 7a); el tramo del visor además lleva bordes punteados y un
  rótulo «7 952,5–8 183,0 m · 1 513 muestras» a la derecha de la pista de profundidad. Mientras se arrastra, vista previa.
- **Crossplot**: los puntos seleccionados a pleno y **el resto atenuado**. La nube se dibuja atenuada en la escena
  (cambia solo al prender o apagar el resaltado) y los seleccionados van en una **capa intermedia** de `XYPlot` (canvas
  entre la escena y la interacción): una selección nueva redibuja solo esa capa y el puntero no redibuja ninguna de las
  dos. El panel aparte dice cuántos de los seleccionados están en este gráfico («1 161 de 1 512»).
- **Histograma**: una serie más, «Selección», con el color de acento y relleno más marcado, superpuesta a las de las
  zonas (normalizada a su propio n si el gráfico está en %), y una fila «Selección» en los estadísticos.
- Ninguna de estas marcas sale en las figuras exportadas (la figura registra las capas originales; la capa intermedia,
  el lazo y las manijas no son capas).

### D6. Limpiar

- **Escape**: con el foco en el visor (último paso de su cadena de Escape, después de salir de modos y de soltar la
  tendencia elegida), en un gráfico (después de cancelar un arrastre o soltar el foco de un punto) y sin foco en ningún
  lado (escucha global que no actúa si otro ya usó la tecla, si hay un menú o diálogo abierto o el foco está en un campo).
  Los modos del visor ahora marcan la tecla como usada al salir, para que un mismo Escape no salga del modo Y limpie.
- **Botón** «Limpiar» en el resumen de la selección de cada panel, y la ficha «Sel. N» con × en la barra del visor
  (antes que la de zonas: si la barra no alcanza, se recorta lo otro).
- **Otro pozo** (o el mismo reimportado): `uiSync`.
- Paleta de comandos: «Limpiar la selección de los gráficos».

### D7. Excluir del ajuste los puntos seleccionados

En «Tendencias» del crossplot, cada tendencia por ajuste ofrece (con una selección vigente) «Excluir del ajuste los
puntos seleccionados» y, si tiene excluidos, «Volver a incluir». Receta pura `excludeTrendPoints` (suma las claves que no
estaban; sin nada nuevo devuelve el mismo proyecto) e `includeAllTrendPoints`; un solo `commit`, un Ctrl+Z. Solo se
excluyen las muestras que están en la serie de la tendencia (clave = profundidad redondeada, la de 0008). Resuelve el
pendiente de 0014. El contador «n excl.» va junto al modelo.

## G. Pickett interactivo

### D8. La zona acuífera es una elección del gráfico, no un tipo de zona

`CrossplotConfig.pickettWaterZones?: string[]` en `display.plots[pozo]` (saneado al abrir: textos, sin repetidos; ids
que ya no existen se ignoran al mostrar). Las zonas se eligen con fichas en el panel aparte del Pickett; sus puntos van
con **anillos** (capa densa `ring`: no tapan el color por la tercera curva).

- Descartado: **un `ZoneKind` 'acuífera' en el núcleo**. Tocaría `src/core/well.ts`, el lector de zonas y el sumario
  (¿una zona acuífera entra en el pay?), y la decisión «tomo E como Sw = 1 para calibrar» es del gráfico, no una
  propiedad geológica de la zona. Si más adelante otro módulo la necesita (contacto agua–petróleo), se promueve.

### D9. Ajuste de la recta: m por mínimos cuadrados recortados; Rw por la mediana

En una zona con Sw = 1, Archie da ln Rt = ln(a·Rw) − m·ln φ. `fitWaterLine` (`src/plots/crossplot/pickett.ts`). Revisado
numéricamente de forma independiente (numpy sobre los mismos datos): el código reproducía m, error estándar, puntos
usados y Rw; la revisión encontró los puntos de abajo, ya corregidos.

1. **Puntos limpios**: solo los de la zona acuífera con Vsh ≤ el cutoff de Vsh del alcance (si hay curva VSH; con menos
   de 5 limpios se usan todos y se avisa). Pickett vale para formaciones limpias: la arcilla baja Rt sin bajar φ
   efectiva y aplana la recta.
2. **Temperatura**: cada Rt se lleva a la temperatura de referencia con el factor de Arps del motor
   (`arpsResistivityC(1, tRef, T)`, muestra a muestra) antes de ajustar. El resultado es directamente la Rw de referencia
   que se escribe, sin pasar por una temperatura representativa, y la mediana de Sw que calcula el motor (que aplica
   Arps por muestra) queda en 1 salvo el redondeo del parámetro. (Antes: Rw a la temperatura mediana; en la zona E de
   267 a 274 °C quedaba en 1,003.)
3. **m** = −pendiente de mínimos cuadrados de ln Rt sobre ln φ (`fitTrend` 'power' de `src/petro/regression.ts`), con
   **recorte robusto** iterativo de los puntos a más de 3·1,4826·MAD de la recta: un tramo con hidrocarburo residual,
   un derrumbe o una capa arcillosa dentro de la «zona acuífera» no tuerce la pendiente. Se redondea al paso del parámetro
   antes de calcular Rw (la Rw es la de la m que se escribe).
4. **Rw** tal que la **mediana de Sw de Archie sobre los puntos retenidos** (los que dejó el recorte) sea 1:
   a·Rw = exp(mediana(ln Rt + m·ln φ)). Elegir una zona como acuífera significa pedir Sw = 1 ahí; con este criterio el
   motor la deja en 1 en mediana. Con el hidrocarburo recortado el sesgo es menor que con todos los puntos (+2,4 % contra
   +3,9 % con 15 % de hidrocarburo; +3,0 % contra +7,9 % con σ = 0,25). La **mediana** y no la media (que equivale a la
   ordenada de mínimos cuadrados con m fija): coinciden con residuos simétricos (0,2 % de diferencia), pero con
   hidrocarburo o asimetría la media sube ~40 % (en el TP, +38 % en E y +41 % en D).
5. **Si la zona no determina m** se **conserva m** y se ajusta solo Rw (paso 4 con el m vigente, recortando los puntos a
   más de 3 desvíos robustos de la mediana). Es la práctica habitual: con un solo nivel de porosidad la pendiente no está
   determinada, y escribir una m absurda arruinaría Sw en todo el pozo. El panel dice por qué. **Esa Rw queda
   condicionada a m** (es la ordenada en φ = 1: con m = 2 en lugar de 2,3 y φ ≈ 0,2, sale ≈ 50 % de más) y, si la zona
   tiene hidrocarburo, tiende a quedar **sobreestimada** (Rt sube → Rw sube → Sw sobreestimada: el lado conservador; con
   el recorte el efecto es de pocos puntos porcentuales). El panel lo dice.

**Criterios para aceptar m** — son **criterios prácticos, no estadísticos**: se eligieron para que el ajuste automático no
escriba una m que un intérprete rechazaría. Si no se cumplen todos se conserva m:

| Criterio | Valor | Por qué |
|---|---|---|
| Muestras independientes n_ef = n·(1 − ρ₁)/(1 + ρ₁) | ≥ 10 | Con muestras cada 0,15 m los residuos son casi copias (ρ₁ = 0,98–0,99 en D y E del TP: 936 y 348 muestras = ~4 y ~3 independientes). El error estándar de MCO supone independencia y subestima ~10 veces. ρ₁ sale de los residuos de muestras consecutivas retenidas; con menos de 5 pares se toma 0. |
| Espesor de los puntos usados | ≥ 5 m | Una o dos capas no determinan una pendiente; con 20 muestras (el criterio anterior) eran 3 m. |
| P90/P10 de φ | ≥ 2 | Atenuación por error en φ (abajo): con P90/P10 ≈ 2,3 y error de φ 0,02 se pierde ~14 % de m; con 1,35 (el anterior) hasta 40 % o más. |
| Error estándar de m, con n_ef | ≤ 0,12 | Intervalo de ±0,24 sobre m ≈ 2 (±12 %). |
| m dentro del rango del parámetro | 1–3,5 | Lo que el slider admite. |

**m por mínimos cuadrados es una cota inferior.** Con error en φ (la variable independiente) la pendiente de la regresión
de ln Rt sobre ln φ se atenúa. Simulación (m = 2, σ ln Rt = 0,08, φ uniforme, 200 repeticiones):

| P90/P10 de φ | error de φ 0,01 | 0,02 | 0,03 |
|---|---|---|---|
| ≈ 1,3 | 1,6 | 1,0 | 0,6 |
| ≈ 1,55 | 1,8 | 1,4 | 1,0 |
| ≈ 2,3 | 1,9 | 1,7 | 1,45 |

La atenuación no la delata ni el error estándar ni el R²: con error de φ 0,03 y P90/P10 = 2,9 el ajuste da m = 1,53 y Rw = 0,063
contra 2,0 y 0,030 reales, con error estándar 0,033 y R² 0,82. La **cota superior** es la pendiente de la regresión
inversa (φ sobre Rt), |m|/R²: acá 1,88, y el panel la muestra junto a m («1,53 (cota superior 1,88)»). Si están lejos, m
es poco confiable. MCO de ln Rt sobre ln φ sigue siendo la elección (es el mejor predictor de Rt dado el φ medido, que
es como se usa luego); lo que cambia es que se dice que acota por abajo.

**Dispersión.** `spread` = 1,4826·MAD de ln Rt alrededor de la recta, sobre todos los puntos. Una zona acuífera limpia da
0,05–0,2 (Rt ×1,05–1,2); sobre **0,3** el panel avisa: «la zona no se comporta como acuífera: Rt se dispersa ×X…»
(hidrocarburo, arcilla o capas distintas). En el TP todas las zonas dan 0,45–0,59 (×1,6–1,8).

**Sw = 1 en mediana.** La mediana de Sw de la zona acuífera es 1, pero la media queda en ~0,82–0,84 (zonas D y E del TP,
dispersión ~0,5, y el motor recorta Sw a 1); el 10 % de los puntos de E limpios tiene Sw < 0,5 con la Rw ajustada. No es un
error del ajuste: es la dispersión de Rt de la zona, que el aviso de arriba señala.

Escribe m (si se estimó) y la Rw de referencia (`rw-manual.rwRef`) con la **regla de alcance de 0015** (una zona filtrada →
esa zona; si no, global), en **un solo `commit`** («Ajustar la recta de agua a la zona acuífera», un Ctrl+Z). Antes de
escribir, la recta que quedaría se dibuja rayada («Ajuste zona acuífera», `XYLineLayer.preview`: no sale en la figura) y el
panel muestra m (con su cota superior), Rw de formación, **la Rw que realmente se escribe** (redondeada al paso 0,001 del
parámetro: ≈ 0,4 % a 0,07, hasta 5–10 % a 0,005–0,01), puntos usados, R² y dispersión. Si la Rw activa no es la manual, se
escribe solo m y se avisa (la acción «Usar Rw manual» de 0015 sigue). Si la Rw ajustada cae fuera del rango del parámetro se
avisa (se escribiría el extremo).

- **Temperatura**: con zona acuífera elegida, la recta se lee a la temperatura de la zona acuífera (mediana de TEMP de los
  puntos que fijan Rw —los limpios—, tanto en la vista previa como en la escritura), y el arrastre convierte con esa misma
  temperatura (ida y vuelta exactas). Sin zona acuífera sigue la de 0015 (mediana de los puntos visibles). Para leer cada
  zona a su temperatura está el Pickett por zona (D10).
- Descartado (anotado): **envolvente inferior** (recta por el borde SO de la nube, p. ej. percentil 10 de los
  residuos). Es la lectura correcta cuando NO hay una zona acuífera y la nube mezcla agua e hidrocarburo (la recta de
  agua es el borde de mínima Rt), pero en una zona elegida como acuífera deja casi todas sus muestras con Sw < 1: la
  mostraría con hidrocarburo. Queda como opción futura para pozos sin zona acuífera («Ajustar a la envolvente»).
- Descartado: **mínimos cuadrados ortogonales o de φ sobre Rt**. La regresión inversa exagera la pendiente y la ortogonal
  depende de la escala relativa de los errores, que no conocemos; en su lugar se muestra el par (MCO, inversa) como cotas.
- Descartado: **ajustar también a (tortuosidad)**. a y m están fuertemente correlacionados en una sola zona; a queda
  como parámetro elegido por el usuario (Humble 0,62/2,15, 0,81/2, 1/2).

### D10. Pickett por zona

Con **dos o más zonas filtradas** y al menos una con valores propios de la recta (Rw, m, a, n, T de Rw o la corrección por
temperatura; `ownPickettParams`), el gráfico dibuja **una recta de agua por zona** (color de la zona) con sus iso-Sw
(50, 30 y 20 %, más finas y punteadas, sin rótulo), cada una con los parámetros de su zona y leída a la temperatura de
sus puntos. Cada recta tiene sus dos manijas (ids `water-move:<zona>`, `water-rotate:<zona>`, repartidas a lo largo
para que no se tapen) y **arrastrarla escribe solo los parámetros de esa zona** (`waterLineDragWrites` con el alcance
de la recta; las zonas sin valor propio lo crean). Para que muchas manijas no tapen el gráfico, sus rótulos se ven con el
puntero, el arrastre o el foco (`XYHandle.labelOnActive`); el panel aparte lista Rw y m por zona («(global)» si la zona
no tiene propios). Vista previa en vivo, un Ctrl+Z por gesto y Escape como en 0015.

- La regla es explícita (filtro de dos o más zonas) y no un interruptor guardado: sin filtro o con una zona vale el
  alcance de 0015, que es lo que el usuario ya conoce.
- Con una recta por zona no se ofrece el ajuste a la zona acuífera (¿a qué recta?): el panel pide filtrar una zona o
  ninguna.

### D11. Alcance global con zonas que tienen valores propios (pendiente de 0015)

Con alcance global, el rótulo de cada manija avisa cuántas zonas visibles tienen valor propio de lo que mueve («la zona
C tiene Rw propio: no cambia», «2 zonas visibles (C, D) tienen m propio: no cambian») y el panel ofrece **«Una recta por
zona»** (filtra las zonas visibles, lo que activa D10).

### D12. Lo que no cambió de 0015

Manijas en el DOM con `role="slider"`, Tab y flechas (con una recta por zona, en el alcance de su zona), aviso de fuente
inactiva con «Usar Rw manual», conversión de Rw con Arps, agrupado por gesto y Escape.

## Rendimiento

Medido en Chromium sin GPU (headless), 1600 × 1000, tiempos de Playwright (incluyen su ida y vuelta):

| Caso | 5 810 muestras | 50 000 muestras |
|---|---|---|
| Lazo: 120 movimientos del puntero | 2,0 s (≈ 17 ms c/u) | 2,0 s |
| Soltar el lazo → selección en visor y crossplot | 0,24 s | 0,35–0,41 s (47 569 puntos dentro) |
| Puntero sobre el crossplot (2 cuadros por evento), sin / con selección | 36 / 34 ms mediana | 66 / 56 ms mediana |
| Mayús + arrastre en el visor, por movimiento | ≈ 90 ms | ≈ 100 ms |
| Soltar el tramo del visor → crossplot actualizado | 0,15 s | 0,16–0,18 s |

El puntero no se encarece con una selección activa (la capa intermedia no se redibuja con él). La vista previa del tramo
en el visor redibuja el canvas base en cada movimiento, igual que «Marcar zona» (medido: 3,0 s por 30 movimientos, el
mismo costo): es el contrato actual de las superposiciones (`frame.invalidate()`); ver Pendiente.

## Verificado y no verificado

- Tests: `tests/plots/selection.test.ts` (punto en polígono cóncavo y en estrella contra la búsqueda exhaustiva, con eje
  log e invertido, rectángulo, simplificación; tramo del visor → índices por bisección; máscara → tramos; nube ↔ muestras;
  clases → muestras con la última cerrada y el filtro; selección única por pozo; receta de exclusión sin duplicados ni
  entradas vacías) y `tests/plots/pickett.test.ts` (ajuste sin ruido exacto; con ruido σ = 0,08 y 15 % de hidrocarburo
  m ± 0,05 y Rw ± 3 %, y el recorte mejora a la MCO pura y la mediana de retenidos a la de todos; mediana de Sw del motor
  (`archieSw` de petro) = 1 exacta, también con la temperatura por punto (Arps del motor); caso a mano de 5 puntos; φ
  angosto, pocas muestras independientes (residuos autocorrelacionados), espesor, error estándar y m fuera de rango
  conservan m; a ≠ 1 en modo Rw; puntos nulos, negativos o NaN; m vigente errónea e hidrocarburo con m conservada
  (sesgo documentado); regresión con el pozo del TP por zona; valores propios, regla de una recta por zona, aviso del rótulo; arrastre de la recta de una zona que
  escribe solo esa zona, deja el global y las otras, y es un solo Ctrl+Z por gesto; flechas; configuración saneada).
- Chromium real (scripts fuera del repo) con el pozo de demostración y con `datos/pozo_tp_perfiles.csv` («Datos del
  TP»): lazo → 95 tramos en el visor; Mayús + arrastre → crossplot resaltado y serie «Selección» en el histograma; clic y
  Mayús + clic en clases («2 clases del histograma de GR»); Escape limpia; zona acuífera E → vista previa → «Ajustar» →
  Ctrl+Z vuelve y Ctrl+Mayús+Z rehace; una recta por zona con C, D y E (C con m propia); claro y oscuro; Compacto,
  Normal y Grande sin desplazamiento de página; sin errores en consola (se corrigió un aviso de React: `XYPlot`
  avisaba al dueño desde un actualizador de estado).
- **Resultado sobre el TP** (m = 2 y a = 1 de fábrica, temperatura del módulo de gradiente; Rt normalizada por Arps a
  24 °C; puntos limpios, Vsh ≤ 0,4; reproducido de forma independiente en numpy): **ninguna zona determina m**, así que
  siempre se conserva m = 2 y se ajusta Rw.

  | Zona | Limpios | m por MCO (cota superior) | n_ef | P90/P10 | Motivo de conservar m | Rw de referencia a 24 °C | Rw de formación | Dispersión |
  |---|---|---|---|---|---|---|---|---|
  | A | 303 | 0,08 (39) | 11 | 1,83 | φ angosto | 0,081 | 0,0136 a 250 °C | ×1,72 |
  | B | 232 | 0,31 (2,8) | 14 | 1,76 | φ angosto | 0,495 | 0,0814 a 255 °C | ×1,57 |
  | C | 37 | −0,39 (2,5) | 1,9 | 1,64 | pocas independientes | 0,101 | 0,0165 a 258 °C | ×1,80 |
  | D | 936 | 0,47 (16) | 4,7 | 1,62 | pocas independientes | 0,070 | 0,0112 a 263 °C | ×1,72 |
  | E | 348 | 0,02 (620) | 2,7 | 1,58 | pocas independientes | 0,068 | 0,0105 a 271 °C | ×1,60 |

  Los 936 y 348 puntos de D y E son ~5 y ~3 muestras independientes (ρ₁ = 0,99 y 0,985 a 0,15 m). Todas superan el aviso
  de dispersión (> 0,3): sus Rt no siguen una recta de agua, así que la Rw de E (0,068, antes 0,072 con la mediana de todos
  los puntos y la temperatura mediana) es la mediana de Rt·φ² de la zona, condicionada a m = 2, y no una Rw confirmada. La
  temperatura de 271 °C sale del gradiente por defecto y está fuera de la carta de Arps (el rótulo ya lo avisa, 0015).
- Corregido de paso: el histograma anidaba los grupos «Zonas» y «Cutoff» dentro del de GR (no se veían con otra curva).
- No verificado: tacto (no hay Mayús: ni sumar ni tramo del visor), lectores de pantalla con la ficha y el lazo (el lazo
  no tiene equivalente de teclado), Firefox y Safari, exportar la figura con una selección activa (por construcción no
  sale; sin test de componente).

## Pendiente

- Equivalente de teclado y de tacto para el lazo y para el tramo del visor (p. ej. un botón «Seleccionar tramo» en la
  barra que arme el modo, y en el teclado marcar tope y base con el cursor).
- Vista previa del tramo del visor sin redibujar el canvas base (una capa de interacción para superposiciones, también
  para «Marcar zona»).
- Operaciones entre selecciones (intersección «estos puntos en este tramo», quitar con un modificador).
- Pickett sin zona acuífera: «Ajustar a la envolvente» (percentil bajo de los residuos) como alternativa explícita (D9).
- Ajuste a la zona acuífera con una recta por zona (¿qué zona recibe?); hoy se pide filtrar una o ninguna.
- Marcar en el gráfico los puntos excluidos de una tendencia del crossplot (hoy solo el contador).
