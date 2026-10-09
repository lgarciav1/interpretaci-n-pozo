# Arquitectura

Webapp 100 % en el navegador (TypeScript + React + Vite) que se entrega como un único `dist/index.html`.
Las decisiones con sus alternativas descartadas están en [`decisiones/`](decisiones/): núcleo y contrato de módulos
(0001), lectura de datos (0002), control de calidad (0003), sistema de diseño, armazón y flujo guiado (0004), visor
multipista (0005), deshacer y rehacer (0006), catálogo de módulos de la fase 6a con sus cambios de núcleo (0007) y
tendencias y gradientes (0008).
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
| `src/core/` | modelo (`well.ts`), unidades, roles, parámetros, contrato de módulo, registro, motor (`engine/`), estado (`state/`: proyecto, snapshots, recetas de zonas `zones.ts` y de tendencias `trends.ts`), configuración del visor que se guarda y su validación al abrir (`display.ts`, incluidas las pilas de la pista volumétrica), tendencias (`trends.ts`: `TrendSpec`, saneamiento), conversión a unidad canónica compartida (`canonical.ts`) | no |
| `src/petro/` | funciones de cálculo puras, testeadas | no |
| `src/modules/<id>/index.ts` | definición pura del módulo | no |
| `src/modules/<id>/panel.tsx` | panel a medida (opcional) | sí |
| `src/modules/<id>/overlay.ts` | superposiciones del visor (opcional, `overlays: ViewerOverlay[]`): dibujo, arrastre, pista propia; el worker no lo importa | no (canvas) |
| `src/modules/index.ts` | **el registro** (una línea por módulo) | no |
| `src/modules/sharedParams.ts` | catálogo canónico de parámetros compartidos | no |
| `src/app/` | arranque, worker (`engine.worker.ts`), puente con el motor, stores (`store/viewer.ts`: cursor y tramo visible), descubrimiento de superposiciones (`viewerOverlays.ts`), pantallas | sí |
| `src/app/shell/` | armazón: barra superior, flujo guiado, inspector, dock (`dockPanels.tsx`: una entrada por panel), `ViewerSlot` (conecta stores con el visor: edición de zonas, modo marcar zona, encabezado), `CurveEditor` (editor de escalas), diálogos | sí |
| `src/app/flow/` | flujo guiado: definición de pasos y evaluación de estados (`flow.ts`, puro y testeado) | `flow.ts` no |
| `src/ui/` | sistema de diseño: tokens, tema, paleta de curvas, componentes, `useCanvas`; contrato de panel. Guía en `src/ui/README.md`; muestra en `#ui` | sí |
| `src/viewer/` | visor multipista: plantillas, resolución de pistas, viewport, ticks, reducción M4, rellenos, pilas (`stack.ts`), lectura, contrato de superposiciones (con elementos del teclado), gestos (`interaction.ts`), dibujo en canvas (`*.ts`, puros o canvas) y los componentes `WellViewer.tsx`, `Minimap.tsx`, `WellHeader.tsx`. Guía en `src/viewer/README.md` | solo los `.tsx` |
| `src/io/` | lectores Excel/LAS/CSV, mnemónicos, control de calidad (ver su README) | no |
| `src/plots/trend/` | tendencias: contrato y registro de proveedores de series (`series.ts`, proveedor `curve`), ajuste sobre la serie (`compute.ts`), dibujo independiente de los ejes (`draw.ts`), textos (`format.ts`) y superposición del visor sin stores (`overlay.ts`). Guía en `src/plots/README.md` | no |
| `src/app/trends/` | estado de interfaz de las tendencias (herramienta, selección), proveedores de los módulos (`providers.ts`), conexión con los stores (`actions.ts`) y panel «Tendencias» del dock | sí |
| `src/modules/<id>/series.ts` | proveedores de series para tendencias (opcional, `seriesProviders: TrendSeriesProvider[]`): MDT, plugs de corona…; el worker no lo importa | no |
| `src/plots` (resto), `ml` | fases siguientes (ver su README) | — |

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

`serializeProject` / `deserializeProject` (`src/core/state/serialize.ts`): JSON con `format`, `version` (hoy 4: v2
agregó el progreso del flujo, v3 la configuración del visor, v4 las tendencias de cada pozo y snapshot) y
migraciones. Al abrir, `display` y las tendencias se validan: lo inválido se descarta con aviso. Los arrays van como Float64 little-endian comprimidos con `CompressionStream('deflate')` (con o sin
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
| Dónde viven los puntos MDT y los plugs de corona (el proveedor de series solo lee pozo e interpretación; un store propio no redibuja la capa de tendencias) | al empezar la 6b-2 | Guardarlos en el pozo como conjunto de puntos (cambio de núcleo, decidir en la decisión de MDT). |
| Contactos MDT: el motor corre en el worker sin proveedores de series | 6b-2 | Calcular el contacto en la interfaz con `evaluateTrend` + `intersectTrends` (`src/petro/regression.ts`), no como salida del motor. |
| Excluir o incluir muchos puntos a la vez (lazo en el crossplot) | fase 7 | Receta nueva en `src/core/state/trends.ts`; hoy se alterna de a uno. |

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

## Deshacer y rehacer

Decisión: [`docs/decisiones/0006-deshacer-rehacer.md`](decisiones/0006-deshacer-rehacer.md).

- **Lógica pura** en `src/core/state/history.ts`: pilas pasado/futuro de `{ project, label, at }` con el proyecto
  *anterior* a cada cambio (barato: estructuras compartidas, los `Float64Array` no se copian). Hasta 100 entradas;
  un cambio nuevo vacía el futuro.
- **Agrupado**: cambios seguidos con la **misma etiqueta** a menos de 800 ms del anterior se funden en una entrada
  que conserva el proyecto previo al primero (un slider arrastrado, ↑/↓ en un campo, un tope movido con el
  teclado: un Ctrl+Z vuelve al valor inicial). Deshacer o rehacer corta el grupo. Un arrastre del visor ya es un
  solo `commit` al soltar.
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
