# 0018 — Modelos de Sw lado a lado, fichas de zona y paleta de comandos (fase 7c, funciones C, W y E)

- Estado: aceptada (fase 7c).
- Alcance:
  - **C:** `src/viewer/swModels.ts` (nuevo), relleno `range` y selector por módulo en `src/core/display.ts`, `src/core/state/tracks.ts`
    y `src/viewer/resolve.ts`, herramienta en `src/viewer/catalog.ts`, relleno `modelSpread` en `src/ui/curves.ts`, acción
    `src/app/tracks/swModels.ts` y botón en el inspector del paso Saturación.
  - **W:** `src/modules/zone-cards/` (`model.ts` puro, `dock.tsx`, `zone-cards.css`).
  - **E:** `src/ui/commands.ts` (registro, búsqueda y atajos, puro), `src/ui/components/CommandPalette.tsx` y `command.css`,
    descubrimiento en `src/app/commands/index.ts` y las acciones en `src/app/shell/commands.ts`,
    `src/app/tracks/commands.ts` y `src/modules/crossplot/commands.ts`.
- Parte de: 0004 (sistema de diseño), 0005 (visor), 0007 (módulos de Sw y sumario), 0013 (tamaño de interfaz) y 0016 (pistas
  armables). Sin cambios en el formato del proyecto ni en el motor de cálculo.

## C. Modelos de Sw lado a lado

### C1. La comparación ya existía: la pista solo tiene que poder nombrar un módulo

`Interpretation.compare` hace que el motor calcule un módulo aunque no alimente la cadena; sus salidas llegan al visor
como curvas `active: false` (alternativas). Hasta ahora una pista pedía curvas por **rol** (`{ role: 'SW' }`), así que
las tres salidas de Sw caían en la misma pista como «SW», sin poder distinguirse ni dibujarse parejas (la alternativa se
dibuja translúcida y con la etiqueta «alternativa»).

- **Selector `{ role, module? }`.** Con `module`, la entrada toma solo la salida de ese módulo, activa o en comparación, y
  se resuelve como una curva más (no como alternativa). El encabezado muestra el modelo («Archie», «Simandoux»,
  «Indonesia») y no tres veces «SW». Una entrada sin `module` se comporta como siempre. `selectorKey` incluye el módulo
  (`r:SW@sw-archie`), `entryIndexFor` busca primero la entrada del módulo de la curva y `sanitizeSelector` lo conserva al
  abrir un proyecto (un proyecto anterior no tiene el campo: se abre igual).
- **Estilo propio por entrada** (la plantilla ya lo permitía): azul continuo (Archie), naranja rayado (Simandoux) y verde
  punteado (Indonesia). Se distinguen por color **y** por trazo; el contraste 3:1 contra el fondo lo asegura `ensureContrast`
  en cada tema. Escala 1 → 0 (la de la pista de Sw). Ancho 1,2 para que entre el título.
- Descartado: **una pista `overlay` con dibujo propio** (como la de presiones MDT). Habría quedado sin encabezados con
  nombres de curva, sin lectura del cursor, sin edición de escala y color, y fuera de la figura exportada (0012). Con curvas
  reales de una pista `curves` todo eso viene gratis.

### C2. La banda entre la mínima y la máxima es un relleno de la pista (`range`)

`{ kind: 'range', curve: 'SW', fill: 'modelSpread' }`: banda, muestra a muestra, entre la mínima y la máxima de las curvas de
ese rol que hay en la pista. `curveEnvelope` (puro) calcula las dos series; con menos de dos valores con dato en una muestra
no hay banda (una sola curva no tiene con qué compararse). `resolve` las convierte en **dos curvas sintéticas** y emite un
relleno `between` común, así el dibujo, el rendimiento (reducción M4) y la figura exportada no cambian. Los arrays se
reusan por identidad de las entradas (no se recalculan en cada resolución).

- Color lila translúcido (`modelSpread`): no se confunde con arcilla, arena ni hidrocarburo.
- Descartado: **sombrear entre dos curvas elegidas** (`between` Archie–Indonesia): la mínima y la máxima cambian de modelo
  según la profundidad.

### C3. Cómo se muestra

- **Catálogo** (`Armar pistas`, grupo «Curvas calculadas»): herramienta «Modelos de Sw». Disponible si algún módulo produce SW.
  Soltarla arma la pista; las curvas de los módulos que no están en comparación quedan sin resultado hasta activarla.
- **Acción «Ver modelos de Sw lado a lado»** (botón del inspector en el paso Saturación y entrada en la paleta de comandos):
  **un solo `commit`** que pone en comparación los módulos que faltan (menos la fuente activa, que ya corre) y agrega la pista
  después de «Porosidad · Sw» (`showSwModelsRecipe`, puro y testeado). Un Ctrl+Z deshace las dos cosas. Si la pista ya está,
  solo activa la comparación. El visor se desplaza hasta la pista (`data-track-id` en el encabezado).
- **No está en la plantilla de fábrica**: no hay lugar natural (el visor ya desplaza en horizontal con 10 pistas) y las tres
  curvas solo existen con la comparación activa. Se guarda con las pistas y las plantillas propias como cualquier otra.
- Riesgo conocido: la comparación **no se propaga aguas abajo** (pendiente de 0007: slots). Pay, sumario y volumen siguen la
  fuente activa; la pista muestra dónde difieren los modelos, no cuánto cambiaría el volumen.

## W. Fichas de zona

### W1. Pestaña «Zonas» del dock, sin recalcular nada

`src/modules/zone-cards/dock.tsx` (se descubre sola, como `dockPanels`). Lee lo que ya publican el sumario por zona
(`ZONE_SUMMARY`) y el volumétrico (`VOLUMETRICS`) del último resultado, y las curvas PHIE y SW activas para los minigráficos.
Las filas se ubican por **nombre de zona** (únicos, `validateZoneName`); «Total» no es de ninguna. Cada ficha: color y nombre,
tipo, tope–base y bruto, neto de reservorio, neto pay, N/G pay, φ y Sw del pay, volumen in situ y semáforo.

- **Volumen**, en las unidades del sumario y del volumétrico: petróleo en MMbbl (y Mm³ estándar), gas en Bcf (y MMm³). El sello
  dice que no aporta volumen; una zona sin fluido, «Sin fluido definido».
- **Minigráficos** en SVG (no canvas: son pocos, escalan solos con `--ui-scale` y heredan el tema): promedio por franja de
  profundidad dentro de la zona (`sparkSeries`, 48 franjas, los huecos cortan el trazo), profundidad hacia abajo. φ de 0 al
  percentil 99 de la curva redondeado (misma escala en todas las fichas para compararlas), Sw de 1 a 0 como en el visor (en las dos
  «bueno» queda a la derecha). Relleno suave: φ desde el borde izquierdo, Sw hacia el derecho en el color de hidrocarburo.
- **Clic = ir a la zona**: `useTrendsUi.requestRange(tope, base)`, el mismo pedido que usan las tendencias y el crossplot. No
  cambia la zona en edición (eso reubicaría los parámetros de los módulos como efecto secundario); el panel «Datos del pozo» y
  la franja de zonas siguen siendo la forma de editar una zona.
- **Grilla** `auto-fill` con mínimo de 272 px de Compacto (`× --ui-scale`): una columna en un dock angosto y varias en uno ancho.

### W2. Semáforo de pay: criterio simple y documentado

| Color | Condición | Texto |
|---|---|---|
| Verde | hay pay y no es marginal | Pay |
| Ámbar | hay pay, con **N/G pay < 10 %** o **menos de 1 m netos** | Pay marginal |
| Gris | zona con dato y 0 m de pay, o zona de tipo sello | Sin pay |
| Gris | el sumario no pudo clasificarla (sin muestras, sin cutoffs aplicables o sin Sw en todo el reservorio) | Sin dato |

`PAY_MARGINAL_NTG = 0,1` y `PAY_MARGINAL_THICKNESS = 1 m` están en `model.ts`. N/G pay = neto pay / bruto (lo calcula el
sumario). «Sin dato» no es «Sin pay»: el sumario ya distingue NaN de 0 (0007, D6) y la ficha lo respeta. El texto del semáforo
siempre está (no depende solo del color) y el criterio está en su tooltip.

## E. Paleta de comandos

### E1. Registro de acciones: fuentes que son funciones, descubiertas por archivo

`Command { id, title, group, keywords?, icon?, detail?, shortcut?, keys?, bind?, inInput?, inDialog?, run?, enabled? }`.
Una **fuente** (`CommandSource`) es una función que devuelve acciones; se evalúa cada vez que se abre la paleta o se pulsa una
tecla, así los títulos y el estado (el paso abierto, la plantilla aplicada, «Nada para deshacer») están siempre al día sin
suscripciones.

- **Desde dónde se registran:** un archivo `commands.ts` que exporte `commands: CommandSource` en una carpeta de `src/app/`
  o de un módulo (`src/modules/<id>/commands.ts`) se descubre solo (`src/app/commands/index.ts`, igual que `dock.tsx` con
  `dockPanels`): un módulo nuevo aporta sus acciones sin tocar el núcleo. Además, `registerCommandSource(id, fuente)` (con baja)
  y el hook `useCommandSource` para un componente que las tenga mientras está montado.
- **Validación:** ids repetidos (gana el primero, con aviso), acciones sin id, título o grupo, y fuentes que lanzan se ignoran
  sin romper la paleta. Un test importa el registro real y comprueba que estén todas las acciones pedidas, que los ids sean
  únicos y que los atajos capturados no se pisen.
- **Acciones incluidas:** ir a cada paso del flujo (según el espacio de trabajo); abrir cada pestaña del dock (las de los
  módulos entran solas); deshacer y rehacer (con el cambio que deshacen); guardar y abrir proyecto; exportar; snapshots (abrir
  y guardar uno ahora); cargar pozo, datos del TP y pozo de demostración; cambiar de pozo; tema (sistema, claro, oscuro);
  tamaño de interfaz; espacio de trabajo; ir a cada zona; marcar una zona nueva; mostrar u ocultar columnas y dock; armar
  pistas, aplicar la plantilla de fábrica o una propia, guardar las pistas como plantilla; modelos de Sw lado a lado; y una
  plantilla de crossplot por cada una (densidad–neutrón, Pickett, φ–Sw, GR–Rt).
- **Plantillas de crossplot:** la receta salió del menú del panel a `crossplotTemplatePatch` (`src/plots/crossplot/applyTemplate.ts`,
  pura) y la usan el panel y la paleta: hacen exactamente lo mismo, con el mismo mensaje si falta una curva.

### E2. Búsqueda difusa sin acentos

`fold` pliega cada carácter por separado (el texto plegado tiene **el mismo largo** que el original, así los índices sirven
para resaltar). Cada término de la consulta debe aparecer: puntaje 100 al comienzo del texto, 90 al comienzo de una palabra,
60 dentro de una palabra y 25 como subsecuencia (solo con 3 o más letras: «mdlsw» → «modelos de Sw»). El título pesa 1, las
palabras clave 0,75 y el grupo 0,5; los títulos cortos ganan a igualdad. Empates por orden de registro. Resaltado solo de
coincidencias pegadas. Descartado: una librería de búsqueda (el conjunto es de unos cientos de acciones y todo corre en el
navegador sin dependencias nuevas).

### E3. Atajos, sin pisar los existentes

- **Ctrl/Cmd+K** abre y cierra la paleta (también con el foco en un campo o con un diálogo abierto: no inserta texto).
- **«?»** abre la hoja de atajos; **Ctrl/Cmd+S**, **+O** y **+E** guardan, abren y exportan.
- **Reglas** (`commandForKey`, pura): nunca se captura una tecla mientras se escribe en un campo de texto, un área o un selector
  (`isTypingTarget`), ni con un diálogo abierto, ni si la acción está deshabilitada. Solo Ctrl+K lo pide expresamente.
- **Los atajos que ya existen no se tocan:** Ctrl+Z / Ctrl+Mayús+Z / Ctrl+Y los maneja `historyActions.ts` (en la paleta figuran con
  `bind: false`: se muestran, no se capturan), y Esc, las flechas del visor, las de las manijas y Alt+flechas de «Armar pistas»
  se documentan como entradas sin `run` (`keys`) solo para la hoja. Cada acción de la paleta muestra su atajo si lo tiene.
- Mac: `mod` es Cmd y los atajos se muestran como ⌘K, ⇧⌘Z.
- Descartado: **atajos de una letra** (G para ir a un paso, T para el tema): chocan con el foco del visor y con campos que
  aún no se detectan como de texto. La paleta cubre esos casos con tres pulsaciones.

### E4. Accesibilidad y diseño

La paleta usa el `Dialog` del sistema (foco atrapado, Esc cierra, el foco vuelve a donde estaba). El buscador es un `combobox`
con `aria-activedescendant` sobre una lista `listbox`; ↑/↓ eligen (con vuelta), Re Pág/Av Pág saltan de a seis, Intro ejecuta.
Se ejecuta **después de cerrar** (`setTimeout 0`) para que una acción que abre otro diálogo reciba bien el foco. Una región
`aria-live` anuncia la cantidad de resultados. Sin consulta se agrupa por tema; con consulta se muestra una lista plana por
relevancia con el grupo a la derecha. Todo con tokens y `--ui-scale` (el botón de la barra superior lo abre con el ratón).

## Consecuencias

- `CurveSelector` y `FillSpec` ganan un campo y un caso nuevos; los proyectos guardados antes de la 7c se abren igual, y una
  versión anterior que abra uno nuevo ignoraría `module` (la pista mostraría las tres salidas como «SW») y descartaría el relleno
  `range` con aviso (`sanitizeFill`).
- `useFlow.ts` expone `computeFlow` y `currentFlow` (el flujo con los stores de ahora, fuera de React) para las acciones.
- `tests/modules.test.ts` excluye `src/modules/*/commands.ts` de las fuentes puras (son de la interfaz, como `overlay.ts`).
- Pendientes: propagar la comparación de Sw aguas abajo (slots, 0007); acciones recientes y favoritas en la paleta; que los
  módulos puedan declarar sus atajos sin código de teclado propio.
