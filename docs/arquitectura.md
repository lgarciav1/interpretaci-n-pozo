# Arquitectura

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
con el Pickett interactivo (0021), el informe automático (0022) y la calibración con corona (0023).
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

## Carpetas

| Carpeta | Qué hay | Puede importar React |
|---|---|---|
| `src/core/` | modelo (`well.ts`; conjuntos de puntos `pointSets.ts`), unidades, roles, parámetros, contrato de módulo, registro, motor (`engine/`), estado (`state/`: proyecto, snapshots, recetas de zonas `zones.ts`, de tendencias `trends.ts`, de conjuntos de puntos `pointSets.ts`, de gráficos `plots.ts` y de pistas y plantillas `tracks.ts`), configuración del visor que se guarda y su validación al abrir (`display.ts`, incluidas las pilas de la pista volumétrica), configuración del histograma y del crossplot (`plots.ts`), tendencias (`trends.ts`: `TrendSpec`, saneamiento), conversión a unidad canónica compartida (`canonical.ts`) | no |
| `src/petro/` | funciones de cálculo puras, testeadas | no |
| `src/modules/<id>/index.ts` | definición pura del módulo | no |
| `src/modules/<id>/panel.tsx` | panel a medida (opcional) | sí |
| `src/modules/<id>/overlay.ts`, `draw.ts` | superposiciones del visor (opcional, `overlays: ViewerOverlay[]`): dibujo, arrastre, pista propia; `draw.ts` (opcional): dibujo en canvas de un panel o una figura del módulo que usa `ui/` y `plots/` (perfil radial, 0020). El worker no los importa y `tests/modules.test.ts` los excluye de la regla de pureza | no (canvas) |
| `src/modules/index.ts` | **el registro** (una línea por módulo) | no |
| `src/modules/sharedParams.ts` | catálogo canónico de parámetros compartidos | no |
| `src/app/` | arranque, worker (`engine.worker.ts`), puente con el motor, stores (`store/viewer.ts`: cursor y tramo visible), descubrimiento de superposiciones (`viewerOverlays.ts`), pantallas | sí |
| `src/app/shell/` | armazón: barra superior, flujo guiado, inspector, dock (`dockPanels.tsx`: una entrada por panel), `ViewerSlot` (conecta stores con el visor: edición de zonas, modo marcar zona, encabezado, «Armar pistas»), `viewerOverlayList.ts` (superposiciones del visor de la app), `CurveEditor` (editor de escalas), diálogos | sí |
| `src/app/tracks/` | «Armar pistas» (0016): panel con el catálogo (`TrackBuilder.tsx`), plantillas y diálogos (`Templates.tsx`), arrastre con eventos de puntero (`dnd.ts`) y acciones que traducen gestos a recetas con `commit` (`actions.ts`) | sí |
| `src/app/flow/` | flujo guiado: definición de pasos y evaluación de estados (`flow.ts`, puro y testeado) | `flow.ts` no |
| `src/ui/` | sistema de diseño: tokens, tema, paleta de curvas, componentes, `useCanvas`; contrato de panel. Guía en `src/ui/README.md`; muestra en `#ui` | sí |
| `src/viewer/` | visor multipista: plantillas, resolución de pistas, viewport, ticks, reducción M4, rellenos, pilas (`stack.ts`), lectura, contrato de superposiciones (con elementos del teclado), gestos (`interaction.ts`), catálogo de herramientas y curvas para armar pistas (`catalog.ts`), dibujo en canvas (`*.ts`, puros o canvas) y los componentes `WellViewer.tsx`, `Minimap.tsx`, `WellHeader.tsx`, `layoutEdit.tsx` (modo «Armar pistas»: destinos y bordes de ancho). Guía en `src/viewer/README.md` | solo los `.tsx` |
| `src/io/` | lectores Excel/LAS/CSV, mnemónicos, control de calidad, tablas de presiones (`pressures.ts`) (ver su README) | no |
| `src/plots/xy/` | gráfico x–y base (ejes lineales o log, ticks, mapeo dato ↔ px puro en `axes.ts`, dibujo en `draw.ts` —barras, eje derecho, guías rotuladas, nube densa—, búsqueda por grilla `pick.ts`, componente `XYPlot.tsx` con guías arrastrables): lo usan el crossplot k–φ de la corona, el histograma y el crossplot libre. Guía en `src/plots/README.md` | solo `XYPlot.tsx` |
| `src/plots/histogram/`, `src/plots/crossplot/`, `src/plots/*.ts` | histograma y crossplot libre (0014): lo puro en `.ts` (binning, estadísticos, plantillas, serie `crossplot`, curvas y zonas `data.ts`, cutoffs `cutoffs.ts`, parámetros sobre los gráficos `params.ts` y `crossplot/drag.ts` (0015), enlace con el visor `link.ts`) y los paneles de presentación en `.tsx` (sin stores) | solo los `.tsx` |
| `src/app/plots/` | conexión de los gráficos del dock con los stores: contexto del pozo, configuración, `commit`, cutoff real y parámetros elegidos sobre los gráficos (agrupados por gesto), fuentes activas y «Usar …», montaje solo con la pestaña a la vista | sí |
| `src/plots/trend/` | tendencias: contrato y registro de proveedores de series (`series.ts`, proveedor `curve`), ajuste sobre la serie (`compute.ts`), dibujo independiente de los ejes (`draw.ts`), textos (`format.ts`) y superposición del visor sin stores (`overlay.ts`). Guía en `src/plots/README.md` | no |
| `src/app/trends/` | estado de interfaz de las tendencias (herramienta, selección), proveedores de los módulos (`providers.ts`), conexión con los stores (`actions.ts`) y panel «Tendencias» del dock | sí |
| `src/modules/<id>/series.ts` | proveedores de series para tendencias (opcional, `seriesProviders: TrendSeriesProvider[]`): MDT, plugs de corona…; el worker no lo importa | no |
| `src/modules/<id>/dock.tsx` | paneles del dock aportados por un módulo (opcional, `dockPanels: DockPanelDef[]`, contrato en `src/ui/dockPanel.ts`): «Presiones MDT», «Corona», «Histograma», «Crossplot», «Agua de formación» (0017: `formation-water`, con `model.ts` y `docs.ts` puros) | sí |
| `ml` | fases siguientes (ver su README) | — |

Un test (`tests/modules.test.ts`) falla si `core`, `petro` o una definición de módulo importan React, zustand o la
interfaz.

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
  inputs:  { gr: input.curve('GR'), cal: input.optionalCurve('CALI'), k: input.scalar('K_REF'),
             t: input.table('ZONE_SUMMARY'), h: input.zoneScalar('HPHISH_PAY') },   // + optionalScalar/Table/ZoneScalar
  params:  { grClean: param.number({ label, tooltip, default, min, max, step, unit, scale, scope: 'zone', shared }) ,
             method: param.enum({ ... }), useX: param.boolean({ ... }) },
  outputs: { igr: output.curve('IGR'), total: output.scalar('X_TOTAL', {...}), byZone: output.table('X', {...}),
             perZone: output.zoneScalar('X_BY_ZONE', { label, unit }) },
  compute(ctx) { ... },            // pura; ctx: n, depth, thickness, inputs, params, segments, zones, paramsFor, warn
  docs: { summary, equations: [{ latex }], references: [...] },
});
```

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
- `ctx.zones`: zonas en orden de tope, con `id`, `name`, `kind`, `top`, `base`, `start`, `end`.
- `ctx.warn(mensaje)`: aviso para el usuario (p. ej. parámetros incoherentes en una zona). Se vuelve a mostrar
  mientras el resultado siga en caché.

**Fuentes explícitas con otro rol.** Elegir para un puerto una curva medida que tiene otro rol (p. ej. AT60, rol
`RM`, como `RT`) es intencional y está permitido: el motor la convierte a la unidad del puerto y emite un
diagnóstico `info` ("Se usa la curva 'AT60' (rol RM) como RT por elección explícita."). Si la curva es de otra
magnitud (una densidad como `RT`), la elección se rechaza con advertencia y se usa la fuente por defecto.

`createRegistry` valida todo junto y, si algo está mal, lanza un error con **todos** los problemas: ids repetidos
o mal formados, roles desconocidos, rangos de parámetros inválidos (min ≥ max, default fuera de rango, log con
min ≤ 0), enums sin el default entre las opciones, parámetros compartidos incompatibles, puertos con tipos
distintos en módulos distintos, escalares requeridos que nadie produce, docs faltantes.

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

## Guardar / abrir

`serializeProject` / `deserializeProject` (`src/core/state/serialize.ts`): JSON con `format`, `version` (hoy 6: v2
agregó el progreso del flujo, v3 la configuración del visor, v4 las tendencias de cada pozo y snapshot, v5 los
conjuntos de puntos del pozo y las decisiones sobre ellos, v6 la configuración del histograma y del crossplot en
`display.plots`) y migraciones. La fase 7b agregó dos campos opcionales sin cambiar la versión: `display.trackTemplates`
(plantillas de pistas propias) y `TrackSpec.hidden` (pistas de superposición quitadas); un proyecto anterior se abre
sin ellos. Al abrir, `display` (con `plots` y las plantillas), las tendencias, los
conjuntos de puntos y sus decisiones se validan: lo inválido se descarta con aviso. Los arrays van como Float64 little-endian comprimidos con `CompressionStream('deflate')` (con o sin
"byte shuffle", lo que salga más chico) en base64: exactos bit a bit. Los perfiles del TP quedan en menos de la
mitad del binario sin comprimir.

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
| Reenvío completo automático ante "resultado incompleto" | antes de la fase 12 | Mensaje `resync` del cliente: el worker vacía `sent` y la próxima respuesta trae todos los datos. |
| Elegir método por zona para puertos con módulos distintos (Archie en arenas limpias, Simandoux en arcillosas) | cuando se pida | `sources` por zona: el motor arma una curva por tramos con la salida del módulo elegido en cada zona. |
| Ruido de módulos por defecto sin consumidores (p. ej. sónico sin DT informa error aunque nadie use PHIS) | antes de la fase 12 | Bajar a `info` el faltante de un módulo que solo corre por ser fuente por defecto de un puerto sin consumidores. |
| psia y psig se tratan como psi | cuando haya datos reales | Guardar la referencia por columna y avisar en el asistente si se mezclan (desplaza ~14,7 psi la regla «presión ≥ lodo»). |
| Gradientes de presión en pozos desviados (hoy contra MD; el panel avisa si TVD difiere de MD) | cuando haya un pozo desviado | Serie `mdt` con x = TVD (columna `tvd`) y la pista ubicada por MD. |
| «Usar un contacto como tope de zona» (opcional del pedido MDT) | cuando se pida | Receta que parta la zona que contiene el contacto (`createZone`, `src/core/state/zones.ts`). |
| Corrección de Klinkenberg y de presión de confinamiento de los plugs | cuando haya datos reales de laboratorio | El lector (`src/io/core.ts`) elige la columna (Klinkenberg antes que aire) pero no corrige; sumar la columna de presión de confinamiento y un factor opcional. |
| Modelo k–φ por litofacies o capa (hoy global o por zona) | fase 7b | Una tendencia por capa sobre la serie `core` y «Aplicar» a la zona que corresponda; el módulo `perm-core` ya tiene a y b por zona. El crossplot libre filtra por zona y ajusta tendencias, pero sobre curvas del perfil, no sobre plugs. |
| Lazo y tramo del visor sin mouse (tacto, teclado) | antes de la fase 12 | Botón «Seleccionar tramo» que arme un modo en la barra del visor; tope y base con el cursor del teclado (0021). |
| Vista previa de arrastres de superposiciones sin redibujar el canvas base («Marcar zona», tramo del visor) | cuando moleste | Capa de interacción para superposiciones (`frame.invalidateTop()`), como la de `XYPlot` (0021). |
| Pickett sin zona acuífera | cuando se pida | «Ajustar a la envolvente» (percentil bajo de los residuos de ln Rt) como alternativa explícita al ajuste por mediana (0021, D9). |
| Matriz del densidad–neutrón con las cartas CP-1 (curvas) en vez de rectas de mezcla | cuando se pida | Tabular la carta por litología; imán hacia la curva más cercana (`snapMatrixToLithology`, 0015). |
| Líneas de litología curvas en densidad–neutrón (hoy rectas de mezcla matriz–agua) | cuando se pida | Tabular la carta CP-1 del fabricante por litología y dibujarla como `XYLineLayer`. |
| Sliders del inspector: una sola entrada de deshacer aunque se pause más de 800 ms con el botón apretado | antes de la fase 12 | Usar el gesto de `history.ts` (0015, D2.1: `commit(…, { group })`, `cancelGroup`) desde `Slider` (abrir al bajar el puntero, cerrar al soltar). Los arrastres de los gráficos ya lo usan. |
| Rangos de ejes del crossplot editables a mano (hoy automáticos o de la plantilla) | cuando se pida | `xRange`/`yRange` ya se guardan; falta el editor (como el de escalas del visor). |
| Corrección de φ perfil → corona aplicada a la cadena (hoy la calibración es diagnóstica; 0023) | cuando se pida | Módulo alternativo de `PHIE` con la recta RMA por zona que escribe el panel «Calibración». |
| Puesta en profundidad de la corona en pozos desviados (hoy en MD) | cuando haya un pozo desviado | Igual que los gradientes MDT: variable independiente TVD con la pista ubicada por MD. |

## Petrofísica en módulos (fase 6a)

Decisión y catálogo completo: [`docs/decisiones/0007-modulos-fase-6a.md`](decisiones/0007-modulos-fase-6a.md).

- Cadena: `igr` → `vsh` → `phi-*` → `phit` → `phie-*` · `temp-gradient` → `rw-*` (curva `RW` ya corregida por
  temperatura) → `sw-*` → `bvw-sh`, `perm-*` → `cutoffs` (banderas) → `zone-summary` (tabla + valores por zona) →
  `volumetrics` (OOIP/OGIP por zona y total, m³ estándar; tabla en SI y en unidades de campo). `cutoff-sensitivity`
  produce el barrido de cada cutoff en una tabla oculta que dibuja su panel.
- Los parámetros comunes (a, m, n, Rsh, Δt matriz, Rmf, cutoffs, área, Bo, Bg, fluido) están en `SHARED_PARAMS`.
- Unidades agregadas: múltiplos de volumen (Mm³, MMm³, Mbbl, MMbbl, MMscf, Bcf), `m3/m3`, gradiente de temperatura.

## Interfaz (fase 3)

- **Armazón de tres zonas** (`src/app/App.tsx`): pozo/curvas/zonas · visor + dock · inspector del paso activo.
  Laterales y dock redimensionables y colapsables; medidas en `localStorage` (nunca en el proyecto).
- **Flujo guiado**: `FLOWS[espacio]` en `src/app/flow/flow.ts`. Un paso de módulos toma los módulos de sus
  categorías **o** los que producen sus puertos (Rw: categoría `water` o cualquier productor de `RW`/`RWA`/`TEMP`),
  así que agregar un módulo lo suma al paso sin tocar nada más. Lo derivado (pozo, zonas, puertos calculados) no se
  guarda; las marcas del usuario (completo/saltado) van en `WellEntry.progress` (formato de proyecto v2).
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
- **Gradientes** = tendencias lineales sobre la serie `mdt` (`<conjunto>:gas|oil|water`); densidad con
  `gradientReadings` y fluido sugerido con `classifyFluidByDensity` (`src/petro/pressure.ts`). **Contactos** en la
  interfaz (`findContacts` → `intersectTrends`), no en el motor.
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
