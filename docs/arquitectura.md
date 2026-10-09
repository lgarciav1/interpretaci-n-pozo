# Arquitectura

Webapp 100 % en el navegador (TypeScript + React + Vite) que se entrega como un único `dist/index.html`.
Las decisiones con sus alternativas descartadas están en [`decisiones/0001-nucleo-y-contrato-de-modulos.md`](decisiones/0001-nucleo-y-contrato-de-modulos.md).
Este documento resume cómo encajan las piezas y cómo agregar un módulo.

## Ideas centrales

1. **Los módulos se conectan por puertos, no por nombre.** Un módulo dice "necesito GR" y "produzco IGR". El
   grafo se arma solo. Los puertos de curva son roles (`GR`, `RHOB`, `VSH`…); los escalares y tablas tienen ids
   en mayúsculas (`RW`, `IGR_BY_ZONE`).
2. **Varios métodos por paso = varios módulos que producen el mismo puerto.** La interpretación guarda qué fuente
   alimenta cada puerto (`sources`); las alternativas se pueden calcular para comparar (`compare`) sin alimentar
   la cadena. Por defecto: curva medida con ese rol → primer módulo registrado.
3. **Parámetros declarativos, globales con override por zona.** El esquema genera los controles. El motor parte
   el pozo en tramos de una misma zona y le da a cada tramo sus parámetros ya resueltos.
4. **Motor incremental, idéntico en worker y en proceso.** Cada módulo tiene una firma (parámetros + zonas +
   versión de entradas); si no cambió, se reusa el resultado.
5. **Estado en tres capas.** Proyecto (se guarda), UI (no se guarda), resultados (derivados, no se guardan).

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

Tests y Monte Carlo usan `Engine` directamente (`computeOnce` o una instancia con caché), sin worker.

## Carpetas

| Carpeta | Qué hay | Puede importar React |
|---|---|---|
| `src/core/` | modelo (`well.ts`), unidades, roles, parámetros, contrato de módulo, registro, motor (`engine/`), estado (`state/`) | no |
| `src/petro/` | funciones de cálculo puras, testeadas | no |
| `src/modules/<id>/index.ts` | definición pura del módulo | no |
| `src/modules/<id>/panel.tsx` | panel a medida (opcional) | sí |
| `src/modules/index.ts` | **el registro** (una línea por módulo) | no |
| `src/app/` | arranque, worker (`engine.worker.ts`), puente con el motor, stores, pantallas | sí |
| `src/ui/` | sistema de diseño (fase 3) y contrato de panel | sí |
| `src/io`, `viewer`, `plots`, `ml` | fases siguientes (ver su README) | — |

Un test (`tests/modules.test.ts`) falla si `core`, `petro` o una definición de módulo importan React, zustand o la
interfaz.

## Reglas que heredan todas las fases

- **Arrays inmutables.** Las curvas son `Float64Array` con `NaN` = sin dato. Nunca se modifican en el lugar: para
  editar una curva se crea un array nuevo. El motor detecta cambios por identidad del array.
- **Entradas de solo lectura.** `compute` no puede escribir en sus entradas (están en caché y las comparten otros
  módulos). El tipo `InputCurve` lo impide en compilación para la escritura por índice.
- **Unidades canónicas.** El motor convierte cada curva medida a la unidad canónica de su rol antes de pasarla a un
  módulo (`%` → `v/v`, `kg/m³` → `g/cm³`…). Los módulos nunca convierten.
- **Profundidad en metros**, estrictamente creciente.
- **Las acciones sobre el proyecto son funciones puras** (`src/core/state/project.ts`, `snapshots.ts`) y se aplican
  con `useProject.getState().commit(etiqueta, receta)`. Ese es el punto donde se agregará deshacer/rehacer.
- **Textos de interfaz en español, identificadores en inglés.** Las ecuaciones van solo en `docs` del módulo.

## Contrato de módulo (resumen)

```ts
defineModule({
  id: 'kebab-case',                // = nombre de la carpeta
  name: 'Nombre en español',
  category: 'shale',               // ver src/core/workspaces.ts
  workspace: 'petrophysics',       // o ['petrophysics', 'geology']
  roles?: [...],                   // roles de curva nuevos que introduce
  inputs:  { gr: input.curve('GR'), cal: input.optionalCurve('CALI'), rw: input.scalar('RW') },
  params:  { grClean: param.number({ label, tooltip, default, min, max, step, unit, scale, scope: 'zone', shared }) ,
             method: param.enum({ ... }), useX: param.boolean({ ... }) },
  outputs: { igr: output.curve('IGR'), rwa: output.scalar('RWA', {...}), byZone: output.table('X', {...}) },
  compute(ctx) { ... },            // pura; ctx: n, depth, thickness, inputs, params, segments, zones, warn
  docs: { summary, equations: [{ latex }], references: [...] },
});
```

`compute` está tipada a partir de las declaraciones: `ctx.inputs.gr` es una curva, `ctx.inputs.cal` puede ser
`undefined`, `s.params.grClean` es `number`, y el valor devuelto debe tener `igr: Float64Array`, `rwa: number`,
`byZone: { rows }`.

`createRegistry` valida todo junto y, si algo está mal, lanza un error con **todos** los problemas: ids repetidos
o mal formados, roles desconocidos, rangos de parámetros inválidos (min ≥ max, default fuera de rango, log con
min ≤ 0), enums sin el default entre las opciones, parámetros compartidos incompatibles, puertos con tipos
distintos en módulos distintos, escalares requeridos que nadie produce, docs faltantes.

## Cómo agregar un módulo

Ejemplo: Vsh de Larionov (rocas terciarias), que consume `IGR` y produce `VSH`.

1. Función pura y su test en `src/petro/`:

   ```ts
   // src/petro/vsh.ts
   export function larionovTertiary(igr: number): number {
     return Number.isNaN(igr) ? NaN : 0.083 * (2 ** (3.7 * igr) - 1);
   }
   ```

2. Carpeta `src/modules/vsh-larionov-tertiary/index.ts`:

   ```ts
   import { defineModule, input, output } from '../../core/module';
   import { larionovTertiary } from '../../petro/vsh';

   export default defineModule({
     id: 'vsh-larionov-tertiary',
     name: 'Vsh — Larionov (terciario)',
     category: 'shale',
     workspace: 'petrophysics',
     inputs: { igr: input.curve('IGR') },
     params: {},
     outputs: { vsh: output.curve('VSH') },
     compute({ n, inputs }) {
       const vsh = new Float64Array(n);
       for (let i = 0; i < n; i++) vsh[i] = larionovTertiary(inputs.igr[i]!);
       return { vsh };
     },
     docs: {
       summary: 'Volumen de arcilla a partir de IGR para rocas terciarias no consolidadas.',
       equations: [{ latex: 'V_{sh} = 0.083\\,(2^{3.7 I_{GR}} - 1)' }],
       references: ['Larionov, V. V. (1969).'],
     },
   });
   ```

3. Una línea en `src/modules/index.ts`:

   ```ts
   import vshLarionovTertiary from './vsh-larionov-tertiary';
   export const MODULES = [igr, shaleFlag, vshLarionovTertiary];
   ```

Listo: el panel con sus parámetros se genera solo, el módulo aparece en el selector de método de `VSH` si hay otro
productor, el motor lo encadena detrás de `igr` y los módulos que consumen `VSH` lo reciben.

Opcional: un panel a medida en `src/modules/<id>/panel.tsx` que exporte
`export const panel: ModulePanel = { moduleId: '<id>', component: MiPanel }` (contrato en `src/ui/modulePanel.ts`).
Se descubre solo; no hace falta registrarlo.

## Web Worker dentro del HTML único

`src/app/engineBridge.ts` importa `./engine.worker?worker&inline` y `vite.config.ts` fija `worker.format = 'iife'`.
Vite empaqueta el worker aparte (≈ 33 kB, sin React) y lo incrusta como texto en el bundle; en ejecución se crea
desde un Blob URL, que Chromium permite desde `file://`. Si la creación falla o el worker da error antes de
responder por primera vez, el puente cambia al motor en proceso (`createInProcessClient`, mismo protocolo sobre un
`MessageChannel`) sin perder el estado.

## Guardar / abrir

`serializeProject` / `deserializeProject` (`src/core/state/serialize.ts`): JSON con `format`, `version` y
migraciones. Los arrays van como Float64 little-endian comprimidos con `CompressionStream('deflate')` (con o sin
"byte shuffle", lo que salga más chico) en base64: exactos bit a bit. Los perfiles del TP quedan en menos de la
mitad del binario sin comprimir.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm test` | tests (Vitest) |
| `npm run typecheck` | TypeScript estricto sin emitir |
| `npm run build` | genera `dist/index.html` autocontenido |

## Abierto

- Cancelar un cálculo largo a mitad de camino (hoy se coalesce entre cálculos, no dentro de uno). Si Monte Carlo
  necesita correr en paralelo con la interacción, usar un segundo worker con su propio `Engine`.
- Enlazar el valor de un parámetro a un escalar calculado (hoy un escalar puede ser entrada de un módulo, no el
  valor de un slider).
- Deshacer/rehacer: el punto de enganche existe (`commit`), falta el historial.
