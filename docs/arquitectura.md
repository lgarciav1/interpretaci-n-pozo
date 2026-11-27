# Arquitectura

> Propuesta para las próximas fases: [Masterplan de preparación de datos y calibración DRX](masterplan-preparacion-y-drx.md). Define contratos, migraciones, validación científica y etapas para los issues #31 y #32; todavía no está implementada.

Webapp 100 % en el navegador (TypeScript + React + Vite) que se entrega como un único `dist/index.html`.
Las decisiones con sus alternativas descartadas están en [`decisiones/`](decisiones/): núcleo y contrato de módulos
(0001), lectura de datos (0002), control de calidad (0003), sistema de diseño, armazón y flujo guiado (0004), visor
multipista (0005) con sus pistas armables y plantillas propias (0016), deshacer y rehacer (0006), catálogo de módulos de la fase 6a con sus cambios de núcleo (0007),
tendencias y gradientes (0008), presiones MDT con los conjuntos de puntos del pozo (0009), datos de corona con
puesta en profundidad y modelo k–φ (0010), exportación de datos (0011) y de figuras (0012), tamaño de interfaz (0013),
histograma y crossplot libre (0014), parámetros elegidos sobre los gráficos (0015), calculadora de agua de formación con
indicadores automáticos (0017), los modelos de Sw lado a lado, las fichas de zona y la paleta de comandos (0018), el
módulo de RMN con su pista y su crossplot (0019, `0019-rmn.md`), capacidad de flujo, incertidumbre y lectura automática
(0019, `0019-reservorio-e-incertidumbre.md`), el perfil radial de invasión (0020), los gráficos conectados al perfil
con el Pickett interactivo (0021), el informe automático (0022), la calibración con corona (0023; n desde el índice de
resistividad en 0053) y la sarta de
perfilaje (0032) con su configurador y vista 3D (0033) y la pantalla de Inicio con la entrada al pozo (0065).
Este documento resume cómo encajan las piezas y cómo agregar un módulo.

## Ideas centrales

1. **Los módulos se conectan por puertos, no por nombre.** Un módulo dice "necesito GR" y "produzco IGR". El
   grafo se arma solo. Los puertos de curva son roles (`GR`, `RHOB`, `VSH`, `RW`…); los escalares, los escalares
   por zona y las tablas tienen ids en mayúsculas (`OOIP_TOTAL`, `HPHISH_PAY`, `ZONE_SUMMARY`). Los cuatro tipos
   pueden ser entrada de otro módulo.
2. **Varios métodos por paso = varios módulos que producen el mismo puerto.** La interpretación guarda qué fuente
   alimenta cada puerto (`sources`); las alternativas se pueden calcular para comparar (`compare`) sin alimentar
   la cadena. Por defecto: curva medida con ese rol → primer módulo registrado **que pueda correr** (tiene todas sus
   entradas requeridas) → primer módulo registrado. Excepción deliberada: si los métodos no tienen parámetros
   propios y la elección cambia por zona (Vsh, PHIT), es un módulo con un `param.enum` por zona (0007, D1).
3. **Parámetros declarativos, globales con override por zona.** El esquema genera los controles. El motor parte
   el pozo en tramos de una misma zona y le da a cada tramo sus parámetros ya resueltos.
4. **Motor incremental, idéntico en worker y en proceso.** Cada módulo tiene una firma (parámetros + zonas +
   versión de entradas); si no cambió, se reusa el resultado.
5. **Estado en tres capas.** Proyecto (se guarda), UI (no se guarda), resultados (derivados, no se guardan).
   La configuración del visor (pistas propias, overrides de escala y color) es parte del proyecto, fuera de la
   interpretación.
   El cronómetro del recorrido (F19, `src/app/flow/stopwatch.ts` puro y `stopwatchStore.ts`) es estado de UI: arranca
   al cargar un pozo (no con el sintético del arranque ni con la sesión recuperada) y frena al abrir el Sumario; no
   entra en el proyecto, en deshacer ni en el archivo, y solo se recuerda si se muestra. El informe recibe el tiempo
   como dato de quien lo genera.

## Flujo

```
 Interfaz (React)                         Hilo principal                         Web Worker
 ───────────────                          ──────────────                         ──────────
 slider ─► commit(receta pura) ─► store del proyecto (zustand)
                                          │  cambia el pozo activo   ─► syncWell ─► datos medidos residentes
                                          │  cambia la interpretación ─► run ─────► Engine.run(interp)
                                          │        (1 en vuelo + 1 pendiente;          planGraph: fuentes, orden,
                                          │         gana el último)                     faltantes, ciclos
                                          │                                             por módulo: firma igual → caché
                                          │                                                       firma nueva → compute()
                                          ▼                                             ◄── solo salidas nuevas
 paneles, visor, tablas ◄── store de resultados ◄── EngineClient (reconstruye todo) ◄──     (Float64Array transferibles)
```

El `EngineSupervisor` decide si el motor corre en un worker o en proceso y lo recrea si se cae.
Tests y Monte Carlo usan `Engine` directamente (`computeOnce` o una instancia con caché), sin worker.

**Lo que publica cada corrida (0074).** Además de salidas, fuentes y candidatas, el motor publica lo que *usó*: cada
`NodeReport` con `status: 'ok'` (recalculado o reusado de caché) trae `inputs` (clave local → `SourceRef | null`, con
las opcionales soltadas en tiempo de ejecución en `null`) y `params` (`{ global, byZone }`, los valores resueltos que
recibió `compute`), y `EngineRunResult.segments` da los tramos `{ start, end, zoneId }` de las zonas que vio. Es JSON
chico y viaja por el worker sin cambios en el protocolo. `src/core/engine/provenance.ts` (`traceSample`, puro) recorre
`nodes[].inputs` hacia arriba desde una salida y arma la cadena de una muestra —cada módulo una vez, en el orden del
motor, con el valor publicado de cada salida y entrada, la fuente y los parámetros de su zona— sin recalcular nada.
La muestra el panel del dock **Origen** (`src/app/provenance/`, id `provenance`), que se abre desde el menú contextual
del perfil («¿De dónde sale este número?», prop `onTraceSample` del visor) y se actualiza solo con cada corrida.

## Carpetas

| Carpeta | Qué hay | Puede importar React |
|---|---|---|
| `src/core/` | modelo (`well.ts`; conjuntos de puntos `pointSets.ts`), unidades, roles, herramientas de perfilaje (`tools.ts`, fichas en `toolSheets.ts`) y sarta (`toolString.ts`: filtro de curvas y disponibilidad de módulos), parámetros, contrato de módulo, registro, motor (`engine/`), estado (`state/`: proyecto, snapshots, recetas de zonas `zones.ts`, de tendencias `trends.ts`, de conjuntos de puntos `pointSets.ts`, de gráficos `plots.ts`, de pistas y plantillas `tracks.ts` y de la sarta `toolString.ts`), configuración del visor que se guarda y su validación al abrir (`display.ts`, incluidas las pilas de la pista volumétrica), configuración del histograma y del crossplot (`plots.ts`), tendencias (`trends.ts`: `TrendSpec`, saneamiento), conversión a unidad canónica compartida (`canonical.ts`) | no |
| `src/petro/` | funciones de cálculo puras, testeadas | no |
| `src/modules/<id>/index.ts` | definición pura del módulo | no |
| `src/modules/<id>/<x>.worker-only.ts`, `<x>.main-thread.ts` | dependencia pesada que solo corre en el worker y su sustituto sin ella para el hilo principal (ver «Archivos solo-worker») | no |
| `src/modules/<id>/panel.tsx` | panel a medida (opcional) | sí |
| `src/modules/<id>/overlay.ts`, `draw.ts` | superposiciones del visor (opcional, `overlays: ViewerOverlay[]`): dibujo, arrastre, pista propia; `draw.ts` (opcional): dibujo en canvas de un panel o una figura del módulo que usa `ui/` y `plots/` (perfil radial, 0020). El worker no los importa y `tests/modules.test.ts` los excluye de la regla de pureza | no (canvas) |
| `src/modules/index.ts` | **el registro** (una línea por módulo): `MODULES` (nodos del motor) y `PANEL_MODULES` (módulos de panel, sin puertos ni cálculo en el motor: identidad, categoría y `docs` para Ecuaciones, 0058) | no |
| `src/modules/preparation/` | «Preparar datos» (0058): definición de panel pura (`index.ts`), panel del dock (`dock.tsx`, `PreparationPanel.tsx`: tarjetas de curva, tubería, gráfico antes/después, herramientas —incluida «Normalizar» con su histograma, 0060—, pestañas DRX/ambiente/MGT/corridas/guardadas), acciones de la paleta (`commands.ts`), lógica pura de la tubería, las banderas y el histograma (`pipeline.ts`, `flags.ts`, `normalizationView.ts`) y dibujo (`draw.ts`). Los cálculos están en `src/core/preparation/` | `.tsx` sí |
| `src/modules/sharedParams.ts` | catálogo canónico de parámetros compartidos | no |
| `src/app/` | arranque, worker (`engine.worker.ts`), puente con el motor, stores (`store/viewer.ts`: cursor y tramo visible), descubrimiento de superposiciones (`viewerOverlays.ts`), pantallas | sí |
| `src/app/preparation/` | lo de la app sobre la preparación (0058): proyección de datos preparados que usan visor, gráficos, exportación, informe y snapshots (`data.ts`), curvas del visor con «Comparar» (`view.ts`), preferencia de vista y pedido de apertura (`store.ts`) y `openPreparation` (`open.ts`). La interfaz es del módulo `src/modules/preparation/` | sí |
| `src/app/shell/` | armazón: barra superior, flujo guiado, inspector, dock (`dockPanels.tsx`: una entrada por panel), `ViewerSlot` (conecta stores con el visor: edición de zonas, modo marcar zona, encabezado, «Armar pistas»), `viewerOverlayList.ts` (superposiciones del visor de la app), `CurveEditor` (editor de escalas), diálogos | sí |
| `src/app/tracks/` | «Armar pistas» (0016): panel con el catálogo (`TrackBuilder.tsx`), plantillas y diálogos (`Templates.tsx`), arrastre con eventos de puntero (`dnd.ts`) y acciones que traducen gestos a recetas con `commit` (`actions.ts`) | sí |
| `src/app/toolString/` | sarta en la interfaz (0032, 0033): curvas visibles y disponibilidad del pozo activo con caché (`select.ts`), lista de la columna izquierda (`ToolStringPanel.tsx`), vista 3D (`ToolStringView.tsx`) con la escena como descripción pura (`scene.ts`, sin three ni DOM, testeada), la columna litológica del pozo para la formación (`formation.ts`, pura; `wellColumn.ts` la toma del pozo, también para Inicio) y su dibujo con three.js (`render3d.ts`, extensible por herencia: Inicio, 0065), ficha (`ToolSheetCard.tsx`) y atajos en la paleta (`commands.ts`) | `scene.ts` no |
| `src/app/home/` | pantalla de Inicio (0065): capa sobre el armazón (`HomeScreen.tsx`, `home.css`), estado de interfaz y duraciones de la entrada (`store.ts`), abrir y cerrar (`actions.ts`), composición de demostración (`demoString.ts`), la sarta exhibida y la entrada al pozo (`showcase3d.ts`, hereda `ToolStringRenderer`), esquema sin WebGL (`Silhouette.tsx`) y «Ir a Inicio» en la paleta (`commands.ts`) | sí |
| `src/app/chatContext/` | «Copiar contexto para un chat» (F25): texto plano del pozo armado desde el modelo del informe, con tope de 12 000 caracteres, avisos agrupados por zona y recorte por prioridad (`chatContext.ts`, puro y testeado); copiado del resultado vigente (`actions.ts`, usa `copyText` de `src/ui/clipboard.ts`, con respaldo para file://) y comando de la paleta (`commands.ts`). No envía nada | `chatContext.ts` no |
| `src/app/views/` | vistas guardadas y modo defensa (0075): estado de interfaz del modo (`store.ts`: recorrido, pistas de reemplazo, foto), partes puras (`defense.ts`: foto y restauración, parche de cada vista, siguiente/anterior), acciones (`actions.ts`: guardar, ir a una vista, entrar/salir/pasar, teclado en captura), panel «Vistas» y diálogos (`ViewsPanel.tsx`), indicador «3 / 5 · Nombre» (`DefenseHud.tsx`) y paleta (`commands.ts`). Las recetas puras están en `src/core/state/views.ts` | `defense.ts` no |
| `src/app/flow/` | flujo guiado: definición de pasos y evaluación de estados (`flow.ts`, puro y testeado); cronómetro del recorrido (`stopwatch.ts`, puro y testeado; estado en `stopwatchStore.ts`) | `flow.ts`, `stopwatch.ts` no |
| `src/ui/` | sistema de diseño: tokens, tema, paleta de curvas, componentes, `useCanvas`; contrato de panel. Guía en `src/ui/README.md`; muestra en `#ui` | sí |
| `src/viewer/` | visor multipista: plantillas, resolución de pistas, viewport, ticks, reducción M4, rellenos, pilas (`stack.ts`), lectura, contrato de superposiciones (con elementos del teclado), gestos (`interaction.ts`), catálogo de herramientas y curvas para armar pistas (`catalog.ts`), dibujo en canvas (`*.ts`, puros o canvas) y los componentes `WellViewer.tsx`, `Minimap.tsx`, `WellHeader.tsx`, `layoutEdit.tsx` (modo «Armar pistas»: destinos y bordes de ancho). Guía en `src/viewer/README.md` | solo los `.tsx` |
| `src/io/` | lectores Excel/LAS/CSV, mnemónicos, control de calidad, tablas de presiones (`pressures.ts`) (ver su README) | no |
| `src/plots/xy/` | gráfico x–y base (ejes lineales o log, ticks, mapeo dato ↔ px puro en `axes.ts`, dibujo en `draw.ts` —barras, eje derecho, guías rotuladas, nube densa—, búsqueda por grilla `pick.ts`, componente `XYPlot.tsx` con guías arrastrables): lo usan el crossplot k–φ de la corona, el histograma y el crossplot libre. Guía en `src/plots/README.md` | solo `XYPlot.tsx` |
| `src/plots/histogram/`, `src/plots/crossplot/`, `src/plots/*.ts` | histograma y crossplot libre (0014): lo puro en `.ts` (binning, estadísticos, plantillas, serie `crossplot`, curvas y zonas `data.ts`, cutoffs `cutoffs.ts`, parámetros sobre los gráficos `params.ts` y `crossplot/drag.ts` (0015), enlace con el visor `link.ts`) y los paneles de presentación en `.tsx` (sin stores) | solo los `.tsx` |
| `src/app/plots/` | conexión de los gráficos del dock con los stores: contexto del pozo según la sarta (`context.ts`: `plotContextOf`, `visibleWell`, `visibleQc`; único punto de filtrado de selectores, gráficos y listas, 0032 D9), configuración, `commit`, cutoff real y parámetros elegidos sobre los gráficos (agrupados por gesto), fuentes activas y «Usar …», montaje solo con la pestaña a la vista | sí |
| `src/plots/trend/` | tendencias: contrato y registro de proveedores de series (`series.ts`, proveedor `curve`), ajuste sobre la serie (`compute.ts`), dibujo independiente de los ejes (`draw.ts`), textos (`format.ts`) y superposición del visor sin stores (`overlay.ts`). Guía en `src/plots/README.md` | no |
| `src/app/trends/` | estado de interfaz de las tendencias (herramienta, selección), proveedores de los módulos (`providers.ts`), conexión con los stores (`actions.ts`) y panel «Tendencias» del dock | sí |
| `src/modules/<id>/series.ts` | proveedores de series para tendencias (opcional, `seriesProviders: TrendSeriesProvider[]`): MDT, plugs de corona…; el worker no lo importa | no |
| `src/modules/<id>/dock.tsx` | paneles del dock aportados por un módulo (opcional, `dockPanels: DockPanelDef[]`, contrato en `src/ui/dockPanel.ts`): «Presiones MDT», «Corona», «Histograma», «Crossplot», «Agua de formación» (0017: `formation-water`, con `model.ts` y `docs.ts` puros) | sí |
| `src/digitizer/` | Log Digitizer, motor puro (0062): calibración de profundidad y valor, corrección geométrica (inclinación, homografía), color CIELAB y colores sugeridos, trazado por Viterbi (automático y guiado), muestreo, calidad, integración con el pozo y los exportadores LAS/CSV, sesión serializable y flujo `digitizeCurve`. Del visor solo importa la escala (`viewer/scale.ts`). La interfaz es el módulo de panel `src/modules/digitizer/` (0063) | no |
| `ml` | fases siguientes (ver su README) | — |

Un test (`tests/modules.test.ts`) falla si `core`, `petro` o una definición de módulo importan React, zustand o la
interfaz. Otro (`tests/digitizer/session.test.ts`) lo exige para `src/digitizer/` (sin DOM ni canvas; de `viewer/` solo
`scale.ts`).

## Reglas que heredan todas las fases

- **Arrays inmutables.** Las curvas son `Float64Array` con `NaN` = sin dato. Nunca se modifican en el lugar: para
  editar una curva se crea un array nuevo. El motor detecta cambios por identidad del array.
- **Entradas de solo lectura.** `compute` no puede escribir en sus entradas, ni en `ctx.depth` / `ctx.thickness`
  (están en caché y las comparten otros módulos y, las medidas, el proyecto). Qué se garantiza:
  - *En compilación:* las curvas de entrada son `ReadonlyCurve` (`src/core/module.ts`): índice de solo lectura y
    solo métodos que no mutan (`fill`, `set`, `sort`, `reverse`, `copyWithin` no existen; `subarray` devuelve otra
    vista de solo lectura; `slice`/`map`/`filter` devuelven copias del módulo). Un cast explícito
    (`as unknown as Float64Array`) lo saltea: el tipo no es una garantía en tiempo de ejecución.
  - *En ejecución:* `new Engine(registry, { checkInputs: true })` hashea cada entrada antes y después de `compute`
    y lanza `InputMutationError` con el módulo y la entrada. Está activo en los tests de módulos y en desarrollo
    (`npm run dev`, worker y motor en proceso); en el build de producción está apagado por costo.
- **Parámetros compartidos en un solo lugar.** Los que usan varios módulos (a, m, n, Rsh, cutoffs, GR limpia/arcilla) se
  declaran una vez en `src/modules/sharedParams.ts` y los módulos los toman de ahí (`params: { rw: SHARED_PARAMS.rw }`).
  El registro exige que todo parámetro `shared: true` esté en ese catálogo y sea idéntico campo por campo, y avisa
  (`registry.warnings`) si una clave es compartida en un módulo y propia en otro.
- **Unidades canónicas.** El motor convierte cada curva medida a la unidad canónica de su rol antes de pasarla a un
  módulo (`%` → `v/v`, `kg/m³` → `g/cm³`…). Los módulos nunca convierten.
- **Profundidad en metros**, estrictamente creciente.
- **Las acciones sobre el proyecto son funciones puras** (`src/core/state/project.ts`, `snapshots.ts`) y se aplican
  con `useProject.getState().commit(etiqueta, receta)`. Todo lo que pasa por `commit` se puede deshacer (ver
  «Deshacer y rehacer»); la etiqueta es corta, en español y con verbo («Mover tope de C», «Cambiar Rw»).
- **Textos de interfaz en español, identificadores en inglés.** Las ecuaciones van solo en `docs` del módulo.

## Contrato de módulo (resumen)

```ts
defineModule({
  id: 'kebab-case',                // = nombre de la carpeta
  name: 'Nombre en español',
  category: 'shale',               // conocida (src/core/workspaces.ts) o nueva + categoryLabel: 'Mi categoría'
  workspace: 'petrophysics',       // o ['petrophysics', 'geology']
  roles?: [...],                   // roles de curva nuevos que introduce
  tools?: [...],                   // herramientas de perfilaje nuevas (sarta, 0032) que registran roles medidos
  inputs:  { gr: input.curve('GR'), cal: input.optionalCurve('CALI'), k: input.scalar('K_REF'),
             t: input.table('ZONE_SUMMARY'), h: input.zoneScalar('HPHISH_PAY') },   // + optionalScalar/Table/ZoneScalar
  inputGroups?: [{ inputs: ['phid', 'phin'], min: 1, label: 'una porosidad de densidad o neutrón' }],
                                   // «al menos N de» sobre entradas opcionales (0032): el motor y la sarta lo respetan
  params:  { grClean: param.number({ label, tooltip, default, min, max, step, unit, scale, scope: 'zone', shared }) ,
             method: param.enum({ ... }), useX: param.boolean({ ... }) },
  outputs: { igr: output.curve('IGR'), total: output.scalar('X_TOTAL', {...}), byZone: output.table('X', {...}),
             perZone: output.zoneScalar('X_BY_ZONE', { label, unit }) },
  compute(ctx) { ... },            // pura; ctx: n, depth, thickness, inputs, params, segments, zones, paramsFor, warn(msg, where?)
  docs: { summary, equations: [{ latex }], references: [...] },
});
```

**Entradas «al menos N de»** (`inputGroups`, 0032): un módulo cuyas entradas son todas opcionales pero necesita alguna
(PHIT combina las porosidades que haya, pero sin ninguna no hay nada que combinar) lo declara con un grupo sobre esas
claves (`min` por defecto 1; `label` completa el motivo «Falta …»). El registro valida que las claves existan, sean
opcionales y que el mínimo sea alcanzable; las claves se verifican también en tiempo de compilación. Si el grupo no se
cumple, el motor no corre el módulo (`missing-input`; `blocked` si las fuentes que lo cumplían no corrieron, en el plan
o al calcular) y la disponibilidad de la sarta lo marca «no disponible» con lo que daría cada opción. Usan grupos `phit`
(densidad, neutrón o sónico), `perm-coates` (porosidad RMN o efectiva), `sed-column` (GR, Vsh o inversión mineral) y,
con mínimo 2, `lithology-facies`, `electrofacies` y `electrofacies-scan`. Un módulo sin entradas (como
`temp-gradient`, que calcula la temperatura desde parámetros) corre siempre: es un modelo, no depende de la sarta.

`compute` está tipada a partir de las declaraciones: `ctx.inputs.gr` es una curva, `ctx.inputs.cal` puede ser
`undefined`, `ctx.inputs.t` es una tabla de solo lectura, `ctx.inputs.h` un `Readonly<Record<zoneId, number>>`,
`s.params.grClean` es `number`, y el valor devuelto debe tener `igr: Float64Array`, `total: number`,
`byZone: { rows }` y `perZone: Record<zoneId, number>`.

- **Escalar por zona** (`zoneScalar`): exactamente una clave por cada zona de `ctx.zones` (también las que no tienen
  muestras), `NaN` = sin dato; el motor rechaza claves de más o de menos. Tablas y valores por zona se congelan al
  guardarse en caché: escribir en una entrada de esos tipos falla.
- **Entradas opcionales**: si su fuente no puede correr o falla, el módulo corre sin ella (`undefined`) y se informa;
  no se bloquea por algo opcional.
- `output.table(port, { ..., hidden: true })`: tabla para un panel a medida, no se lista en Resultados.
- `ctx.zones[i].kind` (`formation | reservoir | seal | other`) es parte de la firma.

- `ctx.segments`: tramos contiguos de una misma zona con sus parámetros ya resueltos (para cálculos por muestra).
- `ctx.paramsFor(zoneId)`: parámetros efectivos de una zona (para tablas y sumarios por zona), incluso de zonas
  sin muestras; `paramsFor(null)` = globales.
- `resolveParams` en la definición del módulo permite resolver una familia de coeficientes como unidad. El motor
  y el informe comparten esa resolución. [Permeabilidad potencial de corona](decisiones/0086-permeabilidad-potencial-corona.md).
- `ctx.zones`: zonas en orden de tope, con `id`, `name`, `kind`, `top`, `base`, `start`, `end`.
- `ctx.warn(mensaje, where?)`: aviso para el usuario (p. ej. parámetros incoherentes en una zona). Se vuelve a mostrar
  mientras el resultado siga en caché. `where` es opcional (0072): `{ zoneId }` si el aviso es de una zona (el id de
  `ctx.zones`; el módulo que dice «en la zona X» lo pasa) o `{ depth }` (m) si es puntual. Llega como
  `Diagnostic.zoneId` / `Diagnostic.depth` (`code: 'module-warning'`) y el panel Avisos lo usa para navegar; el texto
  no cambia. Mismo texto en otra zona = otro aviso (la deduplicación compara texto, zona y profundidad).

**Fuentes explícitas con otro rol.** Elegir para un puerto una curva medida que tiene otro rol (p. ej. AT60, rol
`RM`, como `RT`) es intencional y está permitido: el motor la convierte a la unidad del puerto y emite un
diagnóstico `info` ("Se usa la curva 'AT60' (rol RM) como RT por elección explícita."). Si la curva es de otra
magnitud (una densidad como `RT`), la elección se rechaza con advertencia y se usa la fuente por defecto.

`createRegistry` valida todo junto y, si algo está mal, lanza un error con **todos** los problemas: ids repetidos
o mal formados, roles desconocidos, rangos de parámetros inválidos (min ≥ max, default fuera de rango, log con
min ≤ 0), enums sin el default entre las opciones, parámetros compartidos incompatibles, puertos con tipos
distintos en módulos distintos, escalares requeridos que nadie produce, docs faltantes.

### Estado de módulo guardado con la interpretación (`moduleState`, F04)

Lo que un módulo necesita recordar y el motor NO lee (decisiones de la usuaria sobre los resultados, p. ej. los tramos
elegidos como punzados en `pay-intervals`) va en `Interpretation.moduleState[moduleId]`, nunca en un campo nuevo de
`Interpretation` ni en un store propio. Reglas:

- **Formato**: JSON puro (`JsonValue`: objetos planos, listas, textos, números finitos, booleanos, `null`). El
  contenido es del módulo: lo valida al leerlo y tolera lo inválido (lo ignora), porque un archivo viejo o editado
  puede traer cualquier cosa. Ausente = nada guardado; los proyectos anteriores abren igual.
- **Escritura**: solo con la receta `setModuleState(project, wellId, moduleId, value | undefined)`
  (`src/core/state/project.ts`) vía `commit` (panel) o `ViewerData.commit` (superposición). Entra en deshacer, en los
  snapshots (`structuredClone`) y en el archivo/autoguardado. `undefined` borra la clave; sin claves, el campo
  desaparece. Si el valor no cambia, la receta debe devolver el mismo proyecto (no suma un paso de deshacer).
- **No recalcula**: `engineDecisionKey` y `sameEngineInputs` no lo miran; cambiarlo redibuja la interfaz (las
  superposiciones lo leen de `ViewerData.interpretation`) pero no pide un cálculo. Si algo debe cambiar resultados del
  motor, es un parámetro, no `moduleState`.
- **Al abrir**: v6 y anteriores lo sanean (`sanitizeModuleState`: lo que no es JSON puro se descarta con aviso, por
  módulo); v7 lo valida estricto como el resto de la interpretación. Las claves de módulos que no existen se conservan.
- **Referencias a resultados**: si el estado apunta a filas de una tabla (tramos, capas), usar claves estables
  derivadas del contenido (p. ej. `zoneId|tope|base` al cm) y tratar las que ya no coinciden como «huérfanas»
  (informarlas y ofrecer limpiarlas), nunca reasignarlas a otra fila.

## Cómo agregar un módulo

Ejemplo: porosidad efectiva φe = φt·(1 − Vsh), que consume `PHIT` y `VSH` y produce `PHIE`.

1. Función pura y su test en `src/petro/` (esta ya existe):

   ```ts
   // src/petro/porosity.ts
   export function effectivePorosity(phiT: number, vsh: number): number { ... }
   export function effectivePorosityInto(phiT, vsh, out, start = 0, end = phiT.length): Float64Array { ... }
   ```

2. Carpeta `src/modules/phie-vsh/index.ts`:

   ```ts
   import { defineModule, input, output } from '../../core/module';
   import { effectivePorosityInto } from '../../petro/porosity';

   export default defineModule({
     id: 'phie-vsh',
     name: 'Porosidad efectiva — φt·(1 − Vsh)',
     category: 'porosity',
     workspace: 'petrophysics',
     inputs: { phit: input.curve('PHIT'), vsh: input.curve('VSH') },
     params: {},
     outputs: { phie: output.curve('PHIE') },
     compute({ n, inputs }) {
       const phie = new Float64Array(n);
       effectivePorosityInto(inputs.phit, inputs.vsh, phie);
       return { phie };
     },
     docs: {
       summary: 'Porosidad efectiva descontando el volumen de arcilla de la porosidad total.',
       equations: [{ latex: '\\phi_e = \\phi_t\\,(1 - V_{sh})' }],
       references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
     },
   });
   ```

3. Una línea en `src/modules/index.ts`:

   ```ts
   import phieVsh from './phie-vsh';
   export const MODULES = [igr, vsh, /* … */ phieVsh];
   ```

Listo: el panel con sus parámetros se genera solo, el módulo aparece en el selector de método de `PHIE` si hay otro
productor (p. ej. `phie-shale-corrected`), el motor lo encadena detrás de quien produzca `PHIT` y `VSH`, y los
módulos que consumen `PHIE` lo reciben.

Si el módulo usa un parámetro que comparte con otros métodos (a, m, n, Rsh…), no lo copies: agregalo una vez a
`src/modules/sharedParams.ts` y usalo desde ahí, como hace `igr`:

```ts
import { SHARED_PARAMS } from '../sharedParams';
// ...
params: { grClean: SHARED_PARAMS.grClean, grShale: SHARED_PARAMS.grShale },
```

Si el módulo no encaja en ninguna categoría conocida, declarala en el propio módulo, sin tocar el núcleo:
`category: 'sedimentology', categoryLabel: 'Sedimentología'`.

**Módulo de panel** (una herramienta de la interfaz que no es nodo del motor, p. ej. «Preparar datos»): `index.ts`
con `definePanelModule({ id, name, category, workspace, docs })` (sin `inputs`, `outputs`, `params` ni `compute`) y una
línea en `PANEL_MODULES`. El registro valida identidad, categoría y `docs`; aparece en Ecuaciones y su interfaz va en
los archivos descubiertos de la carpeta (`dock.tsx`, `commands.ts`, `overlay.ts`…). Decisión:
[`0058`](decisiones/0058-preparacion-como-modulo.md).

Opcional: un panel a medida en `src/modules/<id>/panel.tsx` que exporte
`export const panel: ModulePanel = { moduleId: '<id>', component: MiPanel }` (contrato en `src/ui/modulePanel.ts`).
Se descubre solo; no hace falta registrarlo.

## Web Worker dentro del HTML único

`src/app/engineBridge.ts` importa `./engine.worker?worker&inline` y `vite.config.ts` fija `worker.format = 'iife'`.
Vite empaqueta el worker aparte (≈ 33 kB, sin React) y lo incrusta como texto en el bundle; en ejecución se crea
desde un Blob URL, que Chromium permite desde `file://`.

`EngineSupervisor` (`src/core/engine/supervisor.ts`) mantiene vivo el motor:
- si el worker no se puede crear o da error antes de su primera respuesta, pasa al motor en proceso
  (`createInProcessClient`, mismo protocolo sobre un `MessageChannel`);
- si da error después de haber respondido (se cayó), lo recrea hasta 2 veces y después pasa al motor en proceso;
- en ambos casos reenvía el pozo y relanza el último pedido, así que la interfaz nunca queda "calculando…".

Cada `ClientResult` lleva `wellId` y `gen` (generación del pozo, única en toda la página). Al cambiar de pozo el
puente pone `result: null` e ignora resultados de otro pozo: nunca conviven arrays de un pozo con la profundidad
de otro.

### Archivos solo-worker (`*.worker-only.ts`)

Las definiciones de módulo se importan en los dos hilos (el registro lo usa la interfaz), así que una dependencia pesada
que solo se ejecuta en `compute` (p. ej. el random forest embebido de `lithology-facies`, ~1,4 MB) entraría dos veces
al HTML. Convención (decisión 0031, D2), genérica para cualquier módulo:

- La dependencia pesada se importa SOLO desde `src/modules/<id>/<x>.worker-only.ts`, que expone una API chica
  (funciones puras).
- Al lado va `<x>.main-thread.ts` con los mismos exports y tipos, sin la dependencia: devuelve `null` (o un valor
  vacío) y el módulo lo traduce en un aviso, nunca en una excepción. Solo se ejecuta si el worker no arrancó y el
  motor corre en proceso.
- El módulo importa `./<x>.worker-only` (con o sin extensión). En el build, el plugin `workerOnlyFiles` de
  `vite.config.ts` cambia en el bundle del hilo principal todo import que resuelva a un `*.worker-only.*` por su
  `*.main-thread.*`; el bundle del worker (que usa `worker.plugins`) recibe el real. En desarrollo y en Vitest se usa el
  real en los dos lados.
- `tests/worker-only.test.ts` exige el par con los mismos exports y que el modelo embebido (`src/ml/embedded.ts`,
  `src/ml/model/`) no se importe desde otro lado. Si un módulo nuevo agrega otra dependencia pesada, sumarla a `HEAVY`
  en ese test.
- Para verificar el build: el texto del modelo debe aparecer una sola vez en `dist/index.html`, dentro del literal del
  worker.

## Guardar / abrir

`serializeProject` / `deserializeProject` (`src/core/state/serialize.ts`): JSON con `format`, `version` (hoy 6: v2
agregó el progreso del flujo, v3 la configuración del visor, v4 las tendencias de cada pozo y snapshot, v5 los
conjuntos de puntos del pozo y las decisiones sobre ellos, v6 la configuración del histograma y del crossplot en
`display.plots`) y migraciones. La fase 7b agregó dos campos opcionales sin cambiar la versión: `display.trackTemplates`
(plantillas de pistas propias) y `TrackSpec.hidden` (pistas de superposición quitadas); un proyecto anterior se abre
sin ellos. La fase 11a sumó del mismo modo `interpretation.toolString` (sarta de perfilaje, 0032), validada al abrir. F04 sumó `interpretation.moduleState` (estado de módulos que el motor no lee; ver «Estado de módulo guardado con la interpretación»). Al abrir, `display` (con `plots` y las plantillas), las tendencias, los
conjuntos de puntos y sus decisiones se validan: lo inválido se descarta con aviso. Los arrays van como Float64 little-endian comprimidos con `CompressionStream('deflate')` (con o sin
"byte shuffle", lo que salga más chico) en base64: exactos bit a bit. Los perfiles del TP quedan en menos de la
mitad del binario sin comprimir.

Guardar, abrir y recuperar corren en el worker de archivos (`src/app/projectFiles/`), una tarea a la vez por cliente:
`save`, `open` y `recover` (`recoverProject`, para un v7 dañado). Si la tarea falla por el contenido del archivo, el
cliente tira `ProjectFileContentError`. Los demás errores (worker ocupado o caído, tiempo agotado, respuesta mal
formada, falta de memoria) son errores comunes: no dicen nada del archivo.

**Autoguardado** (`src/app/autosave/`, docs/decisiones/0071): 3 s después del último cambio, el mismo texto de
`serializeProject` se guarda en IndexedDB (base `fiubalog-autoguardado`). Usa un cliente de archivos propio, para no
chocar con «Guardar proyecto». Guarda la última copia de cada sesión de trabajo, hasta 3 sesiones, y la demostración no
se guarda. Inicio ofrece «Seguir donde quedaste», y la barra superior muestra el estado. `beforeunload` avisa si el
proyecto no está ni en el archivo ni en el autoguardado. `projectActions` le avisa al autoguardado cuando se guarda o
se abre un archivo (`notifySavedToFile`, `notifyOpenedFromFile`). El formato del proyecto no cambia.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm test` | tests (Vitest) |
| `npm run typecheck` | TypeScript estricto sin emitir |
| `npm run build` | genera `dist/index.html` autocontenido |

## Pendientes por fase

| Pendiente | Resolver en | Propuesta |
|---|---|---|
| Slots de cálculo y `compare` en cascada aguas abajo | antes de la fase 9 (snapshots y comparación) | Un "slot" = una asignación de fuentes alternativa; el motor corre la cadena completa por slot (claves `slot:módulo:puerto`), así una alternativa de Sw propaga a k, cutoffs y sumario. |
| Regla por defecto de fuentes para roles calculados (VSH/PHIE/SW de un vendedor le ganan a los módulos sin aviso) | fase 2, con la tabla de mnemónicos | Para roles con `origin: 'computed'`, preferir el módulo y ofrecer la curva del archivo como alternativa, o pedir confirmación al importar; en cualquier caso emitir un diagnóstico `info`. |
| Elegir método por zona para puertos con módulos distintos (Archie en arenas limpias, Simandoux en arcillosas) | cuando se pida | `sources` por zona: el motor arma una curva por tramos con la salida del módulo elegido en cada zona. |
| psia y psig se tratan como psi | cuando haya datos reales | Guardar la referencia por columna y avisar en el asistente si se mezclan (desplaza ~14,7 psi la regla «presión ≥ lodo»). |
| Gradientes de presión en pozos desviados (hoy contra MD; el panel avisa si TVD difiere de MD) | cuando haya un pozo desviado | Serie `mdt` con x = TVD (columna `tvd`) y la pista ubicada por MD. |
| Corrección de Klinkenberg y de presión de confinamiento de los plugs | cuando haya datos reales de laboratorio | El lector (`src/io/core.ts`) elige la columna (Klinkenberg antes que aire) pero no corrige; sumar la columna de presión de confinamiento y un factor opcional. |
| Modelo k–φ por litofacies o capa (hoy global o por zona) | fase 7b | Una tendencia por capa sobre la serie `core` y «Aplicar» a la zona que corresponda; el módulo `perm-core` ya tiene a y b por zona. El crossplot libre filtra por zona y ajusta tendencias, pero sobre curvas del perfil, no sobre plugs. |
| Lazo y tramo del visor sin mouse (tacto, teclado) | antes de la fase 12 | Botón «Seleccionar tramo» que arme un modo en la barra del visor; tope y base con el cursor del teclado (0021). |
| Vista previa de arrastres de superposiciones sin redibujar el canvas base («Marcar zona», tramo del visor) | cuando moleste | Capa de interacción para superposiciones (`frame.invalidateTop()`), como la de `XYPlot` (0021). |
| Pickett sin zona acuífera | cuando se pida | «Ajustar a la envolvente» (percentil bajo de los residuos de ln Rt) como alternativa explícita al ajuste por mediana (0021, D9). |
| Matriz del densidad–neutrón con las cartas CP-1 (curvas) en vez de rectas de mezcla | cuando se pida | Tabular la carta por litología; imán hacia la curva más cercana (`snapMatrixToLithology`, 0015). |
| Líneas de litología curvas en densidad–neutrón (hoy rectas de mezcla matriz–agua) | cuando se pida | Tabular la carta CP-1 del fabricante por litología y dibujarla como `XYLineLayer`. |
| Corrección de φ perfil → corona aplicada a la cadena (hoy la calibración es diagnóstica; 0023) | cuando se pida | Módulo alternativo de `PHIE` con la recta RMA por zona que escribe el panel «Calibración». |
| Puesta en profundidad de la corona en pozos desviados (hoy en MD) | cuando haya un pozo desviado | Igual que los gradientes MDT: variable independiente TVD con la pista ubicada por MD. |

## Sarta de perfilaje (fases 11a–11c)

Decisión: [`docs/decisiones/0032-sarta-de-perfilaje.md`](decisiones/0032-sarta-de-perfilaje.md).

- **Herramientas** (`src/core/tools.ts`): la única tabla rol medido → herramienta (`ToolDef`: roles que registra,
  familia, orden típico, prefijos de mnemónico para desempatar RT de inducción o de laterolog). Los módulos agregan las
  suyas con `tools` en el contrato; el registro las expone en `registry.tools`. El catálogo de pistas del visor agrupa
  las curvas medidas por herramienta. Fichas técnicas aparte (`toolSheets.ts`), con los valores de la investigación de
  la 11b (un test los compara con su JSON; los no verificados van marcados).
- **Estado** en `Interpretation.toolString` (opcional; ausente = modo datos sin nada apagado): modo `data` |
  `planning`, apagadas de los datos, orden propio, sarta planificada y sus apagadas (`planOff`, aparte: planificar no
  cambia la interpretación del modo datos). Recetas en `src/core/state/toolString.ts` (deshacer por
  `commit`); entra en snapshots y en su comparación; campo opcional validado al abrir, sin cambio de versión.
- **Filtro, no edición**: `planGraph` saca de las candidatas las curvas de herramientas apagadas (o, en planificación,
  fuera de la sarta planificada); el visor, el catálogo de pistas y las figuras usan las mismas curvas visibles. Las
  pistas armadas y los datos no cambian. `sameEngineInputs` incluye la sarta.
- **Disponibilidad** (`moduleAvailability`): clausura sobre el registro con las mismas reglas que el motor, incluidas
  las fuentes elegidas a mano y los módulos desactivados (`tests/tool-string-engine.test.ts` lo verifica módulo por
  módulo contra el motor); por módulo, estado (`available`, `needs-data`, `unavailable`, `disabled`), entradas que faltan, datos de la base de
  la cadena que faltan con las herramientas que los dan, y motivo en español. El panel de módulos lo muestra.
- **Configurador y vista 3D** (fase 11c, [`0033`](decisiones/0033-vista-3d-de-la-sarta.md)): botón «Sarta» en la
  barra del visor (o la paleta). La lista ocupa la columna izquierda (como «Armar pistas»; se excluyen) y es donde se
  arma: modo, prender y apagar, reordenar (arrastre o Alt+↑/↓), agregar y quitar en planificación. La vista 3D tapa el
  centro (visor y dock siguen montados debajo, inertes) y solo mira: pozo en corte, herramientas con su montaje y
  cáscaras de profundidad de investigación por curva. Radios y DOI a escala real (1 unidad = 1 cm), largos comprimidos
  5:1. `buildToolStringScene` (puro) → `ToolStringRenderer` (three.js, render a demanda, reutiliza mallas por clave,
  libera todo al desmontar). Sin WebGL 2 la lista y la ficha siguen andando. Colores en `ThemeTokens.scene`. Pulido
  visual (0033 D9): acero con ambiente procedural (`RoomEnvironment` + PMREM), sombras a demanda, ACES; formación de
  contexto con las capas del pozo (litología sugerida o GR) en el tramo que mostraba el visor; cáscaras de vidrio con
  jerarquía por selección; la DOI con su referencia por ficha (`ToolSheet.investigationFrom`).
- **Geometría radial de la sarta (F24).** El perfil de pared e invasión usa la profundidad medida de la grilla efectiva en metros. Cada muestra válida de calibre define una sección circular. El límite lavado proviene del diámetro exterior calculado por `invasion-step:DI`. Ambos diámetros en pulgadas dan radios desde el eje en centímetros al multiplicar por 1,27. `invasion-step:RXO` describe el fluido y la roca de la zona lavada mediante su resistividad en Ω·m. La pared nominal y la invasión ilustrativa por litología cubren independientemente los intervalos sin datos válidos. [Decisión geométrica](decisiones/f24-geometria.md).
- **Inicio** ([`0065`](decisiones/0065-pantalla-de-inicio.md)): la app arranca sin pozo en una capa sobre el armazón
  (que sigue montado e inerte) con la sarta 3D exhibida —la del pozo activo con la misma derivación que el
  configurador, o una composición de demostración rotulada— y la entrada al pozo hacia el visor. `ShowcaseRenderer`
  hereda `ToolStringRenderer` (`RendererOptions`, grupo `content`); bucle solo con giro o entrada y nunca con la pestaña
  oculta; esquema 2D sin WebGL. `?inicio=no` arranca como antes (scripts de QA).

## Petrofísica en módulos (fase 6a)

Decisión y catálogo completo: [`docs/decisiones/0007-modulos-fase-6a.md`](decisiones/0007-modulos-fase-6a.md).

- Cadena: `igr` → `vsh` → `phi-*` → `phit` → `phie-*` · `temp-gradient` → `rw-*` (curva `RW` ya corregida por
  temperatura) → `sw-*` → `bvw-sh`, `perm-*` → `cutoffs` (banderas) → `zone-summary` (tabla + valores por zona) →
  `volumetrics` (OOIP/OGIP por zona y total, m³ estándar; tabla en SI y en unidades de campo). `cutoff-sensitivity`
  produce el barrido de cada cutoff en una tabla oculta que dibuja su panel.
- Espesores netos anidados (arena neta → reservorio neto/permeable → pay neto/útil) y corte opcional de permeabilidad
  (`permCutoffOn` + `permCutoff`, desactivado por defecto; `cutoffs` lee `PERM` como entrada opcional y publica
  además `NET_SAND`, rol declarado por el propio módulo): [`docs/decisiones/0054-cutoff-de-permeabilidad-y-arena-neta.md`](decisiones/0054-cutoff-de-permeabilidad-y-arena-neta.md).
- Los parámetros comunes (a, m, n, Rsh, Δt matriz, Rmf, cutoffs, área, Bo, Bg, fluido) están en `SHARED_PARAMS`.
- Unidades agregadas: múltiplos de volumen (Mm³, MMm³, Mbbl, MMbbl, MMscf, Bcf), `m3/m3`, gradiente de temperatura.

## Interfaz (fase 3)

- **Armazón de tres zonas** (`src/app/App.tsx`): pozo/curvas/zonas · visor + dock · inspector del paso activo.
  Laterales y dock redimensionables y colapsables; medidas en `localStorage` (nunca en el proyecto).
- **Flujo guiado**: `FLOWS[espacio]` en `src/app/flow/flow.ts`. Un paso de módulos toma los módulos de sus
  categorías **o** los que producen sus puertos (Rw: categoría `water` o cualquier productor de `RW`/`RWA`/`TEMP`),
  así que agregar un módulo lo suma al paso sin tocar nada más. Lo derivado (pozo, zonas, puertos calculados) no se
  guarda; las marcas del usuario (completo/saltado) van en `WellEntry.progress` (formato de proyecto v2).
  Cada paso tiene además un eje «revisado» (0073), derivado y sin estado propio: marca manual, parámetro de sus
  módulos distinto del de fábrica (global u override de zona viva), o fuente elegida para sus puertos. `FlowModule`
  lleva `params` y `name`; `FlowContext` suma `params`, `sources` y `zoneIds` opcionales. La barra cuenta «N
  calculados · M revisados».
- **Panel Avisos** (0072, `src/app/diagnostics/`): agrupa los diagnósticos por paso del flujo y por módulo
  (`grouping.ts`, puro), con filtro por gravedad, salto al módulo y a la zona. Las marcas «visto» van en
  `WellEntry.seenDiagnostics?: string[]` (huellas `moduleId|code|zoneId|message`), fuera de `interpretation` como
  `progress`: no recalculan ni entran en snapshots; se guardan en el archivo como campo opcional (sin cambiar la
  versión) y se podan al marcar las de avisos que ya no existen. La insignia cuenta los no vistos.
- **Parámetros compartidos** llevan insignia con los módulos que los usan; "comparar" está en el encabezado del
  módulo; las salidas en comparación (`active: false`) se marcan como "alternativa" en resultados.
- **Tema y canvas**: el visor lee colores con `curveStyle()` y `getThemeTokens().viewer`, y redibuja con
  `subscribeTheme()` (o `useCanvas`).
- **Tamaño de interfaz** (0013): Compacto / Normal (por defecto) / Grande, preferencia en `localStorage`. Escala por
  tokens y `--ui-scale` (no con `zoom`); el canvas recibe el factor como parámetro (`useCanvas`, `FrameInput.uiScale`,
  `OverlayFrame.uiScale`, `drawXYScene(…, ui)`) y las figuras exportadas dibujan siempre con 1. Las medidas del armazón
  se guardan en px de Compacto, con tope automático por ventana hasta que el usuario arrastra un separador. Barra
  superior, de pasos y del visor se compactan por etapas (consultas de contenedor en `em`, abreviaturas de pasos).

## Visor (fase 4)

- `ViewerSlot` toma las pistas del proyecto (`project.display.layouts[espacio]`) o las de fábrica
  (`src/viewer/templates.ts`) y las resuelve con `resolveTracks`: curvas por rol (medidas convertidas a la unidad
  canónica + salidas activas del motor), curvas sin rol por magnitud, y pistas recolectoras para que las salidas de
  módulos nuevos (y sus banderas) aparezcan solas.
- Dibujo en dos canvas (base y cursor) bajo encabezados HTML; un único viewport para todas las pistas; cuadros en
  `requestAnimationFrame` con reducción M4 por fila de píxel (≈ 4 ms por cuadro con el TP, ≈ 6 ms con 50 000
  muestras).
- Superposiciones: contrato `ViewerOverlay` (`src/viewer/overlay.ts`) con dibujo, tooltip, clic, **arrastre**
  (plugs, topes, puntos de tendencias, elegir un tramo), teclado y **pista propia** (presiones MDT); zonas y calidad
  son incorporadas, los módulos agregan las suyas en `src/modules/<id>/overlay.ts`. Leen el pozo y la interpretación
  activos de `frame.data` (solo lectura), sin importar los stores.
- Al abrir un proyecto, `display` se valida: lo inválido se descarta con un aviso.
- El cursor publica su profundidad en `useViewer.cursorDepth`; clic en la franja de zonas fija
  `useUi.editingZoneId`.
- **Lupa** (F17, [ADR 0085](decisiones/0085-lupa-del-visor.md)): la tecla L (paleta y hoja de atajos, grupo «Visor»)
  abre un recuadro que sigue al cursor con su tramo a 1:200 reales (96 ppp; la rueda va de 1:50 a 1:1.000) y Esc lo
  cierra. Es otro viewport sobre el mismo `ViewerRenderer` (`src/viewer/loupeView.ts`: `drawBase` + `drawCursor` en un
  canvas propio), así que hereda escalas, rellenos y todas las superposiciones; la geometría (tamaño, pistas de la
  ventana con la profundidad fija, posición dentro del visor y marca del tramo en la vista general) es pura en
  `src/viewer/loupe.ts`. Se dibuja en el mismo cuadro que el cursor, sin estado en el proyecto: ≈ 0,9 ms por cuadro y
  58–60 cuadros por segundo con el TP moviendo el puntero (`scripts/qa/lupa.cjs`).

## Pistas armables y plantillas propias (fase 7b)

Decisión: [`docs/decisiones/0016-pistas-armables.md`](decisiones/0016-pistas-armables.md).

- **Modo «Armar pistas»** (botón «Pistas» de la barra del visor): el catálogo ocupa la columna izquierda y el visor
  muestra manijas, menús y bordes de ancho en los encabezados, y las pistas que se ocultan vacías (latentes). Se
  arrastra una herramienta o curva a una pista (agregar) o entre pistas (pista nueva); filas y encabezados se
  arrastran para mover o reordenar. Sin mouse: «Agregar a pista…» en cada elemento del catálogo, menú de la manija y
  de cada fila, Alt+flechas y Supr.
- **Catálogo** (`src/viewer/catalog.ts`, puro): grupos por herramienta con la pista completa de fábrica y sus curvas
  (color, escala y rellenos de convención); lo que el pozo no tiene, deshabilitado; los roles de módulos nuevos caen
  en su familia. Pistas especiales: profundidad y zonas, columna volumétrica y las pistas propias de superposiciones.
- **Recetas** (`src/core/state/tracks.ts`): sobre la lista materializada (propias o de fábrica + superposiciones) y
  por id; un `commit` con etiqueta propia por gesto. Las curvas son entradas con selector: soltar del catálogo agrega,
  arrastrar una fila mueve; un grupo (`unassigned`) se expande en curvas puntuales para mover una sola; los rellenos
  de una curva viajan con ella.
- **Plantillas propias** en `display.trackTemplates` (nombre y espacio de trabajo): guardar (reemplaza por nombre),
  aplicar, restablecer la de fábrica, renombrar y borrar. El selector de la barra muestra la aplicada.
- La figura del perfil (0012) resuelve las mismas pistas armadas.


## Vistas guardadas y modo defensa (F07)

Decisión: [`docs/decisiones/0075-vistas-guardadas.md`](decisiones/0075-vistas-guardadas.md).

- **Dónde viven.** `Project.display.views?: SavedView[]` (`src/core/display.ts`): espacio, tramo, copia de las pistas
  propias del espacio (`null` = las de fábrica), rótulo de la plantilla, zona activa (con su nombre), panel a la vista y
  fecha. El orden de la lista es el del recorrido. Se guardan en el archivo y en el autoguardado; un proyecto sin vistas
  no escribe el campo y uno anterior abre igual. `sanitizeDisplay` descarta con aviso lo que no tiene forma de vista
  (sin nombre, sin pozo, tramo inválido, nombre repetido en el pozo).
- **Qué no tocan.** No están en `Interpretation`: no entran en `sameEngineInputs`, en la firma de los módulos ni en los
  snapshots, y no disparan cálculos. Guardar, renombrar, subir, bajar y borrar son recetas puras
  (`src/core/state/views.ts`) con `commit` (se deshacen). `resolveView` dice qué falta (zona borrada, panel quitado, pozo
  ausente); nada impide abrir una vista. Las pistas se copian: tocar la plantilla después no cambia la vista.
- **Ir a una vista** (fuera del modo): espacio, zona activa, panel y tramo a la interfaz; las pistas con un `commit`
  «Abrir vista «X»» solo si difieren.
- **Modo defensa** (`useUi.presenting` + `src/app/views/store.ts`): estado de interfaz, fuera del historial y del
  archivo. Al entrar se toma una **foto** de la interfaz (espacio, zona en edición, paso y módulo, pestaña y vista del
  panel lateral, disposición, lectura amplia, panel agrandado, tramo visible y pozo); cada vista se muestra con un
  parche que parte de la disposición de la foto, y al salir se restaura la foto tal cual (el tramo, si el pozo es el
  mismo). Mientras dura, la disposición no se escribe en localStorage. Si cambia el pozo activo o se reemplaza el
  proyecto, `uiSync` sale antes de corregir referencias.
- **Reemplazo de pistas en el visor.** `ViewerSlot` toma las pistas del modo (`defense.tracks`, o las de fábrica si es
  `null`) en lugar de `display.layouts[espacio]`, sin `commit`: recorrer no cambia el proyecto. La barra del visor queda
  sin herramientas de edición; abajo al centro, el indicador (`DefenseHud`).
- **Armazón y teclado.** Sin barra superior, flujo, columna del pozo ni rieles; el panel de la vista va donde estén los
  paneles. → ← pasan de vista sin vuelta circular y Esc sale (escucha en captura sobre la ventana, antes que el visor);
  Ctrl+Z y Ctrl+Y no hacen nada y la paleta solo ofrece el grupo «Vistas» (`whilePresenting`, `src/app/commands/index.ts`); ↑ ↓, Re Pág, Av Pág, + − y 0 siguen siendo del visor (con el foco suelto al entrar, la
  primera de esas teclas enfoca el visor y se le reenvía). El tramo se pide después de que el armazón se acomoda (dos
  cuadros) y se comprueba contra el visible; si no coincide, se vuelve a pedir.
- **Pruebas.** `tests/views.test.ts` (recetas, saneamiento, resolución, ciclo de cinco vistas por archivo, foto,
  parches, recorrido y teclado con los stores) y `scripts/qa/vistas.cjs` (de punta a punta sobre `dist/index.html`;
  publica el tramo visible en `data-testid="viewer-visible"`).

## Tendencias y gradientes (fase 6b-1)

Decisión: [`docs/decisiones/0008-tendencias-y-gradientes.md`](decisiones/0008-tendencias-y-gradientes.md). Módulo
obligatorio del profesor: tendencia sobre cualquier curva o gráfico, ajuste lineal/log/exp/potencial con ecuación y
R² a la vista (excepción deliberada a «las ecuaciones no se muestran»: es un resultado), a mano, y gradientes en
unidades de campo.

- **Modelo**: `Interpretation.trends: TrendSpec[]` (serie, modelo, ajuste o a mano, tramo de profundidad o zona,
  puntos excluidos por clave estable, extensión). Entra en snapshots y en deshacer; **no recalcula el motor**: la
  firma de los módulos no la incluye y `engineBridge` no pide cálculo si `sameEngineInputs` (zonas, parámetros,
  fuentes, comparar, desactivados) da igual.
- **Series**: `SeriesRef { provider, key }` resuelta por un proveedor (`TrendSeriesProvider`). Incorporado: `curve`
  (curvas medidas en unidad canónica `m:<id>` y fuente activa de un rol `r:<ROL>`; x = profundidad). Un módulo
  agrega proveedores en `src/modules/<id>/series.ts` (MDT: presión vs. profundidad en su pista propia; crossplot k–φ).
- **Ajuste**: `evaluateTrend` (bisección del tramo, excluidos → índices una vez, `fitTrend` O(n) sin asignaciones;
  caché por identidad del spec y la serie). Gradiente = pendiente (lineal) o pendiente en el centro del tramo.
- **Dibujo**: `trendGeometry` con dos mapeos dato→px y `transpose` (visor o crossplot), muestreo adaptativo en px
  (una recta en pista log se dibuja curva), extensión punteada, manijas y etiqueta.
- **Visor**: `createTrendsOverlays` (bandas debajo, líneas encima) compuesta en `ViewerSlot`; herramienta «Tendencia»
  en la barra (elegir tramo arrastrando; a mano de un punto a otro; un `commit` al soltar; Esc cancela), manijas con
  ↑/↓ y Tab, clic en una muestra del tramo de la seleccionada la excluye. Panel «Tendencias» en el dock.
- **Costo** con 50 000 muestras y el tramo creciendo hasta toda la serie: la capa de tendencias (ajuste + muestreo +
  dibujo) suma 2,4 ms de media por cuadro (p95 4,5 ms) en Chromium sin GPU.

## Presiones MDT y conjuntos de puntos (fase 6b-2)

Decisión: [`docs/decisiones/0009-presiones-mdt-y-conjuntos-de-puntos.md`](decisiones/0009-presiones-mdt-y-conjuntos-de-puntos.md).

- **Conjuntos de puntos** (`Well.pointSets`, `src/core/pointSets.ts`): mediciones puntuales en profundidad (presiones
  MDT `kind: 'pressure'`; plugs de corona en la 6b-3) con ids estables y columnas numéricas (con unidad) o de texto
  que define el módulo dueño. Son datos: arrays inmutables, formato v5. Lo que decide el usuario (incluir o descartar
  un punto, etiqueta, puesta en profundidad, ajustes) va en `Interpretation.pointSets`. El motor no los lee: el
  puente sincroniza el pozo solo si cambian su profundidad o sus curvas.
- **Módulo MDT** (`src/modules/mdt/`, sin módulo del motor ni línea en el registro: se descubre por sus archivos):
  `model.ts` (puro: reglas de calidad que proponen descartar, estado efectivo de cada punto, contactos entre gradientes
  de fluidos contiguos), `series.ts` (proveedor `mdt`: presión vs. profundidad de los puntos incluidos; la clave lleva
  el fluido del gradiente; `mdtAnalysis`), `overlay.ts` (pista «Presión» con escala automática y unidad elegida,
  puntos con clic para incluir o descartar, contactos que cruzan todas las pistas), `dock.tsx` (panel),
  `LoadPressuresDialog.tsx` (asistente) y `example.ts` (ejemplo sintético rotulado).
- **Drawdown.** La columna numérica opcional `drawdown` se importa en psi. El modo `display.overlays.mdt.pointColor`
  admite `drawdown`, con el color por fluido por defecto. `ViewerData.overlaySettings` lleva la configuración al visor
  y al exportador. `ViewerOverlay.track.colorLegend` declara la leyenda que ambos dibujan con el dominio canónico de
  la pista, independiente del intervalo visible y de la unidad mostrada.
- **Gradientes** = tendencias lineales sobre la serie `mdt` (`<conjunto>:gas|oil|water`); densidad con
  `gradientReadings` y fluido sugerido con `classifyFluidByDensity` (`src/petro/pressure.ts`). **Contactos** en la
  interfaz (`findContacts` → `intersectTrends`), no en el motor.
- **Contacto como tope (F10).** «Usar como tope de zona» divide la zona que contiene el contacto en su interior,
  con `splitZoneAt`, que reutiliza `addTopAt` del menú del visor y conserva la base original. El nuevo tope se
  ajusta a la muestra MD más cercana y la zona inferior hereda los parámetros de la original. Un solo `commit`
  guarda la división y su herencia. Los sectores con solapes y los contactos en bordes o huecos se rechazan.
- **Pegar topes (F09).** `parseZoneTops` (`src/io/zoneTops.ts`, puro) lee la planilla y devuelve filas, zonas y problemas (error bloquea, aviso no); `zonesFromTops` (`zones.ts`) arma la lista nueva y el diálogo la guarda con un solo `commit(applyZoneEdit)`: un paso de deshacer.
- Contratos nuevos que heredan las fases siguientes: pista propia dinámica (`track.resolve`, ajustes en
  `display.overlays`), `ViewerData.commit` (escritura de superposiciones de módulos sin stores), `OverlayTrack.unit`,
  `TrendTool.series` (herramienta sobre una serie dada), `ResolvedSeries.canvasLabel` y `pickSamples`, superposición
  `trends-lines` (prioridad del puntero: herramienta y manijas > puntos de módulos > líneas) y paneles del dock en
  `src/modules/<id>/dock.tsx`.

## Datos de corona (fase 6b-3)

Decisión: [`docs/decisiones/0010-datos-de-corona.md`](decisiones/0010-datos-de-corona.md).

- **Plugs** = `PointSet` de `kind: 'core'` (`phi`, `k`, `rhog`, `run`, `description`), leídos de Excel, CSV o LAS por
  `src/io/core.ts` (columnas por nombre y unidad, φ en % → v/v, k en mD). Los datos no se tocan: descartar un plug o
  poner la corona en profundidad son decisiones en `Interpretation.pointSets` (snapshots y deshacer).
- **Puesta en profundidad por corona**: `depthShift` (defecto del conjunto) y `runShifts` (por valor de la columna
  `run`). `shiftedDepth(set, decisiones)` (`src/core/pointSets.ts`) es la única forma de ubicar un punto contra los
  perfiles: lo usan series, superposiciones y la sugerencia, también MDT. `suggestDepthShift` (`src/petro/depthMatch.ts`)
  propone el desplazamiento por correlación de Pearson contra PHIE (u otra curva) con advertencias de borde, ambigüedad
  y correlación débil; el usuario lo acepta, lo escribe o arrastra la corona en el visor (un `commit` al soltar).
- **Borrado en cascada**: `removePointSet` borra las tendencias de la serie `<conjunto>[:…]` de cualquier proveedor
  salvo `curve`.
- **Modelo k–φ**: tendencia exponencial sobre el proveedor `core` (`<conjunto>:kphi`: x = φ, y = k, `xIsDepth: false`).
  «Aplicar al pozo» convierte a log10 k = a + b·φ y escribe a y b en el módulo del motor `perm-core` (el worker no ve
  los plugs), con indicador de sincronización; `perm-core` no es la fuente por defecto de PERM (sigue `perm-timur`).
- **Gráfico x–y base** (`src/plots/xy/`): ejes lineales o log por separado, ticks, tendencias y selección por
  rectángulo; es la base del crossplot libre y el histograma de la fase 7.
- **Ejemplo sintético** rotulado (`src/modules/core/example.ts`): dos coronas corridas 2,4 y 1,6 m respecto del perfil;
  la sugerencia recupera el desplazamiento de diseño.
- Archivos: `src/modules/core/` (`model.ts`, `series.ts`, `overlay.ts`, `dock.tsx`, `LoadCoreDialog.tsx`,
  `example.ts`), `src/modules/perm-core/`, `src/plots/xy/`. Tests: `tests/point-sets-shift.test.ts`,
  `tests/petro-depth-match.test.ts`, `tests/perm-core.test.ts`, `tests/io/core.test.ts`, `tests/core-plugs.test.ts`,
  `tests/plots/xy-geometry.test.ts`, `tests/plots/core-overlay.test.ts`.

## Histograma y crossplot libre (fase 7a)

Decisión: [`docs/decisiones/0014-histograma-y-crossplot.md`](decisiones/0014-histograma-y-crossplot.md). Dos módulos
obligatorios del profesor como pestañas del dock (aportadas por `src/modules/histogram/` y `src/modules/crossplot/`).

- **Configuración** en `Project.display.plots[pozo]` (formato v6): curvas, escalas, color, zonas, plantilla, opciones y
  cutoffs libres; recetas `updatePlotConfig`/`setPlotCutoff` por `commit` (deshacer); no recalcula el motor ni entra en
  snapshots.
- **Cutoff arrastrable**: real para curvas con rol VSH/PHIE/SW (escribe `vshCutoff`/`phiCutoff`/`swCutoff` con la
  etiqueta del slider: recálculo en vivo y una entrada de deshacer; global, o de la zona si hay una sola filtrada) o
  libre (solo en la configuración del gráfico). Mouse, teclado (manija `role="slider"`) y quitar.
- **Histograma**: Freedman–Diaconis, escala log por rol, superposición por zona, normalizar a %, acumulada, n, media,
  P10/P50/P90 en un panel aparte.
- **Crossplot**: dos clics, escala log por rol, color por tercera curva (viridis) o por zona, filtro por zonas,
  tendencias sobre la nube (proveedor `crossplot`), plantillas densidad–neutrón, Pickett (a, m, n y Rw del proyecto),
  φ–Sw, GR–Rt y RMN vs. densidad–neutrón (0019).
- **Rangos del crossplot (F11)**: en «Ejes», cada par de campos muestra los límites vigentes. Enter o salir del
  campo confirma un límite, con coma o punto decimal. Si el par no es finito, estrictamente creciente o positivo
  en log, se indica el error y se conservan los límites aplicados. Cada edición válida escribe solo `xRange` o
  `yRange`. «Restablecer» quita el rango fijo de ese eje, incluso cuando venía de una plantilla.
  Cambiar la curva o la opción de escala vuelve a rango automático solo en ese eje. Al intercambiar X e Y, los
  rangos acompañan a las curvas. Los rangos fijos se conservan al filtrar y al volver a un pozo ya configurado.
  Se usa el formato de proyecto existente: si falta el rango, se calcula automáticamente; un rango anterior con
  mínimo no positivo en log se conserva en el archivo y se usa el automático al dibujar.
- **Visor**: punto o clase bajo el puntero y selección por rectángulo se marcan en el visor (superposición `plot-link`,
  estado en `src/plots/link.ts`); el cursor del visor resalta el punto de esa profundidad (`useViewer.cursorDepth`).
- **Rendimiento**: nube en lotes por color, grilla de búsqueda, capa de interacción aparte; 50 000 muestras siguen
  fluidas al pasar el puntero.

### Parámetros elegidos sobre los gráficos (fase 7b)

Decisión: [`docs/decisiones/0015-parametros-sobre-graficos.md`](decisiones/0015-parametros-sobre-graficos.md). GR limpio
y de arcilla en el histograma de GR, punto de matriz en el densidad–neutrón (ρma y corrección del neutrón) y recta de
agua del Pickett (trasladar = Rw de referencia convertida con Arps desde la mediana de TEMP de los puntos visibles;
rotar = m). Misma regla de alcance, vista previa en vivo y deshacer que los cutoffs, con agrupado por **gesto** en el
historial (un Ctrl+Z por arrastre; Escape vuelve a antes del gesto). Si el módulo del parámetro no alimenta la cadena,
aviso y acción explícita («Usar Rw manual»). Lo puro en `src/plots/params.ts` y `src/plots/crossplot/drag.ts`; las
manijas 2D son una capa genérica de `XYPlot` (`XYHandle`).

### Gráficos conectados y Pickett interactivo (fase 8b)

Decisión: [`docs/decisiones/0021-graficos-conectados-y-pickett.md`](decisiones/0021-graficos-conectados-y-pickett.md).

- **Una sola selección compartida** (`src/plots/link.ts`): máscara sobre las muestras del pozo con su fuente y detalle; la
  crean el crossplot (Rectángulo o Lazo, Mayús suma), el histograma (clic en una clase, Mayús + clic suma o quita) y el
  visor (**Mayús + arrastre** marca un tramo; `OverlayPointer.shiftKey`, aditivo). El visor la marca como tramos, el
  crossplot resalta sus puntos y atenúa el resto (capa intermedia de `XYPlot`: el puntero no redibuja nada) y el
  histograma superpone su distribución con una fila de estadísticos. Lo puro en `src/plots/selection.ts` (punto en
  polígono en fracciones de eje, tramo → muestras, clases → muestras, máscara → tramos y → puntos de una nube).
- Estado de interfaz, no pasa por `commit`. Se limpia con Escape (visor, gráfico o sin foco), «Limpiar», la ficha «Sel.»
  de la barra del visor, la paleta de comandos y al cambiar de pozo (`uiSync`).
- «Excluir del ajuste los puntos seleccionados» en las tendencias del crossplot (`excludeTrendPoints`, un Ctrl+Z).
- **Pickett**: zona acuífera elegida en el gráfico (`CrossplotConfig.pickettWaterZones`, aditivo en `src/core/plots.ts`;
  `ZoneKind` no cambia); «Ajustar recta a la zona acuífera» (`src/plots/crossplot/pickett.ts`): puntos limpios, Rt llevada
  a la temperatura de referencia con Arps por punto, m por mínimos cuadrados recortados de ln Rt sobre ln φ (cota inferior;
  el panel muestra la superior), Rw tal que la mediana de Sw de Archie en los puntos retenidos sea 1; si la zona no
  determina m (n_ef < 10, < 5 m, P90/P10 < 2, error estándar > 0,12 o fuera de 1–3,5: criterios prácticos), se conserva m y
  la Rw queda condicionada a ella; avisa si la dispersión de Rt supera 0,3. Misma regla de alcance, vista previa rayada y un Ctrl+Z. Con dos o más zonas filtradas y
  alguna con valores propios, una recta de agua por zona que escribe solo su zona; con alcance global el rótulo avisa
  las zonas con valor propio.
- Ampliaciones aditivas de `src/plots/xy/`: `selectTool`/`onSelectLasso`/`selectionShapes`, `emphasis`, `markedBins`/
  `onBarClick`, `onEscape`, `XYHandle.labelOnActive`, `XYPointLayer.ring`, `XYLineLayer.preview` (no sale en la figura).

### Crossplots de determinación de litologías (Clase 8)

Decisión: [`docs/decisiones/0059-crossplots-de-litologia.md`](decisiones/0059-crossplots-de-litologia.md).

- Seis plantillas más (`sonic-neutron`, `density-sonic`, `m-n`, `rhomaa-umaa`, `pe-k`, `pe-thk`) con el mismo patrón que
  `th-k` y `pe-density`: id en `CROSSPLOT_TEMPLATES`, definición en `CROSSPLOT_TEMPLATE_DEFS` (ahora con `group`, `zoneColor`
  y `needs`) y capas puras en `lithologyTemplateLayers` (`src/plots/crossplot/templates.ts`) con los datos de
  `src/petro/lithologyIndices.ts`. El menú las agrupa en «Litología y mineralogía» y «Porosidad y fluidos» y muestra el
  motivo de las que no se pueden armar; una curva derivada que existe pero quedó sin dato también deshabilita la plantilla.
- Módulo `lithology-indices` (Geología): M, N, Umaa y Th/K por muestra (roles `M`, `N`, `UMAA`, `THK`);
  ρmaa sigue saliendo de `core-calibration`.

### Distribución de la arcilla: Thomas–Stieber (Clase 8)

Decisión: [`docs/decisiones/0061-distribucion-de-arcilla-thomas-stieber.md`](decisiones/0061-distribucion-de-arcilla-thomas-stieber.md).

- Motor puro `src/petro/clayDistribution.ts`: las cinco rectas y los dos vértices del diagrama como funciones de
  (φsand, φsh), clasificación por muestra (laminar / dispersa / estructural / sin clasificar, banda laminar ±τ) y
  estimación de los extremos de los datos. Tests: `tests/petro-thomas-stieber.test.ts`.
- Módulo `clay-distribution` (categoría Arcilla, Petrofísica y Geología): entradas VSH y PHIT, parámetros por zona
  `phiSand`, `phiShale` y `bandTolerance`; salidas la curva de código `CLAY_DIST` (rol propio) y la tabla por zona
  `CLAY_DIST_ZONES`. Tests: `tests/modules-clay-distribution.test.ts`.
- Plantilla `thomas-stieber` del crossplot libre (sección «Litología y mineralogía»): los extremos son manijas que se
  arrastran en vertical y escriben los parámetros del módulo (`PLOT_PARAMS.phiSand`/`phiShale`, `clayEndpointWrite`,
  un Ctrl+Z por gesto, 0015); «Estimar de los datos» escribe los dos en un `commit`. Mientras el motor recalcula, el
  panel conserva la última curva de un eje calculado (si no, el gráfico se desmontaba en medio del arrastre). Tests:
  `tests/plots/thomas-stieber.test.ts`; navegador: `scripts/qa/thomas-stieber.cjs`.

## Perfil radial de invasión (fase 8b)

Decisión: [`docs/decisiones/0020-perfil-radial-de-invasion.md`](decisiones/0020-perfil-radial-de-invasion.md).

- **Motor** `src/petro/invasion.ts`: perfil escalonado (Rxo, di, Rt) en conductividad, ajustado a la inducción de arreglo
  (AT10…AT90, roles `RA10`/`RA20`/`RA30`, `RM` = AT60, `RT` = AT90) con factores geométricos radiales aproximados
  (logística en ln r) y mínimos cuadrados separables. Estados por muestra: ajuste bueno, di mal determinado (con intervalo
  `diLow`–`diHigh`), no resuelto (borde de la grilla o σ en su cota), sin invasión visible e insuficiente. di es orden de
  magnitud; Rt de los ajustes interiores es lo más robusto.
- **Módulo** `invasion-step` (categoría «Resistividad»): curvas `RXO`, `RT` (alternativa a la medida, que sigue ganando
  por defecto), `DI` e `INV_MISFIT`; en las curvas, RXO y DI quedan sin dato si di no está bien determinado. Trépano de la
  curva BS o del parámetro.
- **Vista**: pestaña «Perfil radial» del dock (`invasion-step/dock.tsx`; lógica pura en `radial.ts`, dibujo en
  `draw.ts`): a la profundidad del cursor (o fijada, con línea en el visor), corte pozo / zona lavada / formación virgen
  con las campanas de sensibilidad de cada curva, lecturas medidas y modeladas sobre el perfil ajustado (eje radial log de
  2 a 200 in) y resumen con estado. Mismas entradas y parámetros por zona que el módulo; se exporta como figura.

## Modelos de Sw, fichas de zona y paleta de comandos (fase 7c)

Decisión: [`docs/decisiones/0018-sw-lado-a-lado-fichas-y-comandos.md`](decisiones/0018-sw-lado-a-lado-fichas-y-comandos.md).

- **Pista «Modelos de Sw»** (`src/viewer/swModels.ts`): Archie, Simandoux e Indonesia como entradas `{ role: 'SW', module }` con
  estilo propio y una banda entre la mínima y la máxima (relleno `range`); «Ver modelos de Sw lado a lado» activa la comparación
  y agrega la pista en un solo `commit`.
- **Fichas de zona** (`src/modules/zone-cards/`): pestaña «Zonas» del dock con espesores, φ y Sw del pay, volumen in situ, semáforo
  de pay y minigráficos, leídos del sumario y del volumétrico; clic lleva el visor a la zona.
- **Paleta de comandos** (`src/ui/commands.ts`, `CommandPalette.tsx`): Ctrl/Cmd+K, búsqueda difusa sin acentos y hoja de atajos
  («?»). Un archivo `commands.ts` en una carpeta de `src/app/` o de un módulo exporta `commands: CommandSource` y se descubre solo,
  como `dock.tsx`.

## Deshacer y rehacer

Decisión: [`docs/decisiones/0006-deshacer-rehacer.md`](decisiones/0006-deshacer-rehacer.md).

- **Lógica pura** en `src/core/state/history.ts`: pilas pasado/futuro de `{ project, label, at }` con el proyecto
  *anterior* a cada cambio (barato: estructuras compartidas, los `Float64Array` no se copian). Hasta 100 entradas;
  un cambio nuevo vacía el futuro.
- **Agrupado**: cambios seguidos con la **misma etiqueta** a menos de 800 ms del anterior se funden en una entrada
  que conserva el proyecto previo al primero (un slider arrastrado, ↑/↓ en un campo, un tope movido con el
  teclado: un Ctrl+Z vuelve al valor inicial). Deshacer o rehacer corta el grupo. Un arrastre del visor ya es un
  solo `commit` al soltar.
- **Gesto** (0015, D2.1): `commit(etiqueta, receta, { group })` funde los cambios del mismo gesto sin límite de tiempo
  (los arrastres de los gráficos recalculan en vivo y siguen siendo un Ctrl+Z aunque se pause); un gesto abre siempre
  su propia entrada y `cancelGroup(group)` (Escape) vuelve al proyecto de antes del gesto sin dejar entrada.
- **Qué entra**: todo `commit` (parámetros, fuentes, zonas, roles, display de curvas, snapshots, cargar o cambiar de
  pozo). `replace` (abrir un proyecto) vacía el historial. El motor recalcula solo, porque cambia la interpretación.
- **Store**: `useProject` expone `undo()`, `redo()`, `canUndo`, `canRedo`, `undoLabel`, `redoLabel`.
  `src/app/store/uiSync.ts` corrige referencias de interfaz que quedan colgadas (zona en edición borrada, sin pozo
  activo, módulo inexistente); el visor suelta el elemento activo de una superposición si ya no está.
- **Interfaz** (`src/app/shell/historyActions.ts`): botones en la barra superior con «Deshacer: …» en el tooltip,
  aviso «Se deshizo: …» / «Se rehízo: …». Ctrl/Cmd+Z deshace; Ctrl/Cmd+Mayús+Z y Ctrl+Y rehacen. Con el foco en un
  campo de texto queda el deshacer del navegador; durante un arrastre en el visor (`useViewer.dragging`) no pasa
  nada.

## Abierto

- Cancelar un cálculo largo a mitad de camino (hoy se coalesce entre cálculos, no dentro de uno). Si Monte Carlo
  necesita correr en paralelo con la interacción, usar un segundo worker con su propio `Engine`.
- Enlazar el valor de un parámetro a un escalar calculado (hoy un escalar puede ser entrada de un módulo, no el
  valor de un slider).

## Resonancia magnética (fase 8a)

Decisión: [`docs/decisiones/0019-rmn.md`](decisiones/0019-rmn.md). Módulo `nmr-fluids` (FFI, CBW, Swirr, Δφ y bandera
de déficit; motor `src/petro/nmr.ts`). Pista «RMN» (`NMR_TRACK`): escala 0,5 → 0 compartida, rellenos BVI / FFI / CBW
desde el borde derecho y la PHIE de densidad–neutrón en rojo encima; de fábrica en Geología y como herramienta del
catálogo. La bandera va a «Indicadores». Plantilla de crossplot `nmr-dn` con la recta 1:1 y el umbral de déficit.

## Calibración con corona (fase 8, función N)

Decisión: [`docs/decisiones/0023-calibracion-con-corona.md`](decisiones/0023-calibracion-con-corona.md). Una carpeta,
`src/modules/core-calibration/`, sobre el motor puro `src/petro/coreCalibration.ts` y los plugs de la 6b-3.

- **Módulo del motor** `core-calibration` (categoría Porosidad): curva `RHOMAA` = (ρb − φt·ρf)/(1 − φt) con PHIT de
  densidad–neutrón (no PHIE: el agua ligada contaría como matriz), tabla `RHOMAA_ZONES` (mediana, P10, P90 de las
  muestras con Vsh ≤ Vsh máx., y el pozo completo) y valor por zona `RHOMAA_ZONE`. Avisa si PHIT sale solo de la
  densidad (ρmaa circular). La curva entra sola en el visor, el catálogo de pistas, el histograma y el crossplot libres.
- **Panel «Calibración»** del dock (`dock.tsx`, lógica pura en `model.ts`): plugs incluidos en su profundidad corregida
  (`shiftedDepth`; nunca recalcula desplazamientos), φ perfil vs. φ corona con 1:1, RMA y OLS, n, sesgo, RMSE y R²
  (curva y ventana ±h en los ajustes del conjunto); densidad de matriz (grano, ρma que iguala φD con φ corona, ρmaa de
  la zona con su histograma) con «Aplicar» a `phi-density.rhoMa`; exponente m desde F de los plugs (a fija y libre) o
  desde Rt y Rw vigentes en zonas acuíferas (mediana), con «Aplicar» a a y m de Archie. Alcance global o de una zona
  (por defecto la de los plugs); cada «Aplicar» es una receta y un Ctrl+Z.
- **Lector y ejemplo**: columna opcional `ff` (factor de formación) en `src/io/core.ts`; los plugs de ejemplo la traen
  con m = 1,85 (otra semilla: el resto del ejemplo no cambia).
- Tests: `tests/modules-8n-core-calibration.test.ts` (módulo, cadena con el motor en el demo y el TP, modelo del panel,
  lector y ejemplo).
- **Exponente de saturación n** ([`0053`](decisiones/0053-exponente-de-saturacion-desde-corona.md)): conjunto de
  puntos `core-ri` (pasos RI–Sw por plug, lector `src/io/coreRi.ts`), ajuste por el origen (recomendado) y libre en
  `src/petro/coreCalibration.ts`, sección «Exponente de saturación n» del panel con n por plug, «Aplicar n» y el resumen
  «Archie desde corona» con «Aplicar a, m y n» en una receta. Tests: `tests/petro-exponente-saturacion.test.ts` y
  `tests/modules-core-ri.test.ts`.
- **Datos reales del TP embebidos** ([`0056`](decisiones/0056-datos-reales-del-tp-embebidos.md)): los 151 plugs de
  las dos coronas (12 con F) y el ensayo RI–Sw de la cátedra viven en `src/modules/core/tpData.ts` (generado por
  `scripts/qa/tp-lab-data.py`); `tpCoreSet` (`src/modules/core/tp.ts`) y `tpRiSet`
  (`src/modules/core-calibration/tpRi.ts`) arman los conjuntos, rotulados «Datos del TP» (no sintéticos), con la
  profundidad del Excel ya en profundidad del perfil y los 12 puntos RI individuales descartados por defecto. Tests:
  `tests/tp-datos-corona.test.ts`.
- **Presiones MDT y SCAL del TP embebidos** ([`0057`](decisiones/0057-mdt-y-scal-del-tp-embebidos.md)): las 58
  pruebas de la hoja MDT (`tpMdtSet`, `src/modules/mdt/tp.ts`, botón «Cargar presiones del TP», sin gradientes
  automáticos) y las 8 muestras de la hoja SCAL en el panel «SCAL» del módulo `swi-pc`. Tests:
  `tests/tp-datos-mdt-scal.test.ts`.

## Tipos de roca (fase 8, función P)

Decisión: [`docs/decisiones/0024-rock-typing.md`](decisiones/0024-rock-typing.md). Una carpeta,
`src/modules/rock-typing/`, sobre el motor puro `src/petro/rockTyping.ts` y los plugs de la 6b-3.

- **Módulo del motor** `rock-typing` (categoría Permeabilidad): con PHIE y la PERM vigente, curvas `FZI` y `R35` (µm,
  unidad `um` nueva) y `ROCK_TYPE` (clase: unidad de flujo por bandas de FZI o clase de garganta de Winland), tabla
  `ROCK_TYPES` por clase. Parámetros globales: método, número de unidades (2–6) y límites de FZI.
- **Panel «Tipos de roca»** (`dock.tsx`, lógica pura en `model.ts`): Winland/Pittman (k–φ con isolíneas de radio),
  unidades de flujo (RQI–φz, Fisher–Jenks o manual, tabla) y presión capilar del EJEMPLO DE LIBRO (Pc–Sw, J de
  Leverett, gargantas de Washburn). «Llevar al pozo» escribe método y límites (una receta, un Ctrl+Z); avisa si PERM no
  sale del modelo k–φ de corona. Preparado para Pc–Sw digitalizado (`kind: 'capillary'`, sin lector todavía).
- **Pista «Tipo de roca»**: superposición con pista propia (`overlay.ts`), sin tocar el núcleo del visor; colores de
  clase compartidos con el panel (`draw.ts`, rampa viridis).
- Tests: `tests/modules-8p-rock-typing.test.ts`.

## Swi desde SCAL (tarea 8)

Decisión: [`docs/decisiones/0055-swi-desde-scal.md`](decisiones/0055-swi-desde-scal.md). Módulo `swi-pc` (categoría
Saturación) sobre el motor puro `src/petro/swiPc.ts`: curva `SWI` por ley de potencia en √(k/φ) con los seis niveles de
presión capilar de la planilla de la cátedra (o A y B manuales), bandera `SW_LT_SWI` (Sw < Swi − tolerancia) y tabla
`SWI_ZONES` por zona. Entradas `PERM` y `PHIE`, `SW` opcional; roles `SWI` y `SW_LT_SWI` declarados por el módulo;
`SWI` se dibuja punteada sobre `SW` en la pista «Porosidad · Sw» de fábrica. El motor también trae el ajuste log–log
(`fitSwiPowerLaw`) y el de la presión de desplazamiento (`fitDisplacementPressure`); el panel «SCAL» del dock
(`src/modules/swi-pc/dock.tsx`, [`0057`](decisiones/0057-mdt-y-scal-del-tp-embebidos.md)) muestra los datos SCAL del TP,
ese ajuste, las seis curvas con su rango y «Usar nivel N». Los
coeficientes son dato de la cátedra y valen en su rango de √(k/φ). Tests: `tests/petro-swi-pc.test.ts` (valores de mano
y de numpy, `scripts/qa/swi-pc-reference.py`) y `tests/modules-swi-pc.test.ts` (módulo con el motor).

## Preparar datos (módulo de panel)

Decisión: [`docs/decisiones/0058-preparacion-como-modulo.md`](decisiones/0058-preparacion-como-modulo.md). La
preparación (exclusión, espurios, interpolación, mediana, alineación, corridas, DRX y calibración GR, diagnóstico
ambiental, MGT) es el módulo de panel `preparation`: pestaña «Preparar datos» del dock, abierta desde la columna
izquierda, la paleta («Abrir Preparar datos») o la tarjeta del paso Calidad (`openPreparation`). Flujo: tarjeta de
curva → herramienta (sliders sobre un borrador) → vista previa viva con el motor aislado de snapshots → «Aplicar» (un
`commit`, un deshacer). La tubería (`pipeline.ts`) muestra las etapas en el orden del motor con conteos que salen de
las banderas `Quality`; el gráfico antes/después y la barra de los nueve bits se dibujan en canvas (`draw.ts`). La lógica
y el formato v7 viven en `src/core/preparation/` y `src/core/state/`. Tests:
`tests/modules-preparation.test.ts`, `tests/preparation-panel.test.ts`, `tests/preparation-open.test.ts`.

### Normalización de curvas

Decisión: [`docs/decisiones/0060-normalizacion-de-curvas.md`](decisiones/0060-normalizacion-de-curvas.md) (Clase 8,
slides 9–10). Etapa del motor después de la alineación: Exclusión → Interpolación → Mediana → Alineación →
**Normalización** → Preparada. Lleva percentiles (definición 7) de la curva en un intervalo de referencia a valores que
ingresa el usuario: dos puntos (escala y corrimiento) o un punto (desplazamiento o escala), sobre toda la curva.

- Receta: nodo `linear-normalization` (`src/core/preparation/state.ts`), última etapa con las anteriores opcionales
  (`withNodeStages(…, normalization)`); `PreparationState.schemaVersion` 6 solo si hay normalización (versión mínima del
  contenido: los estados 1–5 abren y se guardan idénticos; el archivo sigue en v7). Se guardan niveles de percentil y
  referencias; los percentiles de origen se recalculan al evaluar y viajan en `PreparedPayload.normalization`.
- Matemática pura: `src/core/preparation/normalization.ts` (percentiles, inversa para los marcadores, anclajes, dominio
  físico por rol, etapa del evaluador). Mínimo de 50 muestras de origen (finitas, sin excluidas ni faltantes
  estimados). Bandera `Quality.Normalized` = 256; fuera del rango físico del rol: el valor se conserva con 128.
- Interfaz: herramienta «Normalizar» (`NormalizationEditor.tsx`, `NormalizationHistogram.tsx`, puro
  `normalizationView.ts`, dibujo en `draw.ts`): histograma antes/después con frecuencia acumulada, marcadores
  arrastrables (Escape cancela), referencias numéricas, vista previa local inmediata y del motor; paleta «Normalizar
  curva». Exportación (descripción de la curva y de su `_QC`) e informe de preparación (tabla «Normalización de
  curvas»).
- Verificación: `tests/preparation-normalization.test.ts` (referencia numpy `scripts/qa/normalization-reference.py`,
  esquema v6, migración con el fixture `tests/fixtures/preparation-legacy-v1-v4.json` generado con el código anterior),
  `tests/preparation-normalization-panel.test.ts` y el guion de navegador `scripts/qa/normalization-panel.cjs`.

## Log Digitizer: motor de digitalización de registros escaneados (fase 1)

Decisión: [`docs/decisiones/0062-log-digitizer-motor.md`](decisiones/0062-log-digitizer-motor.md). Herramienta de
**adquisición de datos** (no de cálculo petrofísico): convierte la imagen de un registro en curvas digitales que se
importan a un pozo (`origin.kind = 'measured'`, fuente «Log Digitizer») o se exportan a LAS/CSV.

- Motor puro en `src/digitizer/`, sin dependencias nuevas, sin DOM: la imagen entra como `RasterImage` (RGBA, igual que
  `ImageData`) y todo sale en `Float64Array` y objetos simples (pensado para un Web Worker, con progreso y `AbortSignal`).
- Flujo: geometría (`rotateImage`, `rectifyQuad`, `applyGeometry`) → calibración (`buildDepthCalibration`,
  `ValueFrame` + `AxisScale` de `viewer/scale.ts`) → color (`suggestCurveColors`, máscaras) → `traceCurve` (Viterbi,
  automático o guiado) → serie física (`traceToSeries`) → remuestreo (`resampleToUniform`, `resampleToIndex`) → calidad
  (`assessQuality`) → pozo (`addDigitizedCurveToWell`, `createWellFromDigitized`) o archivo (`digitizedExportInput` →
  `writeLas`/`writeCsv`). `digitizeCurve` encadena máscara → trazo → serie → calidad.
- El índice de profundidad es común al pozo: la curva se remuestrea al índice existente (NaN fuera del tramo, sin
  extrapolar) o se crea un pozo nuevo con índice uniforme.
- La sesión (`DigitizerSession`: imagen por huella, geometría, calibración, curvas, trazos) es JSON puro y se guardará
  aparte del proyecto (fase 2).
- Verificación: `tests/digitizer/` (generador sintético con verdad conocida, caso realista con el GR y el AT90 del TP,
  rendimiento en 1.500 × 12.000 px).

## Log Digitizer: mesa de digitalización (fase 2)

Decisión: [`docs/decisiones/0063-log-digitizer-interfaz.md`](decisiones/0063-log-digitizer-interfaz.md).

- Módulo de panel `src/modules/digitizer/` (categoría «Adquisición de datos», `docs` en Ecuaciones) registrado en
  `PANEL_MODULES`: pestaña del dock «Digitalizar», acción «Abrir Log Digitizer» y botón en «Datos del pozo» (por id de
  acción). La mesa es un `Dialog size="full"` montado por la pestaña del dock; su estado (zustand) sobrevive a cerrarla.
- Worker propio `digitizer.worker.ts` (`?worker&inline`) con progreso y cancelación (terminar el worker); camino sin
  worker para Vitest.
- Persistencia: la curva entra al proyecto como curva medida (v7 sin cambios, un `commit` deshacible); la sesión de la
  mesa (imagen incrustada, calibración, trazas) se guarda aparte como JSON.
- Verificación: `tests/digitizer-ui/`, `tests/modules-digitizer.test.ts` y los guiones `scripts/qa/log-digitizer.cjs` y
  `scripts/qa/log-digitizer-perspectiva-sesion.cjs` (clics reales sobre el HTML construido; este último con su generador
  `scripts/qa/make-digitizer-scan.py`: perspectiva de 4 esquinas, curva sin rol en el visor y «Abrir sesión»).
- «Mostrar en el visor» (paso de salida): crea una pista propia por curva agregada, junto a la profundidad y con la escala
  impresa del registro; las curvas sin rol no están en las pistas de fábrica, que se arman por rol (0063).
- Fase futura (propuesta, no implementada): lectura de PDF con pdf.js en la etapa de entrada, sin tocar el motor.
  Ver [`0064`](decisiones/0064-log-digitizer-lectura-de-pdf.md).

## Notas de profundidad (F05)

`Interpretation.notes?` contiene notas JSON (`id`, `text`, `top`, `base?`) en metros MD. No participa de
`sameEngineInputs`: anotar no cambia curvas ni parámetros. Las recetas de `core/state/notes.ts` conservan
inmutabilidad e historial; mover traslada el intervalo completo y lo acota al pozo manteniendo espesor.
Los lectores v6/v7 aceptan el campo opcional en pozos y snapshots; los archivos anteriores no lo requieren.
`viewer/overlays/notes.ts` comparte dibujo entre pantalla y figuras PNG/SVG, con instancias separadas para
que el arrastre provisional no contamine exportaciones. El informe copia las notas y escapa el texto.
Se crean/editan/borran desde «Notas de profundidad…» en el menú contextual del perfil (también Shift+F10).

### F20: densidad estimada en derrumbes

Decisión científica: [0077](decisiones/0077-reconstruccion-densidad.md). `density-reconstruction` es una receta exclusiva
sobre RHOB original en g/cm³. Exige preparación esquema 7, dentro del proyecto v7; esquemas anteriores conservan sus
claves y siguen admitidos. Guarda solo intervalos MD de buen pozo/derrumbe, referencias de predictores y declaraciones
explícitas de confianza por intervalo. No consume notas, resultados petrofísicos ni curvas preparadas como predictores.
Todos los originales, roles, unidades y mnemónicos de los predictores quedan fijados por la revisión de entrada; cambiar
cualquiera bloquea la receta. La procedencia hereda la unión de herramientas de densidad y predictores.

`setDensityReconstruction` acepta la receta sin cambiar fuentes. `activateDensityReconstruction` representa la elección
expresa posterior a una previsualización aceptada; retirar la receta vuelve explícitamente al original. No se combinan
máscaras, interpolación, filtros, alineación ni normalización con esta receta. `MaskEvaluator` ejecuta el modelo puro en
el coordinador del motor; conserva caché por contexto y reserva 32 MiB de trabajo dentro del presupuesto de 128 MiB.
El modelo limita la entrada a 20.000 muestras; el ajuste es síncrono dentro del worker y se comprueba cancelación antes
y después, sin publicación parcial. La cancelación de una tarea ya ajustándose espera el retorno del modelo.

`PreparedPayload.density` transporta bandas inferior/superior, estado por muestra y reporte de validación. Son derivados,
no JSON del proyecto. Las bandas y estados se copian y transfieren con el paquete completo; snapshots contabilizan esos
bytes y recalculan con sus originales y receta fijados. La frontera cliente comprueba dimensiones, estados respecto de
la máscara explícita de derrumbe, flags, contadores, bandas respecto del semiancho y puertas científicas del reporte.
QC512 distingue estimación ML; QC1024 indica que no se obtuvo una estimación válida, conservando QC1 si faltaba el
original. En derrumbes sin soporte o con validación rechazada la preparada contiene NaN, mientras el original permanece
accesible. Fuera del derrumbe la preparada conserva el original sin banda. Un modelo rechazado permite auditar el
reporte en preview, pero una fuente seleccionada que no supera validación bloquea la evaluación, también con caché;
nunca vuelve automáticamente a los originales.

Exportación de datos agrega dos columnas de banda nominal 90%, calidad y parámetros/métricas/procedencia de la curva.
Las métricas proceden de buen pozo retenido: no hay verdad de densidad en derrumbes del TP. El ledger ambiental queda
vacío: esta estimación estadística no declara corregidos efectos físicos de herramienta. La comparación de fuentes y
porosidad usa las vistas originales y la cortina de snapshots existente.

## Torneo exploratorio contra corona (F22, ADR 0078)

`src/petro/modelTournament.ts` define 75 combinaciones Vsh × PHIT × Sw y reutiliza el motor productivo. El motor admite `targetModuleIds` opcional para ejecutar la clausura de dependencias del plan completo ya resuelto; el torneo solicita Vsh, PHIT y el Sw candidato, evitando consumidores ajenos sin cambiar defaults ni fuentes. Evalúa PHIT contra φ de laboratorio en MD corregida, conserva métodos/fuentes restantes y preparación, y separa cobertura propia de pares comunes. No mezcla variables en una puntuación. Vsh y Sw quedan no evaluables sin referencias compatibles; cobertura calculada no equivale a validación. Las observaciones declaradas de ajuste quedan excluidas y guardadas en evidencia JSON; todo resultado es exploratorio.

`src/core/tournament/observations.ts` obtiene plugs incluidos, convierte unidades y exige alineación explícita; `run.ts` valida el contexto y ejecuta la preparación central, incluidas recetas F20, antes de evaluar. `src/app/tournament/` contiene tarea worker inline propia y cliente con timeout, sin fallback pesado sincrónico ni dependencia de slots pendientes. No transfiere buffers de originales.

`recipe.ts` rechaza resultados de otro contexto u obsoletos y candidatos sin soporte común o sin salidas calculadas. Una operación fija revisiones, aplica la interpretación exacta del candidato y guarda evidencia y snapshot comparable. La operación completa entra en deshacer/rehacer. El panel `src/modules/model-tournament/` informa métricas, soporte, límites y selección explícita; documentación matemática en Ecuaciones. Ninguna combinación es una ganadora integral cuando faltan referencias Vsh/Sw.

## Saturación por altura (F21, ADR 0079)

`src/petro/saturationHeight.ts` ajusta y comprueba gradientes verticales de dos fases, contrasta referencias FWL externas y evalúa tablas Pc–Sw o Brooks–Corey dentro del soporte declarado. El adaptador en `src/app/saturationHeight/model.ts` usa las pruebas de tendencias MDT seleccionadas, vuelve a ajustar en TVD cuando hay geometría y resuelve Sw y clase desde el mismo contexto efectivo del motor y de preparación. Una fuente explícita sin soporte bloquea su uso. El panel distingue puntos interpretados, predicción y demostración, conserva la navegación por MD y deja las ecuaciones en Ecuaciones.

Los ensayos cargados por F21 son conjuntos de puntos en revisiones de entrada, con columnas originales y unidades. Su asignación, condiciones y transferencia forman parte del escenario explícito. La aplicación conserva fuentes, parámetros y recetas vigentes, guarda evidencia JSON y filtros con un snapshot fijado en una operación deshacible. Una revisión o decisión posterior hace visible la obsolescencia del escenario guardado. Restaurar su snapshot permite reproducirlo. [ADR 0079](decisiones/0079-saturacion-por-altura.md)

## Entrenador (F14, ADR 0080)

Inicio crea un pozo con cuatro perfiles sintéticos observados y zonas iniciales.
El motor recibe el pozo y la interpretación por los mismos caminos que para un pozo importado.
`WellEntry.trainerRecipe` es opcional y JSON puro. Los archivos v6/v7 y el autoguardado
conservan su versión, semilla y modo de ruido. La receta está asociada al id del pozo
y vive fuera de las revisiones de entradas y los snapshots. La ausencia del campo
permite abrir proyectos anteriores. Un lector v7 anterior que exija un esquema estricto
puede rechazar archivos con este campo. Los demás pozos se guardan con el esquema previo.

Al pedir la corrección, `src/app/trainer/correction.ts` verifica el contexto de la
corrida y el eje MD, regenera los valores sembrados y toma las fuentes resueltas
por el motor, incluyendo las preparadas cuando correspondan. Las tres series
sembradas viven en el diálogo y quedan fuera del motor, de las curvas originales y
preparadas, de los gráficos generales, del registro de figuras y de las exportaciones.
La corrección cierra si cambia el proyecto o la corrida. Cerrar o reabrir un archivo
requiere volver a pedirla. La repetición crea otro pozo con los mismos perfiles para
que cada intento tenga su propia interpretación y snapshots.

## Curva fantasma (F18)

El menú contextual ofrece «Calcar un tramo de <curva>» para la línea visible más cercana en la pista. El
siguiente arrastre iniciado en esa pista delimita el tramo (extremos a la muestra MD más próxima, en cualquier
orden). Esc o Cancelar desarman la selección. Si faltan dos muestras válidas consecutivas, se avisa y se puede
volver a intentar. Iniciar otra selección reemplaza el calco anterior.

`WellViewer` mantiene un calco por instancia con `viewer/overlays/ghost.ts`. Copia MD y valores resueltos, y proyecta
con la escala de la serie, incluida la escala logarítmica, la inversión y el retorno de escala. Los valores
inválidos interrumpen el trazo. La manija arrastra únicamente en MD y el objetivo de teclado usa el paso del
visor (Mayús multiplica por diez). El desplazamiento positivo baja el tramo. Su centro queda acotado al pozo;
Esc durante el arrastre restaura el desplazamiento anterior, y «Quitar calco» borra la comparación.

El calco acompaña el zoom, paneo, tamaño y orden de la pista. Se descarta al cambiar de pozo o grilla, al perder
la serie de la pista o al cambiar sus datos, fuente del rol, escala o retorno. La cortina descarta el calco y
deshabilita la selección. En edición de pistas se cancela la selección pendiente. El calco vive en la interfaz
y sus copias quedan fuera del proyecto, de los cálculos, del historial y de las figuras exportadas.

El visor incluye sus superposiciones propias en el recorrido de foco de `targets`, además de las provistas por
la app. `pointercancel` cancela el arrastre en vez de confirmar su último punto.

## Curvas calculadas por fórmula (F06)

**Curvas calculadas** en la columna del pozo permite crear y editar una fórmula. Cada definición guarda el
mnemónico, la expresión y la unidad en `Interpretation.formulas`, un campo opcional de los proyectos v6 y v7
y sus snapshots. El motor incluye las definiciones en su identidad de contexto y en `sameEngineInputs`.

`planGraph` incorpora módulos de fórmula al registro de la corrida. El analizador puro de `src/petro/formula.ts`
convierte referencias a entradas requeridas. Un mnemónico medido fija el id de curva y conserva su unidad
almacenada. Los roles siguen la fuente activa del grafo y su unidad canónica. La validación previa al commit
usa ese mismo grafo para rechazar referencias ausentes y ciclos. La caché considera la expresión, la unidad y
las versiones de entrada. Las fórmulas retiradas liberan su lugar en la caché.

Los resultados conservan sus unidades en **Armar pistas**, Crossplot e Histograma y publican la expresión
como descripción de la curva en LAS. El panel Origen usa el registro de la corrida vigente para recorrer
sus entradas. La gramática, la resolución de referencias y la política de nulos se detallan en el
[ADR 0081](decisiones/0081-curvas-por-formula.md).

## Bandas de incertidumbre de curvas (F15)

La [decisión 0082](decisiones/0082-bandas-de-incertidumbre.md) define los cuantiles de excedencia de SW y PHIE
de la fuente activa. La propagación usa los multiplicadores y la distribución del módulo de incertidumbre del
volumen. Su interruptor de Monte Carlo es independiente de las bandas. El modelo representa error sistemático
relativo, con un multiplicador común a todas las profundidades por magnitud.

- `src/petro/curveBands.ts` produce dos arrays de bordes por magnitud y conserva los huecos en las muestras sin
  datos. El worker inline de `src/app/curveBands/` recibe las series por copia y devuelve los bordes transferibles.
- `ViewerSlot` usa las fuentes elegidas por el resultado del motor. El cálculo de bandas espera 220 ms sin cambios
  de entrada, cancela pedidos anteriores y es independiente del worker del motor. Un aviso pasivo indica que
  el relleno quedó desactualizado hasta recibir los bordes vigentes.
- Los toggles se guardan en estado de UI por espacio, pista y magnitud, inicialmente apagados. El visor dibuja los
  rellenos P10–P90 en el eje de cada curva base, antes de trazar la línea. Los bordes son exclusivos del visor en vivo
  y se dibujan en el lado actual de la cortina.

## Asistente sin modelo (F26)

El [ADR 0083](decisiones/0083-asistente-sin-modelo.md) define una gramática cerrada en
`src/app/assistant/intents.ts`. El modelo puro lee las tablas activas del motor y el catálogo de Ecuaciones
para devolver una respuesta con sus fuentes y acciones declarativas. El panel del dock ejecuta las acciones
explícitas con los comandos registrados, el flujo y la navegación del visor. Ante una pregunta que queda fuera
de la gramática, el panel puede sugerir acciones de navegación por similitud de texto.

El estado de la pregunta vive en el panel y se reinicia al cambiar de pozo. La respuesta visible sigue el resultado
del motor y permanece sin cifras si el cálculo todavía está pendiente. El pedido de localizar una curva vive en
el store del visor y se resuelve con la fuente activa y las pistas visibles. Abrir el asistente o consultar una
respuesta conserva el proyecto y su historial.

## Del Lazo a la Acción (G02)

El [ADR 0088](decisiones/0088-del-lazo-a-la-accion.md) agrega dos contratos opcionales y retrocompatibles sobre v6/v7:
- `Interpretation.userFlags?: readonly UserFlagDef[]` (`src/core/userFlags.ts`, `src/core/state/userFlags.ts`): banderas discretas 0/1 en JSON puro (tramos MD cerrados exactos con `gap = 0`), fuera de `Well.curves` y fuera de `sameEngineInputs`. Se proyectan cacheadas por identidad (`src/plots/userFlags.ts`) como roles de familia `flag` (`UFLAG_<id>`) en filtros de gráficos, pista «Banderas», exportación de figuras y «Armar pistas».
- `MaskInterval.reason?: string` (`src/core/preparation/state.ts`) y `addMaskIntervals(..., { activateSource })` (`src/core/state/preparation.ts`): permiten enviar los tramos MD exactos de una `PlotSelection` a Preparación con motivo obligatorio y activación explícita de la curva preparada (I01–I08, I12), preservando la selección ante el clonado de profundidad en migraciones v6↔v7 (`src/app/store/uiSync.ts`).

## Exceso de presión y EMW en Presiones MDT (G05)

El [ADR 0089](decisiones/0089-exceso-de-presion-y-emw-en-mdt.md) amplía la pista y el panel MDT preservando todos los gradientes y contactos en presión absoluta:
- Unidad `'lb/gal'` (`src/core/units.ts`, conversión SI exacta `453,59237 / (231 · 2,54³) g/cm³`) y funciones puras de exceso de presión (`excessPressure`, `projectLinearTrendToExcess`), densidad equivalente referida a `z = 0` (`equivalentMudWeight`, `pressureFromEmw`) y umbral diagnóstico `> 1,25 g/cm³` (`src/petro/pressure.ts`, `src/petro/gradients.ts`).
- Contratos opcionales y retrocompatibles `OverlayTrackContext.interpretation?` (`src/viewer/overlay.ts`, `src/viewer/templates.ts`, propagado desde `ViewerSlot.tsx` y `src/app/export/figureSources.ts`) y `ResolvedSeries.displayTransform?` (`src/plots/trend/series.ts`, `draw.ts`, `overlay.ts`) para proyectar rectas, manijas y rombos de contacto al eje X activo (`Presión` | `Exceso` | `EMW`) en pantalla, lupa y figuras exportadas PNG/SVG/PDF.
- Preferencias de vista opcionales en JSON puro bajo `project.display.overlays.mdt` (`axisMode`, `excessRhoRef`, `excessRhoSource`, `excessZ0`, `excessAnchor`, `emwUnit`), diagnóstico zonal de EMW y compartimentalización (`summarizeMdtZones` en `src/modules/mdt/model.ts`) y documentación en «Ecuaciones» (`src/modules/mdt/docs.ts`, `src/app/ecuaciones/extras.ts`).

## Rayos gamma sin uranio (`CGR`) conectado a `IGR` / `Vsh` (G06)

El [ADR 0090](decisiones/0090-rayos-gamma-sin-uranio-cgr.md) agrega la separación espectral sin alterar el recorrido por defecto del TP:
- Motor puro `src/petro/spectralGr.ts`: ajuste OLS sin intercepto `GR ≈ a·Th + b·K + c·U` por QR de Householder sobre columnas escaladas con control de condición (`fitSpectralGr`), evaluación zonal (`evaluateSpectralFit`), reconstrucción `CGR` (`cgrThKInto`, `cgrResidualInto`) y fracción modelada de uranio (`uraniumGrFractionInto`), rechazando coeficientes negativos.
- Dos módulos puros en categoría `shale` registrados en `src/modules/index.ts` después de `igr` y `vsh`: `src/modules/cgr/` (produce `CGR`, `U_GR_FRAC` y la tabla `CGR_CALIBRATION` con modos `auto` / `fit` / `standard` y fórmulas `thk` / `residual`) y `src/modules/igr-cgr/` (segunda fuente del puerto `IGR` con extremos propios por zona `cgrClean` y `cgrShale`). El rol `CGR` pasa a `origin: 'any'` (`src/core/roles.ts`) para convivir como curva medida o calculada en «Armar pistas» (`src/viewer/catalog.ts`), preservando precedencia de `CGR` medido y de `igr` como fuente por defecto de `IGR`.
- Visor y paneles: relleno `uraniumExcess` (`src/ui/curves.ts`), pista `GR · CGR` (`src/viewer/cgrComparison.ts`, `src/app/tracks/cgrComparison.ts`, herramienta `tool:cgr-comparison`) y paneles auxiliares (`src/modules/cgr/panel.tsx`, `src/modules/igr-cgr/panel.tsx`) con resumen de calibración, acceso directo a la pista y conmutación segura de la fuente de `IGR`.

## Hidrocarburo móvil vs. residual (`Sxo`, `MOS`, `Rt–Rxo` y pila) (G07)

El [ADR 0091](decisiones/0091-hidrocarburo-movil-residual-sxo.md) cierra la cadena de resistividad conectando `RXO` (`invasion-step` o curva medida) con la evaluación de movilidad sin alterar el recorrido por defecto del TP ni pozos sin `RXO`:
- Motor puro `src/petro/movability.ts`: método de cocientes sin porosidad (`ratioMhi`, `ratioSxoRaw`) y Archie en zona lavada (`archieSxo`, con corrección Arps de `Rmf` por temperatura), recorte físico `SXO ∈ [SW, 1]` conservando `MOS + SHR = 1 − SW` con conteo explícito de anomalías `belowSw`, índice `MHI = SW / SXO` y sumario por zona ponderado por volumen poral (`summarizeMovability`).
- Módulo puro `src/modules/movable-hc/` registrado en `src/modules/index.ts` en categoría `saturation`: consume `SW`, `PHIE`, `RXO` y opcionalmente `RT`/`TEMP`; comparte `a, m, n, rmf, tRmf` de `SHARED_PARAMS`; publica `SXO`, los roles declarados `MOS`, `SHR`, `MHI` (paleta en `src/ui/curves.ts`) y la tabla `MOVABLE_SUMMARY`, con panel propio (`src/modules/movable-hc/panel.tsx`) y ecuaciones en `docs`.
- Crossplot «Movilidad Rt–Rxo (Ratio Plot)» (`rt-rxo` en `src/core/plots.ts`, `src/plots/crossplot/templates.ts`, `drag.ts`, `CrossplotPanel.tsx`, `src/plots/params.ts`): log `RXO` vs. log `RT` con recta de agua arrastrable (`RXO = (Rmf/Rw)·RT`, un solo `commit` deshacible sobre `movable-hc.rmfOverRw` y flechas monótonas con `step = 0,01`) y líneas guía `Sw/Sxo = 0,7` y `0,5`.
- Partición jerárquica compatible en `VOLUMETRIC_STACK` (`src/core/display.ts`, `src/viewer/stack.ts`, `src/viewer/templates.ts`, `src/viewer/render.ts`): campos JSON opcionales `optional` y `childrenMode: 'proportional'` en `StackComponentSpec`, soporte recursivo multinivel (`level: 0..2`) con acotado bajo decimación (`clampChildDecimatedSpan`) y descarte de grupos opcionales sin muestras finitas; parte `hydrocarbon` en `HC móvil` (`PHIE·MOS`) + `HC resid.` (`PHIE·(1 − SXO)`) donde `RXO` tiene dato y conserva `Hidrocarburo` entero sin huecos falsos donde `RXO = NaN`.

## Panel de Coherencia Cruzada entre Herramientas (G08)

El [ADR 0092](decisiones/0092-coherencia-cruzada-entre-herramientas.md) incorpora una auditoría en vivo de solo lectura sin alterar ningún módulo ni puerto del motor:
- Motor puro `src/petro/crossCheck.ts`: evalúa 7 chequeos (`sw-vs-swi`, `bound-water`, `porosity`, `mdt-vs-sw`, `seal-capacity`, `uranium-gr` y `hc-movability`) con cuatro estados explícitos (`ok` | `warn` | `tension` | `unsupported`, nunca ocultando ensayos faltantes) y umbrales operativos declarados (`CROSS_CHECK_THRESHOLDS`), reutilizando `swBelowSwiFlag`, `entryHeightM` y `KGF_CM2_TO_PSI` sin mutar entradas.
- Módulo de panel `src/modules/cross-check/` registrado en `PANEL_MODULES` (`src/modules/index.ts`, id `'cross-check'`, categoría `'summary'`, espacios `'petrophysics'` y `'geology'`): definición pura con ecuaciones solo en `docs` (`index.ts`), adaptador puro desde `Well` + `Interpretation` + `ClientResult` (`model.ts`), pestaña «Coherencia» en el dock con semáforo zona por zona, tarjeta de capacidad de sello MICP/SCAL y navegación directa al tramo crítico en el visor y al panel/módulo involucrado (`dock.tsx`, `cross-check.css`, `commands.ts`), además de acceso desde Sumario (`src/modules/zone-summary/panel.tsx`).
- Informe y contexto para chat: opciones retrocompatibles `ReportOptions.includeCrossCheck` (`src/app/report/report.ts`, `ReportPanel.tsx`) y `ChatContextOptions.includeCrossCheck` (`src/app/chatContext/chatContext.ts`), con copia ligera sin `Float64Array` y recorte por prioridad en `chatContext` antes de descartar avisos.

## Superficie 2D de estabilidad de Cutoffs (G09)

El [ADR 0093](decisiones/0093-superficie-2d-cutoffs.md) suma exploración bivariada de estabilidad al módulo `cutoff-sensitivity` sin alterar `compute()` ni afectar el presupuesto de `< 20 ms` del worker:
- Primitivas puras en `src/petro/sensitivity.ts`: `cutoffSurface2D` evalúa exactamente grillas 2D para los pares `φ × Sw`, `Vsh × φ` y `Vsh × Sw` en $O(N + n_x n_y)$ preservando paridad con `netFlagsInto`, `NaN` (`noDataPay` / `knownN === 0`) y corte de permeabilidad; `contourLevelsForRange` y `extractContours2D` (*Marching Squares* omitiendo celdas `NaN` y desambiguando sillas `5`/`10`), `sampleSurface2D` (interpolación bilineal) y `assessStability2D`/`classifyStability2D` (meseta `≤ 10 %`, sensible `10–25 %`, barranco `> 25 %` sobre `±ΔVsh=0,05`, `±Δφ=0,01`, `±ΔSw=0,05`).
- Adaptador puro y panel interactivo (`src/modules/cutoff-sensitivity/surfaceModel.ts`, `panel.tsx`, `panel.css`): cómputo bajo demanda con paridad frente a `ZONE_SUMMARY` y `VOLUMETRICS` en zona, sello y vista `Total` con *overrides* por zona; conmutador `Curvas 1D | Superficie 2D`, mapa de calor con sombreado `sin dato`, curvas de nivel rotuladas, caja operativa, tooltip con `Δ (%)` y mira 2D arrastrable / accesible por teclado con receta atómica `setCutoffPairRecipe` (`Ctrl+Z` en un paso).
