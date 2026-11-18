# Masterplan: funciones nuevas (calidad de vida, validación y lucimiento)

- Estado: **en ejecución.** Hechas: F01, F02, F08, F16, F25, F19, F03, F04, F07, F05. Cada función se marca en la tabla de la sección 3 a medida que se entrega.
- Fecha: 2026-11-17. Base inspeccionada: `main`, commit `c74ba09`.
- Origen: auditoría de la app corriendo con los datos del TP (recorrido con Playwright a 1600 × 900) y del código.
- Entrega del TP: diciembre de 2026. **No entra todo.** La sección 4 fija el orden y la línea de corte.
- Lectura complementaria: [arquitectura](arquitectura.md), [masterplan de preparación y DRX](masterplan-preparacion-y-drx.md)
  (sus invariantes I01–I08 siguen valiendo para todo lo que toque curvas preparadas).

## 1. Qué encontró la auditoría

Los seis módulos obligatorios del profesor están completos. Tres problemas vistos al usar la app:

| Hallazgo | Evidencia | Lo resuelve |
|---|---|---|
| Recargar la pestaña pierde todo el trabajo | Con el pozo del TP cargado, recargar vuelve al pozo sintético. No hay `beforeunload` ni guardado en el navegador; `localStorage` solo guarda tema y disposición. | F01 |
| El flujo marca 11/11 completo apenas se carga el pozo | Todos los pasos se calculan con valores de fábrica; «Completo» no distingue calculado de revisado. | F08 |
| Avisos es una lista plana de 30 renglones | `DiagnosticsPanel` (`src/app/shell/dockPanels.tsx`) pinta `level` y `message`, sin agrupar ni navegar. | F02 |

## 2. Reglas de ejecución

1. **Una función = una rama + un PR.** La app queda funcionando en cada commit (regla de `CLAUDE.md`).
2. **Decisión antes que código** cuando la ficha dice «ADR»: un archivo en `docs/decisiones/` (el próximo número libre es
   `0071`) con contexto, decisión y alternativas descartadas.
3. **Motor puro con tests.** Todo cálculo nuevo va en `src/petro/` (o `src/ml/`), sin UI, con tests de Vitest contra un
   resultado conocido. Lo revisa un subagente distinto del que lo escribió.
4. **Los módulos obligatorios ganan.** Si una función compite por lugar o por tiempo con uno de los seis, se posterga.
5. **Las ecuaciones solo en Ecuaciones.** Un módulo nuevo trae su `docs` para esa pantalla; la interfaz no las muestra.
6. **Formato de proyecto.** Todo campo nuevo en `Interpretation` o `Project` es opcional y JSON puro, para que los
   proyectos guardados sigan abriendo. Si hace falta una migración real, va con fixture del formato anterior.
7. **Verificación mínima por PR:** `npm run typecheck`, `npm test`, `npm run build` (el HTML único sigue abriendo con
   doble clic y sin internet) y capturas en `docs/capturas/<función>/` a 1366 × 768, claro y oscuro.
8. **Al terminar:** actualizar la columna Estado de la sección 3 y, si cambia un contrato, `docs/arquitectura.md`.

Subagentes según la tabla de `CLAUDE.md`. Cada ficha nombra quién escribe; quien revisa es siempre otro.

## 3. Tabla general

Tamaño: **C** chico (una sesión corta), **M** mediano (una sesión), **G** grande (más de una sesión o riesgo técnico).

| ID | Función | Tanda | Tam. | Escribe | Depende de | Estado |
|---|---|---|---|---|---|---|
| F01 | Autoguardado y «Recuperar sesión» | 0 | C | desarrollador-ui | — | hecha ([0071](decisiones/0071-autoguardado.md)) |
| F02 | Avisos agrupados y navegables | 1 | C | desarrollador-ui | — | hecha ([0072](decisiones/0072-avisos-agrupados.md)) |
| F08 | Estado «revisado» por paso | 1 | C | desarrollador-ui | — | hecha ([0073](decisiones/0073-estado-revisado.md)) |
| F16 | Resistividad mojada (R0) en la pista | 1 | C | analista-numerico | — | hecha |
| F25 | Copiar contexto para un chat | 1 | C | investigador | — | hecha |
| F19 | Cronómetro del recorrido | 1 | C | desarrollador-ui | — | hecha |
| F03 | «¿De dónde sale este número?» | 2 | M | arquitecto | — | hecha ([0074](decisiones/0074-de-donde-sale.md)) |
| F04 | Capas de pay y punzados sugeridos | 2 | M | analista-numerico | — | hecha |
| F07 | Vistas guardadas y modo defensa | 2 | M | arquitecto | — | hecha ([0075](decisiones/0075-vistas-guardadas.md)) |
| F05 | Notas ancladas a profundidad | 2 | M | desarrollador-ui | — | hecha ([0076](decisiones/0076-notas-profundidad.md), [PR #89](https://github.com/lgarciav1/interpretaci-n-pozo/pull/89)); apertura file:// pendiente, integración autorizada con esa limitación |
| F20 | Reparar la densidad en los derrumbes | 3 | G | analista-numerico | — | hecha ([0077](decisiones/0077-reconstruccion-densidad.md), [PR #90](https://github.com/lgarciav1/interpretaci-n-pozo/pull/90)); integración autorizada expresamente con apertura file:// pendiente |
| F22 | Torneo de modelos contra la corona | 3 | G | analista-numerico | [0078](decisiones/0078-torneo-modelos-corona.md) | [hecha, PR #91](https://github.com/lgarciav1/interpretaci-n-pozo/pull/91); integración autorizada con file:// pendiente |
| F21 | Saturación por altura (MDT + SCAL + perfil) | 3 | M | analista-numerico | [0079](decisiones/0079-saturacion-por-altura.md) | hecha ([#92](https://github.com/lgarciav1/interpretaci-n-pozo/pull/92), apertura local pendiente) |
| F14 | Entrenador: pozo con respuesta conocida | 3 | M | analista-numerico | [0080](decisiones/0080-entrenador.md) | pendiente de apertura local ([evidencia](validacion/2026-11-18-f14.md)) |
| F17 | Lupa sobre el perfil | 4 | M | arquitecto | — | pendiente |
| F18 | Curva fantasma | 4 | M | arquitecto | — | pendiente |
| F06 | Curva calculada por fórmula | 4 | G | arquitecto | — | pendiente |
| F15 | Bandas de incertidumbre sobre las curvas | 4 | G | analista-numerico | — | pendiente |
| F09 | Pegar topes desde una planilla | 4 | C | investigador | — | pendiente |
| F10 | Contacto MDT como tope de zona | 4 | C | desarrollador-ui | — | pendiente |
| F11 | Rangos de ejes del crossplot a mano | 4 | C | desarrollador-ui | — | pendiente |
| F26 | Asistente sin modelo | 5 | M | desarrollador-ui | F25; mejor con F03 y F04 | pendiente |
| F23 | Perfilaje en vivo | 5 | G | arquitecto | — | pendiente |
| F24 | Pozo 3D con calibre e invasión calculados | 5 | M | arquitecto | — | pendiente |
| F12 | Gráfico de Hingle | cond. | C | desarrollador-ui | — | solo si la materia lo pide |
| F13 | Saturación de Waxman–Smits | cond. | M | analista-numerico | — | solo si la materia lo pide |

## 4. Orden y línea de corte

| Tanda | Qué busca | Funciones | Orquestador sugerido |
|---|---|---|---|
| 0 | No perder trabajo | F01 | Opus medio |
| 1 | Mucho valor por poco esfuerzo | F02, F08, F16, F25, F19 | Opus medio |
| 2 | Lo que más luce en la defensa | F03, F04, F07, F05 | Opus alto para F03 y F07; Opus medio el resto |
| 3 | Validar la interpretación con datos | F20, F22, F21, F14 | Opus medio, con `analista-numerico` y revisión aparte |
| 4 | Herramientas del visor y de los gráficos | F17, F18, F06, F15, F09, F10, F11 | Opus alto para F17, F18 y F06 |
| 5 | Impacto visual | F26, F23, F24 | Opus alto para F23 y F24 |

**Línea de corte recomendada para diciembre: tandas 0, 1 y 2, más F20.** Son las que arreglan lo que hoy falla, las
que responden preguntas de la defensa y la única función que mejora la porosidad en los tramos malos del pozo del TP.
El resto se hace solo si sobra tiempo, en el orden de la tabla. Dentro de una tanda el orden es el de la lista.

## 5. Fichas

Cada ficha dice qué hace, dónde engancha en el código de hoy (punto de partida, a confirmar al empezar), qué hay que
decidir antes y cuándo está terminada.

### Tanda 0

#### F01 — Autoguardado y «Recuperar sesión»
- **Qué hace:** guarda el proyecto en el navegador a los pocos segundos de cada cambio; Inicio ofrece «Seguir donde
  quedaste»; la barra superior muestra «guardado hace N s» o «cambios sin guardar»; aviso al cerrar la pestaña con
  cambios que no están ni en el archivo ni en el autoguardado.
- **Engancha en:** `serializeProject` / `deserializeProject` / `recoverProject` (`src/core/state/serialize.ts`),
  `src/app/projectFiles/` (el worker de archivo), `src/app/shell/projectActions.ts`, `src/app/store/project.ts`,
  `src/app/home/` (Inicio).
- **Decidir (ADR):** IndexedDB y no `localStorage` (el proyecto del TP pesa más que el cupo típico). Comprobar que
  funciona abriendo `dist/index.html` por `file://` en Chrome, Edge y Firefox; si un navegador lo niega, la app sigue
  igual y solo avisa al cerrar. Cuántas copias se guardan (propuesta: la última por proyecto) y cómo se descartan.
- **Terminado cuando:** recargar con el pozo del TP interpretado lo recupera con zonas, parámetros, presiones, corona,
  snapshots e historial de deshacer vacío; un autoguardado dañado no impide arrancar; el guardado no traba la interfaz
  (serializa fuera del hilo principal o con espera); test del ciclo guardar → recuperar.

### Tanda 1

#### F02 — Avisos agrupados y navegables
- **Qué hace:** agrupa los avisos por paso del flujo y por módulo, filtra por gravedad, y un clic abre el paso del
  módulo y lleva el visor a la zona nombrada. Permite marcar un aviso como «visto».
- **Engancha en:** `Diagnostic` (`src/core/engine/graph.ts`) ya trae `level`, `code`, `moduleId` y `port`;
  `DiagnosticsPanel` (`src/app/shell/dockPanels.tsx`); `stepsOfModule` (`src/app/flow/flow.ts`) da el paso de un módulo;
  los comandos «Ir a la zona X en el visor» ya existen.
- **Decidir:** la zona hoy va solo dentro del texto del mensaje. Sumar `zoneId?` y `depth?` opcionales a `Diagnostic` y
  completarlos en los módulos que avisan por zona, en vez de leer el texto.
- **Terminado cuando:** los 30 avisos del TP se ven en grupos plegables con contador; cada aviso con zona salta al
  visor; «visto» se guarda en el proyecto y se reinicia si el aviso cambia.

#### F08 — Estado «revisado» por paso
- **Qué hace:** distingue en la barra del flujo los pasos calculados con valores de fábrica de los que la usuaria tocó
  o marcó. El contador pasa a decir, por ejemplo, «11 calculados · 4 revisados».
- **Engancha en:** `evaluateStep` (`src/app/flow/flow.ts`), `FlowProgress.marks` y `setStepMark`
  (`src/core/state/project.ts`), `ParamState` (`src/core/params.ts`: lo ausente es valor de fábrica), `FlowBar.tsx`.
- **Decidir:** un paso cuenta como revisado si algún parámetro de sus módulos difiere del valor de fábrica, si se
  eligió una fuente, o si tiene la marca manual que ya existe. No agregar un estado que haya que mantener a mano.
- **Terminado cuando:** recién cargado el TP ningún paso de módulos figura como revisado; mover un slider de Cutoffs
  marca ese paso; `tests/flow.test.ts` cubre los casos.

#### F16 — Resistividad mojada (R0) en la pista de resistividad
- **Qué hace:** dibuja la resistividad que tendría la roca con 100 % de agua y rellena la separación con Rt: donde se
  abren hay hidrocarburo. Es el quick-look de libro.
- **Engancha en:** módulo nuevo `src/modules/r0/` (entradas PHIE y RW; `a` y `m` compartidos con Archie, con la marca
  «compartido» que ya existe), función pura en `src/petro/saturation.ts`, relleno entre curvas (`src/viewer/fills.ts`)
  y plantilla de fábrica (`src/viewer/templates.ts`).
- **Terminado cuando:** con Sw = 1 por Archie, R0 = Rt (test numérico); en la zona acuífera del pozo sintético las dos
  curvas se superponen; el relleno aparece solo donde Rt > R0; figura en Ecuaciones.

#### F25 — Copiar contexto para un chat
- **Qué hace:** un botón arma un resumen en texto del pozo (encabezado, zonas, métodos y parámetros efectivos, sumario,
  avisos) listo para pegar en un asistente externo. No envía nada: solo copia.
- **Engancha en:** el modelo del informe (`src/app/report/report.ts`) ya reúne zonas, métodos, parámetros, tablas y
  advertencias; el copiado con respaldo para `file://` está en `src/modules/well-reading/panel.tsx`.
- **Terminado cuando:** el texto del TP entra en un mensaje (tope de tamaño fijado y probado), se entiende sin la app
  abierta y hay un comando en la paleta. Test del armado del texto.

#### F19 — Cronómetro del recorrido
- **Qué hace:** reloj discreto desde que se carga el pozo hasta que se abre el sumario, opcional, con el tiempo anotado
  en el informe. Muestra en vivo la meta de «un pozo en menos de 5 minutos».
- **Engancha en:** `src/app/store/ui.ts`, `FlowBar.tsx`, opciones del informe (`ReportOptions`).
- **Terminado cuando:** arranca y frena solo, se puede ocultar, no entra en el historial de deshacer ni en el proyecto.

### Tanda 2

#### F03 — «¿De dónde sale este número?»
- **Qué hace:** clic en una profundidad y en una curva calculada abre la cadena completa (por ejemplo GR → IGR → Vsh →
  φ → Rw → Sw) con el valor de cada eslabón en esa muestra, el método, la fuente elegida y los parámetros de esa zona,
  con enlace a la entrada de Ecuaciones.
- **Engancha en:** el plan del grafo (`src/core/engine/graph.ts`: fuentes y orden), los resultados
  (`src/app/store/results.ts`), parámetros por zona (`src/core/params.ts`), `src/app/ecuaciones/open.ts`, el menú
  contextual del visor (`src/viewer/contextMenu.ts`) y el contrato de panel (`src/ui/dockPanel.ts`).
- **Decidir (ADR):** no recalcula nada: lee los valores ya publicados en el índice de la muestra y recorre el grafo
  hacia arriba desde el puerto elegido. Qué se muestra cuando una entrada es una curva medida, una alternativa o un
  dato faltante.
- **Terminado cuando:** para Sw en una muestra del TP, los valores de la cadena coinciden con las curvas del visor y
  reemplazados a mano en la ecuación dan el resultado; funciona para cualquier curva calculada sin código por módulo;
  mover un parámetro actualiza el panel en vivo.

#### F04 — Capas de pay y punzados sugeridos
- **Qué hace:** tabla de tramos continuos de pay (tope, base, espesor, φ, Sw, k·h), con espesor mínimo y tolerancia a
  intercalaciones finas, ordenada por k·h. Un clic lleva el visor al tramo; los tramos elegidos se marcan en el perfil.
- **Engancha en:** `src/petro/flags.ts`, `src/petro/summary.ts`, `src/petro/flowCapacity.ts`; función pura nueva
  (`src/petro/payIntervals.ts`) y módulo `src/modules/pay-intervals/` en el paso Sumario; superposición
  (`src/modules/pay-intervals/overlay.ts`); el salto a tope y base ya lo hace «Lectura automática del pozo».
- **Terminado cuando:** la suma de espesores de los tramos coincide con el neto pay del sumario cuando el espesor
  mínimo es cero; tests con casos de borde (tramo en el límite de zona, intercalación de una muestra); exporta a Excel.

#### F07 — Vistas guardadas y modo defensa
- **Qué hace:** guarda vistas con nombre (tramo de profundidad, plantilla de pistas, panel abierto, zona activa) y las
  recorre con las flechas en pantalla limpia, sin barras.
- **Engancha en:** `src/app/store/viewer.ts`, `src/app/store/ui.ts`, plantillas de pistas (`src/app/tracks/`), la
  «lectura amplia» que ya existe y la paleta de comandos.
- **Decidir (ADR):** las vistas viven en el proyecto y no cambian la interpretación (no entran en `sameEngineInputs`).
  Qué pasa si una vista referencia una plantilla o zona borrada.
- **Terminado cuando:** un recorrido de cinco vistas del TP se guarda, se reabre con el proyecto y se pasa solo con el
  teclado; salir del modo devuelve la disposición anterior.

#### F05 — Notas ancladas a profundidad
- **Qué hace:** texto anclado a una profundidad o a un tramo, visible en el visor, en las figuras exportadas y en el
  informe.
- **Engancha en:** campo opcional `notes` en `Interpretation` (`src/core/interpretation.ts`; el motor no lo lee, como
  `trends`), recetas en `src/core/state/`, superposición en `src/viewer/overlays/`, menú contextual, figuras
  (`src/io/export/figures/`, `src/viewer/figure.ts`) e informe.
- **Terminado cuando:** crear, mover (arrastre y ↑/↓), editar y borrar se deshacen con Ctrl+Z; las notas salen en el
  PNG/SVG y en una tabla del informe; un proyecto anterior abre sin cambios.

### Tanda 3

#### F20 — Reparar la densidad en los derrumbes
- **Qué hace:** entrena un modelo con el pozo en buen estado (GR, neutrón, sónico, resistividad → densidad) y
  reconstruye ZDEN solo en los tramos marcados como derrumbe, con banda de error y el original a la vista.
- **Engancha en:** bosque aleatorio de `src/ml/forest.ts`, banderas de derrumbe (`src/modules/ind-washout/`, control de
  calidad), y el modelo de preparación (`src/core/preparation/`): la curva reparada es una curva **preparada**, con
  procedencia y máscara de calidad, nunca un reemplazo del original.
- **Decidir (ADR):** qué entradas se usan cuando también están afectadas (el neutrón sufre el derrumbe); validación
  cruzada por bloques de profundidad y no por muestras sueltas; umbral de error a partir del cual no se ofrece.
- **Terminado cuando:** en el pozo sintético, borrando tramos sanos a propósito, el error de reconstrucción queda
  dentro del umbral fijado; en el TP se informa R² y RMSE en buen pozo; la porosidad antes y después se ve con la
  cortina de snapshots; cumple las invariantes I01 e I06 del masterplan de preparación.
- **Riesgo:** con pocos tramos sanos de litología parecida el modelo extrapola. La interfaz lo tiene que decir.

#### F22 — Torneo de modelos contra la corona
- **Qué hace:** corre las combinaciones de método de Vsh × porosidad × modelo de Sw y las ordena por error contra los
  plugs y el ensayo de laboratorio. Un clic aplica la ganadora.
- **Engancha en:** funciones puras de `src/petro/` (vsh, porosity, saturation), comparación con corona de
  `src/petro/coreCalibration.ts`, plugs puestos en profundidad.
- **Decidir (ADR):** correr las combinaciones con las funciones puras en una tarea propia del worker, **sin** esperar
  los «slots de cálculo» que `docs/arquitectura.md` tiene como pendiente. Métrica (propuesta: RMSE de φ y de Sw por
  separado, sin mezclarlas en un número) y cómo se avisa del sobreajuste con pocos plugs.
- **Terminado cuando:** la tabla del TP se calcula en segundos sin trabar la interfaz; aplicar la ganadora deja la
  cadena del motor con el mismo resultado que mostró el torneo (test); queda como snapshot comparable.

#### F21 — Saturación por altura (MDT + SCAL + perfil)
- **Qué hace:** grafica Sw contra altura sobre el nivel de agua libre, con la curva capilar esperada por tipo de roca
  y los puntos del perfil encima.
- **Engancha en:** contactos del MDT (`src/modules/mdt/model.ts`), curvas de presión capilar y J de Leverett
  (`src/modules/rock-typing/model.ts`, `src/petro/rockTyping.ts`), `XYPlot` (`src/plots/xy/`).
- **Decidir:** de dónde salen las densidades de fluido para pasar altura a presión capilar (los gradientes del MDT);
  qué se muestra si no hay contacto. Hoy todo va contra MD: avisar si TVD difiere, como hace el panel de MDT.
- **Terminado cuando:** con el caso de libro (Brooks–Corey de ejemplo) la curva coincide con el cálculo a mano; en el
  TP se ven los puntos por zona y por tipo de roca.

#### F14 — Entrenador: pozo con respuesta conocida
- **Qué hace:** genera un pozo sintético con semilla al azar, la usuaria lo interpreta, y al final la app superpone la
  verdad y da el error por zona.
- **Engancha en:** `syntheticWell(n, seed)` (`src/app/demo/syntheticWell.ts`).
- **Atención:** el generador de hoy siembra capas de arena y arcilla, pero **no** guarda φ ni Sw verdaderas, y la zona
  con hidrocarburo usa una mezcla de resistividades en vez de Archie con una Sw sembrada. Hay que reescribirlo para
  partir de φ, Vsh y Sw explícitas y generar las curvas con el modelo directo, sin romper los tests que usan la
  semilla 2026 (el pozo de demostración queda igual; el del entrenador es otro generador).
- **Terminado cuando:** con los parámetros con que se generó, la app recupera φ y Sw dentro del ruido sembrado (test:
  es además una prueba de punta a punta del motor); la verdad no se puede ver antes de pedir la corrección.

### Tanda 4

#### F17 — Lupa sobre el perfil
- **Qué hace:** con una tecla, un recuadro flotante sigue al puntero mostrando ese tramo a escala de detalle (1:200)
  mientras el visor sigue en la vista general.
- **Engancha en:** `src/viewer/render.ts`, `src/viewer/viewport.ts`, `WellViewer.tsx`.
- **Terminado cuando:** mantiene 60 cuadros por segundo con el pozo del TP; respeta escalas, rellenos y superposiciones;
  se cierra con Esc.

#### F18 — Curva fantasma
- **Qué hace:** copia un tramo de una curva como calco semitransparente que se arrastra en profundidad para compararlo
  con otro tramo.
- **Engancha en:** contrato de superposiciones (`src/viewer/overlay.ts`: `drag` y `nudge`), `src/viewer/overlays/`.
- **Terminado cuando:** se crea desde el menú contextual, muestra el desplazamiento en metros, se mueve con ↑/↓ y no
  modifica ningún dato.

#### F06 — Curva calculada por fórmula
- **Qué hace:** escribir `AT90/AT10` o `PHIE*(1-SW)` y que quede como curva para el visor, el crossplot y el histograma.
- **Decidir (ADR, arquitecto):** gramática cerrada con analizador propio (operadores, paréntesis, `log`, `exp`, `min`,
  `max`, mnemónicos y roles) y **nunca** `eval`. Cómo entra al grafo un nodo con entradas dinámicas (el contrato de
  módulo declara entradas fijas por rol), unidades del resultado y qué pasa si falta una curva.
- **Engancha en:** `src/core/module.ts`, `src/core/engine/graph.ts`, campo opcional en `Interpretation` que el motor
  **sí** lee (entra en `sameEngineInputs`).
- **Terminado cuando:** tests del analizador con errores de sintaxis claros; una fórmula con un ciclo se rechaza; la
  curva se exporta a LAS con su fórmula en el comentario.
- **Riesgo:** toca el contrato del motor. Es la función con más superficie del plan.

#### F15 — Bandas de incertidumbre sobre las curvas
- **Qué hace:** franja P10–P90 alrededor de Sw y φ en el visor, que se ensancha donde el dato es peor.
- **Engancha en:** `src/petro/uncertainty.ts` y `src/modules/uncertainty/` (hoy el Monte Carlo es del volumen),
  rellenos del visor (`src/viewer/fills.ts`).
- **Decidir (ADR):** propagación analítica de primer orden o Monte Carlo por muestra (5.810 muestras × N corridas en el
  worker); qué parámetros llevan incertidumbre y con qué distribución.
- **Terminado cuando:** con incertidumbre cero la banda colapsa sobre la curva; el cálculo no demora el recálculo en
  vivo de los sliders (corre aparte y se marca desactualizado, como hace hoy el panel de incertidumbre).

#### F09 — Pegar topes desde una planilla
- **Qué hace:** pegar o cargar una tabla nombre–tope(–base) para crear las zonas.
- **Engancha en:** lectores de tabla (`src/io/table.ts`), recetas de zonas (`src/core/state/zones.ts`), paso Zonas.
- **Terminado cuando:** valida solapes y topes fuera del pozo con mensajes claros; un solo paso de deshacer.

#### F10 — Contacto MDT como tope de zona
- Ya está como pendiente en `docs/arquitectura.md`: receta que parte la zona que contiene el contacto (`createZone`).
- **Terminado cuando:** botón en el panel MDT, un paso de deshacer, y la fila de pendientes de arquitectura se quita.

#### F11 — Rangos de ejes del crossplot a mano
- Ya está como pendiente en `docs/arquitectura.md`: `xRange` / `yRange` se guardan; falta el editor.
- **Terminado cuando:** se editan como las escalas del visor y la fila de pendientes se quita.

### Tanda 5

#### F26 — Asistente sin modelo
- **Qué hace:** una caja de texto que entiende pedidos («mostrame Sw en la zona D»), responde preguntas con plantillas
  rellenadas con números del motor («¿por qué la zona C tiene poco pay?»), explica métodos buscando en Ecuaciones y
  propone el paso siguiente con botones. Sin modelo de lenguaje: nunca inventa.
- **Engancha en:** paleta y comandos (`src/ui/commands`, `src/app/commands/`), búsqueda de Ecuaciones
  (`src/app/ecuaciones/model.ts`), tablas de «Lectura automática del pozo», sensibilidad a los cutoffs, avisos (F02).
- **Decidir (ADR):** lista cerrada de intenciones, cada una una función pura con tests; qué responde cuando no entiende
  (ofrece los comandos más parecidos, no improvisa).
- **Por qué no un modelo embebido:** pesa de cientos de MB a varios GB (rompe el HTML único sin internet), los que
  entran son flojos en español técnico y pueden inventar números, y dependen de la máquina del profesor.
- **Terminado cuando:** un guion de 20 preguntas típicas de la defensa pasa como test; toda respuesta numérica cita de
  qué tabla o curva sale.

#### F23 — Perfilaje en vivo
- **Qué hace:** la sarta 3D sube por el pozo y las curvas se dibujan en el visor a medida que pasa cada sensor, cada
  uno desfasado según su posición.
- **Engancha en:** `src/app/toolString/` (escena y renderizador), `src/core/toolSheets.ts`, `src/viewer/animation.ts`.
- **Falta:** las fichas tienen el largo de cada herramienta pero no la posición del punto de medida. Hay que
  investigarla por herramienta y marcar lo no verificado, como ya hacen las fichas.
- **Terminado cuando:** se puede pausar, saltear y repetir; respeta «reducir movimiento»; no cambia ningún dato.

#### F24 — Pozo 3D con calibre e invasión calculados
- **Qué hace:** la pared del pozo toma la forma del calibre (los derrumbes se ven como cavernas) y la zona invadida usa
  el diámetro que calcula el módulo de invasión.
- **Engancha en:** `src/app/toolString/scene.ts` (hoy pozo esquemático e `INVASION_CM = 30` fijo),
  `src/app/toolString/formation.ts`, salidas `DI` y `RXO` de `src/modules/invasion-step/`.
- **Terminado cuando:** sin calibre o sin invasión calculada vuelve al dibujo esquemático de hoy y lo dice; la leyenda
  aclara qué es medido, qué es calculado y qué es ilustración.

### Condicionales

#### F12 — Gráfico de Hingle
- Plantilla de crossplot junto al Pickett (`src/plots/crossplot/templates.ts`, `pickett.ts` como modelo).

#### F13 — Saturación de Waxman–Smits
- Función pura en `src/petro/saturation.ts` con caso de libro y módulo `src/modules/sw-waxman-smits/`. Necesita CEC o
  Qv, que el TP no trae: sin ese dato no tiene sentido hacerlo.

## 6. Descartadas

| Idea | Por qué no |
|---|---|
| Comparación de varios pozos lado a lado | El TP es de un solo pozo y es trabajo grande. |
| Modelo de lenguaje embebido | Peso, calidad y dependencia de la máquina (ver F26). |
| Caudal por capa con Darcy | Pide viscosidad, daño y radio de drenaje que no hay: serían números inventados. |
| Sonificar el GR al desplazar el perfil | Divertido, no aporta a la interpretación. |
| Reproducir el historial como animación | El modo defensa (F07) lo cubre mejor. |

## 7. Riesgos del plan

- **Tiempo.** Son 26 funciones (24 firmes y 2 condicionales) y la entrega es en diciembre. La línea de corte de la sección 4 es la protección.
- **F06 y F15 tocan el motor.** Van después de todo lo que no lo toca, cada una con su ADR y revisión de arquitectura.
- **F01 depende del navegador.** Si IndexedDB no anda por `file://` en alguno, queda el aviso al cerrar como mínimo.
- **F20 y F22 pueden dar una falsa seguridad.** Las dos tienen que mostrar su error y sus límites en pantalla, no solo
  el resultado.


## Continuidad después de F05

El usuario pidió cerrar F05, mergear su PR y preparar una sesión nueva para F20 después de informarse el bloqueo
de apertura `file://`. Se cierra la implementación de F05 con revisión independiente aprobada, conservando esa
prueba como **pendiente**, sin declararla verificada. Ver la evidencia para resultados exactos.
La próxima función es F20; [contexto y prompt de la nueva sesión](sesion-f20.md).
