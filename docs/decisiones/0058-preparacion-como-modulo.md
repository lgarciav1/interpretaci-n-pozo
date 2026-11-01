# 0058 — «Preparar datos» como módulo y panel visual del dock

Fecha: 2026-11-01. Rama de trabajo del agente, sin integrar.

## Contexto

La preparación de datos (exclusión, espurios, interpolación, mediana, alineación, corridas, DRX, diagnóstico ambiental,
correcciones/MGT, calibración GR y cutoff Vsh) era un diálogo modal (`src/app/preparation/PreparationDialog.tsx`) con
campos de texto y secciones `<details>` plegadas, montado en `App.tsx` y abierto desde la columna izquierda. Eso
contradecía dos reglas de CLAUDE.md: «agregar un módulo = una carpeta + un registro» (la interfaz vivía en `app/`) y
la calidad visual (prioridad 2). La lógica (`src/core/preparation/`, `src/core/state/*`, formato v7, snapshots) no
cambia: es correcta y está probada.

## Decisión

### 1. Módulo de panel registrado (cambio mínimo al contrato)

El contrato `defineModule` exige `compute` y al menos una salida (`createRegistry`: «no declara ninguna salida»), y el
motor recorre `registry.modules` para elegir fuentes, viabilidad y nodos. La preparación no es un nodo del motor: sus
cálculos corren en el **plan de preparación** (`entryPreparationPlan`), antes de los módulos. Se agregó una segunda
lista en el registro:

- `src/core/module.ts`: `PanelModuleDefinition` + `definePanelModule` — `id`, `name`, `description`, `category`,
  `categoryLabel`, `workspace` y `docs`. Sin `inputs`, `outputs`, `params` ni `compute`.
- `src/core/registry.ts`: `createRegistry(modules, { panels })` valida los paneles con las mismas reglas de identidad
  (kebab-case, id único **entre módulos y paneles**), espacio de trabajo, categoría (conocida o declarada con
  `categoryLabel`) y forma de `docs`; rechaza un panel que declare `inputs`, `outputs` o `compute`. Expone
  `registry.panels` y `registry.getPanel(id)`. Las categorías de los paneles cuentan como «en uso».
- `src/modules/index.ts`: `export const PANEL_MODULES = [preparation]` (una línea por módulo, como `MODULES`).
- El motor, el flujo guiado, el selector de módulos del inspector y la sarta siguen leyendo solo `registry.modules`:
  el panel no aparece como método, no corre, no cambia ningún resultado (test: el motor no lo recalcula).
- Ecuaciones (`src/app/ecuaciones/model.ts`) agrega las entradas de `registry.panels`; `open.ts` toma como «panel con
  entrada propia» toda pestaña del dock cuyo id sea el de un módulo de panel, así «Ecuaciones» abre la de «Preparar
  datos» desde su pestaña.

Definición pura (`src/modules/preparation/index.ts`, la importa el worker): id `preparation`, nombre «Preparar datos»,
categoría `qc` (Control de calidad), espacios Petrofísica y Geología, y `docs` con: exclusión de tramo, criterio de
espurio (mediana y MAD normalizada de seis vecinos), interpolación lineal acotada por la distancia entre anclajes,
mediana móvil de ventana física, corrimiento constante en MD con remuestreo lineal, factor MGT (centrado y excentrado,
Goldberg et al. 2004), índice de rayos gamma, ajuste de extremos GR contra Vsh de DRX, los cinco métodos de Vsh y el
impacto del cutoff sobre N/G. Las ecuaciones copian las que implementa `src/core/preparation/` y `src/petro/`; no se
duplica ningún cálculo.

**Alternativas descartadas.**

- *Registrar la preparación en `MODULES` con salidas vacías y un `compute` vacío*: obligaba a relajar la regla de
  «al menos una salida» para todos y a enseñarle al motor, al flujo, al inspector (selector «Todos los módulos») y a la
  sarta (disponibilidad) a ignorar un módulo que no calcula. Más superficie de cambio y riesgo de que aparezca como
  método o en la disponibilidad.
- *Una entrada en `EQUATION_EXTRAS` (como la calculadora de agua de formación)*: obliga a tocar `src/app/` por cada
  módulo de panel y no valida identidad ni categoría. Queda para los extras existentes.
- *Solo `dock.tsx` sin definición (como Histograma o MDT)*: no aparece en Ecuaciones ni en el registro.

### 2. De diálogo modal a panel del dock

- `src/modules/preparation/dock.tsx` aporta la pestaña «Preparar datos» (descubierta sola; insignia = recetas del pozo).
- Entradas: el botón de la columna izquierda, la acción de la paleta **«Abrir Preparar datos»** (`commands.ts`
  descubierto, grupo Pozo) y una tarjeta en el paso **Calidad** del flujo guiado (el flujo sigue en 11 pasos). Las tres
  llaman a `openPreparation(curva?)` (`src/app/preparation/open.ts`): elige la pestaña, despliega el dock y, si está bajo
  o en automático, le da 460 px (nunca más del 55 % de la ventana), y pide la curva al panel (`usePreparationUi.request`).
- Se borró el diálogo y su montaje en `App.tsx`.

### 3. Qué se movió y qué quedó en `app/`

A `src/modules/preparation/` (mismos nombres): `XrdPanel`, `XrdCalibrationPanel`, `XrdCutoffPanel`, `XrdLaboratory`,
`EnvironmentPanel`, `EnvironmentDiagnosticPanel`, `MgtPanel`, `RunEditor`, `calibrationPreview.ts` (puro; los tests
actualizaron su ruta), `preparation.css`, y reescritos sobre la misma lógica `SuspectReview`, `InterpolationEditor`,
`FilterEditor`, `ShiftEditor`. `PreparationDialog.tsx` pasó a `PreparationPanel.tsx`. Nuevos: `ExclusionEditor`,
`ToolCard` (tarjeta, slider de borrador), `Pipeline`, `CurveCards`, `BeforeAfterChart`, `SavedPreparations`, puros
`pipeline.ts`, `flags.ts`, `types.ts` y el dibujo `draw.ts`.

Quedan en `src/app/preparation/` solo piezas de la app: `data.ts` (`effectiveWell`, `entryContext`: proyección de los
datos preparados que usan visor, gráficos, exportación, informe y snapshots), `view.ts` (qué curvas ve el visor con
«Comparar»), `store.ts` (preferencia de vista `compareOriginals` y el pedido de apertura) y `open.ts`. Moverlas al
módulo haría que el núcleo de la app dependa de una carpeta de módulo.

### 4. Interfaz

- **Cabecera**: pestañas de sección y tramo de la vista (zona, tope–base, «Usar tramo visible», «Seguir el visor»).
  Tarjetas de curva (todas las medidas): nombre en su color convencional (`curveStyle`), semáforo del control de
  calidad (el mismo informe del paso Calidad), mini-gráfico del pozo completo y franja de banderas por profundidad
  (bandera dominante por columna). Flechas ← → recorren las tarjetas (radiogroup).
- **Tubería** (`pipeline.ts`, puro y testeado): Original → Exclusión → Interpolación → Mediana → Alineación →
  Preparada, en el orden del motor. Cada nodo muestra estado (aplicada, en vista previa, sin aplicar, no combinable con
  MGT) y un conteo que sale de las banderas del resultado del motor («95 excluidas», «1.088 filtradas», «+0,6 m»).
  Clic abre la herramienta de esa etapa; «Preparada» abre Guardadas.
- **Gráfico antes/después** (canvas con `useCanvas`, `draw.ts`): profundidad en el eje horizontal (el dock es ancho y
  bajo), original en gris y preparada o vista previa en el color de la curva, escala log para resistividades, muestras
  excluidas (rojo, sobre el original) e interpoladas (azul) resaltadas con banda y puntos, sospechosas (ámbar), zonas
  arriba, eje de MD, cursor propio y el del visor, y debajo la **barra de banderas**: una fila por cada uno de los ocho
  bits de `Quality` con su color y rótulo, más la leyenda con conteos en la vista. Arrastrar marca el tramo de las
  herramientas (Escape cancela). Envolvente mín–máx por columna: dibuja las 5810 muestras sin perder picos.
- **Herramientas como tarjetas** con descripción de una línea y sliders (`SliderField` de `src/ui`). Los sliders
  cambian un **borrador**, no el proyecto: la vista previa se recalcula sola (pausa de 160 ms, el motor aislado de
  snapshots cancela la anterior) y el proyecto cambia una sola vez al «Aplicar» (`commit` con `group` = la vista
  previa: un paso de deshacer). Escape durante el arrastre de un slider vuelve al valor del comienzo del gesto (también
  el riel nativo). Si «Aplicar» está deshabilitado, el pie de la tarjeta dice por qué («Tildá la declaración del datum
  para previsualizar la alineación», «No hay huecos que cumplan los límites…»). Tras aplicar: «Aplicado: … · Deshacer».
- **«Sospechosa»** (`Quality.Suspect`, definido y sin uso en el motor): la interfaz lo usa como bandera **de vista**
  para los picos del control de calidad y los candidatos de la búsqueda de espurios. No se guarda ni llega al motor.
- **Montaje**: como los gráficos del dock, el panel se monta solo con su pestaña a la vista (oculto no calcula vistas
  previas ni redibuja). Recuerda por pozo la curva, la vista, la pestaña y el tramo marcado; una herramienta abierta se
  descarta al cambiar de pestaña. En una exclusión sobre una curva ya preparada, el conteo es el de mediciones que
  agrega la vista previa (y el total).
- **Secciones avanzadas como pestañas** con insignia (DRX: conjuntos; Ambiente: tramos de derrumbe/caliper; Correcciones:
  MGT activa; Corridas; Guardadas: recetas). Su contenido es el de siempre; se quitaron los `<details>` de primer nivel
  y se les dio un estilo base con tokens. Se montan solo con su pestaña a la vista.
- Claro y oscuro solo con tokens (los colores de bandera salen de `THEMES` y de la paleta categórica de `src/ui`),
  cifras tabulares, estados vacíos con qué hacer, foco visible, `prefers-reduced-motion`. Panel angosto: el gráfico y
  las herramientas se apilan (consulta de contenedor).

### 5. Compatibilidad

Sin cambios en `src/core/preparation/*`, `src/core/inputs/*`, `src/core/state/*` ni `src/petro/*`: el formato v7, las
recetas, los snapshots y deshacer/rehacer son los mismos. Las operaciones aplican exactamente las mismas recetas que el
diálogo (`addMaskInterval(s)`, `setGapFill`, `setMedianFilter`, `setDepthShift`, `setRunDepthShift`, `restore…`,
`remove…`, `setSource`) con las mismas etiquetas de deshacer.

## Verificación

- `tests/modules-preparation.test.ts`: registro del panel, carpeta, aislamiento del motor, docs y búsqueda en
  Ecuaciones, validaciones del contrato de panel. `tests/equations.test.ts` cuenta también los paneles.
- `tests/preparation-panel.test.ts`: banderas (8 bits, conteos, tramos, columnas, dominante, envolvente), tubería
  (orden, estados, vista previa, alineación con conteos de origen, MGT) y ayudas de las herramientas.
- `tests/preparation-open.test.ts`: pestaña descubierta, acción de la paleta (búsqueda, habilitación, apertura sin
  cambiar el proyecto) y pedido de curva.
- Navegador (Playwright sobre `dist/index.html` por `file://`): abrir por el botón y por Ctrl+K, GR, exclusión con
  vista previa por arrastre, aplicar/deshacer/rehacer, espurios en NPHI, interpolación (GR sin huecos → motivo; SP),
  mediana con Escape en el slider, alineación con declaración de datum, guardar el proyecto v7 y reabrirlo con las
  mismas preparaciones, tarjeta del paso Calidad, sin errores de página. Guion: `scripts/qa/preparation-panel.cjs`
  (`npm run build && node scripts/qa/preparation-panel.cjs`); capturas claro/oscuro, ancho/angosto en
  `docs/capturas/preparacion/`.
- Tamaño del HTML único: 5.885.692 bytes antes, 5.949.891 después (+64 kB).

## Pendiente

- Refinamiento visual de las pestañas DRX y calibración GR, Ambiente, Correcciones/MGT y Corridas (contenido y
  `<details>` internos de siempre, con estilo base).
- Los guiones de QA en Python de `scripts/qa/` que manejaban el diálogo (`alignment.py`, `interpolation`, `filtering`…)
  usan sus rótulos viejos («Previsualizar …», campos de texto): hay que adaptarlos al panel antes de volver a correrlos.
- El tramo de la vista no mueve el visor (solo lo lee); «llevar el visor al tramo» queda para cuando se pida.
