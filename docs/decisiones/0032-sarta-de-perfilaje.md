# 0032 — Sarta de perfilaje: modelo, disponibilidad de módulos y filtro de curvas (fase 11a)

- Estado: implementada (11a: núcleo y conexión mínima), pendiente de revisión independiente.
- Alcance: catálogo de herramientas (`src/core/tools.ts`) y sus fichas (`src/core/toolSheets.ts`), modelo de la sarta
  (`src/core/toolString.ts`), recetas (`src/core/state/toolString.ts`), filtro en el motor (`planGraph`), visor,
  catálogo de pistas, figuras, panel de módulos y un control temporal en la paleta de comandos (`src/app/toolString/`).
- Fuera de alcance: la vista de la sarta (esquema 3D que se gira, clic en una herramienta → ficha) es la fase 11c; los
  valores de las fichas los investiga la fase 11b.
- Nota de numeración: el brief pedía `0031`, pero ese número ya lo usa `0031-modulo-de-facies.md`; se usa el siguiente
  libre para no sumar otro número repetido.

## Contexto

Funcionalidad O del plan: «Armás la sarta apilando herramientas (GR, densidad, neutrón, resistividad, sónico, RMN) en
un esquema del pozo. Lo que pongas en la sarta define qué curvas y pistas aparecen en el visor y qué módulos quedan
disponibles. Cada herramienta muestra qué mide y su profundidad de investigación.»

La usuaria eligió la semántica (c), con dos modos:

- **Datos** (por defecto): la sarta sale sola de las curvas cargadas. Apagar una herramienta oculta sus curvas en el
  visor y deshabilita los módulos que dependen de ellas; prenderla restituye todo. Nunca se borran datos ni se tocan las
  pistas armadas por la usuaria (0016): es un filtro.
- **Planificación**: la usuaria arma la sarta (de cero o desde la de datos) y la app dice qué módulos podría correr con
  esas herramientas aunque el pozo no tenga esos datos.

Hasta ahora la relación rol medido → herramienta existía solo implícita en el catálogo de pistas del visor
(`ROLE_GROUP` en `src/viewer/catalog.ts`), que mezcla herramientas físicas con agrupaciones de lectura (densidad y
neutrón en un mismo grupo, GR con SP).

## D1. Catálogo de herramientas en el núcleo, una sola tabla rol → herramienta

`src/core/tools.ts`: `ToolDef` = `id` (kebab-case, es lo que se guarda), `name`, `short` (rótulo del esquema),
`family` (`borehole`, `gamma`, `nuclear`, `resistivity`, `acoustic`, `nmr`, `other`), `description` (qué mide, una
línea, sin ecuaciones), `roles` (los roles de `src/core/roles.ts` que registra), `mnemonics` (prefijos para desempatar)
y `typicalOrder` (posición típica de arriba hacia abajo). Incorporadas: rayos gamma, GR espectral, SP, calibre,
temperatura, inducción, laterolog, microrresistividad, densidad, neutrón, sónico y RMN. Todo rol medido incorporado salvo
el trépano (`BS`, sale del encabezado) lo registra alguna herramienta (test).

- **Atribución de una curva** (`ToolCatalog.ownerOf`): por rol; si varias herramientas registran el rol (RT en
  inducción y laterolog, GR en rayos gamma y en la espectral), manda el prefijo del mnemónico (LLD, RLA → laterolog;
  SGR → espectral) y, si ninguno coincide, la primera del catálogo. Las curvas sin rol o con un rol que no registra
  ninguna herramienta (BS, curvas ya interpretadas de un archivo) **no dependen de la sarta**: nunca se filtran.
- **Extensible sin tocar el núcleo**: un módulo declara `tools?: ToolDef[]` en su contrato (como `roles`); el registro
  las valida (id, familia, roles conocidos, ids repetidos) y expone `registry.tools`.
- **El catálogo de pistas se unifica**: `ROLE_GROUP` desaparece; el grupo de cada rol medido sale de la herramienta que
  lo registra (`TOOL_GROUP` herramienta → grupo, con la familia como respaldo para las de módulos). El orden dentro del
  grupo es el de las herramientas y sus roles (cambia levemente: RXO va después de RA10–RA30 y NPHI después de PEF y DRHO).
- **Ficha técnica separada** (`src/core/toolSheets.ts`): `ToolSheet` con qué mide, principio, profundidad de
  investigación (de la herramienta y por curva, `investigationByRole`: una cáscara por curva en el dibujo, p. ej. las
  cinco de la inducción de arreglo), resolución vertical, longitud y diámetro (`SheetQuantity`: típico, mínimo, máximo,
  unidad de longitud, nota), montaje (`pad` | `centralized` | `eccentralized`), limitaciones, fuentes y campos sin
  verificar (`unverified`). `TOOL_SHEETS` tiene una entrada **vacía** por herramienta incorporada; `validateToolSheet`
  exige rangos coherentes, unidades de longitud y al menos una fuente si hay números. `sheetOf(tool)` da la ficha propia
  (módulos) o la de la tabla. La investigación de la 11b (`docs/investigacion/herramientas-de-perfilaje.md`) llegó en
  paralelo: el tipo ya acepta sus campos y el encabezado de `toolSheets.ts` dice cómo se corresponden sus ids y campos
  con los de la app; volcar los valores es un paso mecánico aparte.
- **Orden típico** (`typicalOrder`): el de una triple combo según esa investigación (gamma arriba, densidad con su
  calibre, neutrón, sónico, RMN, resistividad abajo, temperatura en la cabeza); varía por empresa y la usuaria lo cambia.

Descartado:
- Herramienta = grupo de pista del visor. Densidad y neutrón son herramientas distintas (se apagan por separado); el
  grupo «Densidad · neutrón» es una convención de lectura, no un instrumento.
- Mantener dos tablas (la del visor y la de la sarta): se desincronizan con el primer rol nuevo.
- Completar la ficha con valores «típicos» de memoria: un número sin fuente es peor que un hueco (11b).
- Atribuir por mnemónico solo (sin rol): el rol ya resuelve el 95 % y los mnemónicos no son confiables entre empresas.

## D2. Disponibilidad de módulos: clausura sobre el registro

`moduleAvailability(registry, curves, resolved, { disabled })` en `src/core/toolString.ts`, pura.

- **Regla**: un módulo está disponible si cada entrada obligatoria (curva, escalar, tabla o valor por zona) la cubre un
  dato o la salida de **otro** módulo disponible. Menor punto fijo: un ciclo no se justifica a sí mismo. Es la misma regla
  que la viabilidad de `planGraph` (2b); un test corre el motor con varias sartas y verifica que lo que calcula está
  disponible y lo que le falta una entrada no.
- **Estados**: `available`, `needs-data` (solo planificación: correría con la sarta planificada pero el pozo no tiene los
  datos), `unavailable`, `disabled` (desactivado en la interpretación; tampoco cuenta como productor).
- **Qué falta**: `missingInputs` (entradas directas sin cubrir, p. ej. PHIE) y `needs` (los datos medidos de la base de
  la cadena por el camino más corto entre los productores, p. ej. GR, con las herramientas que lo registran). En
  `needs-data`, `toolsWithoutData` = herramientas de la sarta sin esos datos.
- `availabilityReason` arma el motivo en español («Falta RHOB (densidad volumétrica): prendé Densidad en la sarta.»,
  «… agregá Densidad a la sarta.», «… el pozo no la tiene (la registra …).»); `offToolsFor` da las herramientas
  apagadas que lo habilitarían; `modulesEnabledBy(…, toolId)` lista los módulos que una herramienta habilita (para su
  ficha). Costo: ≈ 0,2 ms para los 45 módulos con el pozo de demo; la interfaz lo cachea por identidad.

Descartado:
- Mirar solo las entradas directas: diría «falta PHIE», no qué herramienta agregar.
- Preguntarle al motor (`planGraph`): solo planifica sobre curvas reales y arma el grafo de lo que va a correr, no de
  todo el registro; la planificación necesita roles hipotéticos.
- Enumerar todas las combinaciones mínimas de herramientas: exponencial y difícil de leer; el camino más corto alcanza
  para sugerir.

## D3. Efecto en el cálculo: la sarta vive en `Interpretation` y el motor filtra las curvas

`Interpretation.toolString?: ToolStringState`. `planGraph` arranca con `excludedCurveIds(curvas, interp.toolString,
registry.tools)` y saca esas curvas de las candidatas: los módulos que dependen de ellas no calculan (quedan
`missing-input` o bloqueados, como si el pozo no tuviera la curva) y sus salidas no aparecen en el visor.
`sameEngineInputs` compara también `toolString`, así el puente pide el cálculo. El motor solo recalcula lo afectado
(firma por versión de entradas) y al prender la herramienta vuelve el mismo resultado (test).

- Una **fuente elegida a mano** con una curva de una herramienta apagada queda en suspenso: diagnóstico `info`
  («… es de «Inducción», que no está activa en la sarta. Se usa la fuente por defecto.») y vuelve sola al prenderla.
- **Por qué en la interpretación**: (1) coherencia: si solo el visor ocultara las curvas, PHIE seguiría calculándose con
  la densidad apagada y el panel diría «no disponible» de un módulo cuyas salidas se ven; (2) los snapshots reproducen
  sus resultados (un snapshot «sin inducción» recalcula sin inducción) y la comparación lo describe («Se apaga Densidad
  en la sarta»); (3) deshacer y rehacer gratis por `commit`.

Descartado:
- `display` (solo visor): incoherente con la disponibilidad (arriba) y no entra en snapshots.
- `WellEntry` fuera de la interpretación (como `progress`): cambia resultados sin entrar en snapshots, y la cortina
  antes/después mezclaría sartas.
- Filtrar en el puente (`syncWell` con menos curvas): reenvía datos al worker en cada cambio, pierde la caché del motor y
  deja el pozo del worker distinto del proyecto.

## D4. Modo planificación: el visor y el motor son una vista previa de esa corrida

En planificación, el cálculo y el visor ven **los datos del pozo de las herramientas planificadas y prendidas, más las
curvas sin herramienta** (BS). No se inventan curvas ni pistas: las pistas de herramientas sin datos quedan vacías con su
leyenda («Sin curvas»), igual que en un pozo que no tiene esa medición. La disponibilidad se calcula dos veces: con los
datos visibles (`available`) y con los roles que registran las herramientas planificadas (`needs-data`). La
atribución es estricta: planificar un laterolog sobre un pozo con datos de inducción da `needs-data` («el pozo no
tiene … de Laterolog»), no usa la inducción como si fuera laterolog.

La sarta planificada se conserva al volver al modo datos (`setToolStringMode`), y «Planificar desde la de los datos»
copia herramientas y orden (las apagadas siguen apagadas).

Descartado:
- Visor sin cambios en planificación: planificar sería un ejercicio invisible y contradice «lo que pongas en la sarta
  define qué curvas y pistas aparecen en el visor».
- Pistas fantasma o curvas sintéticas para herramientas sin datos: mostraría datos que no existen. La herramienta sin
  datos se ve en la sarta (11c) y en los módulos `needs-data`.
- Sustituir por rol (planificar laterolog y mostrar la RT de inducción): la vista previa dejaría de ser lo que daría esa
  corrida.

## D5. Estado, recetas y persistencia

```ts
interface ToolStringState {
  mode: 'data' | 'planning';
  off: string[];    // apagadas; valen en los dos modos
  order: string[];  // orden propio de la sarta de datos (arriba → abajo); las que faltan van debajo por orden típico
  plan: string[];   // sarta planificada (arriba → abajo); se conserva al volver a datos
}
```

- Un estado igual al de por defecto se **borra** (campo ausente): un proyecto que nunca tocó la sarta se guarda como
  antes. La sarta de datos no se guarda: se deriva de las curvas cada vez (reasignar un rol o cargar curvas la actualiza).
- Recetas (`src/core/state/toolString.ts`), todas por `commit`: `setToolOn`, `setToolStringMode`, `startPlanning(…,
  'data' | 'empty', tools)`, `addPlannedTool` (prende si estaba apagada), `removePlannedTool`, `moveTool` (en datos
  guarda el orden completo; en planificación reordena el plan), `resetToolString`. Agregar o quitar en modo datos lanza
  un error (la sarta sale de las curvas). Sin cambios devuelven el mismo proyecto (no ensucian el historial).
- **Formato**: campo opcional sin cambiar la versión (como las plantillas de 7b). Al abrir, `sanitizeToolString` valida
  modo e ids y avisa lo descartado; no conoce el registro a propósito: un id bien formado que la app no conoce (módulo
  quitado) se conserva y `resolveToolString` lo ignora, así volver a agregar el módulo restituye la sarta. Proyectos
  viejos: abren en modo datos sin avisos (test).
- **Snapshots** guardan la sarta (son la interpretación entera); `diffInterpretations` suma `tool-mode`, `tool-off` y
  `tool-plan`.

Descartado: subir a v7 con migración (ausente ya significa «por defecto»); guardar la sarta derivada completa (se
desincroniza con los datos); estados separados de apagadas por modo (una herramienta apagada está apagada).

## D6. Conexión mínima

- **Visor**: `ViewerSlot` resuelve las pistas con `visibleCurves(pozo, interpretación)` (`src/app/toolString/select.ts`,
  mismo array si no hay nada apagado: no rompe memos). Las pistas armadas no cambian. La cortina antes/después usa la
  sarta del snapshot en el lado «antes». El catálogo de «Armar pistas» y la figura del perfil usan las mismas curvas.
- **Panel de módulos**: insignia «no disponible» / «sin datos» / «desactivado» con el motivo como título en la lista de
  métodos del paso y en «Todos los módulos»; en el panel del módulo, un aviso con el motivo y un botón «Prender …» por
  cada herramienta apagada que lo habilitaría. Abrir un módulo no disponible sigue permitido (se ven sus parámetros).
- **Control temporal**: paleta de comandos, grupo «Sarta» (`src/app/toolString/commands.ts`): prender o apagar cada
  herramienta, planificar desde los datos o de cero, agregar o quitar de la sarta planificada, volver al modo datos y
  restablecer. Lo reemplaza la vista de la fase 11c.

Queda sin filtrar (abierto): los selectores del histograma y del crossplot, la lista de curvas medidas de la columna
izquierda y la superposición de calidad siguen mostrando todas las curvas del pozo.

## D7. Lo que consume la vista 3D (fase 11c)

- `resolveToolString(curvas, estado, registry.tools)` → `entries` arriba → abajo con `tool` (nombre, rótulo, familia,
  roles), `on`, `hasData`, `curveIds`, `roles` con datos; `outsidePlan` y `uncontrolled`.
- `sheetOf(tool)` → ficha (longitud, diámetro y montaje para el dibujo; investigación y resolución para la ficha);
  vacía hasta la 11b: la vista dibuja con medidas por defecto.
- `moduleAvailability` + `availabilityReason` (estado y motivo por módulo), `modulesEnabledBy` (qué habilita cada
  herramienta), `offToolsFor`.
- Recetas de D5 para los gestos (arrastrar para reordenar = `moveTool`; clic en el interruptor = `setToolOn`).
- `toolStringView(pozo, interpretación)` / `useToolStringView()` (caché por identidad) en `src/app/toolString/select.ts`.

## Preguntas abiertas

- Módulos con entradas «al menos una de» (p. ej. `phit` tiene PHID, PHIN y PHIS opcionales): el contrato no lo
  expresa, así que `phit` (y lo que cuelga de PHIT) figura disponible sin ninguna herramienta de porosidad, igual que lo
  trata el motor. Propuesta: `input.anyOf([...])` en el contrato, que usen el motor y la disponibilidad.
- Reasignar a mano la herramienta de una curva (una RT con mnemónico ambiguo que en realidad es de laterolog): hoy no
  se puede; propuesta: `assign: Record<curveId, toolId>` en el estado si aparece el caso.
- Herramientas que dan datos puntuales (probador de formación MDT, coronas laterales): no están en el catálogo porque no
  registran curvas; la vista 3D podría sumarlas como herramientas de conjuntos de puntos. Lo mismo la cabeza de cable y
  los centralizadores (piezas del dibujo, sin curvas).
- El SP no es una herramienta propia (es un electrodo en otra herramienta, según la 11b): se mantiene como entrada
  aparte para poder apagarlo; la vista puede dibujarlo como electrodo en la herramienta de resistividad.
- Calibre: la 11b distingue el de patín (brazo de la densidad) del multibrazo; la app tiene un solo rol `CALI` y una sola
  herramienta «Calibre». Si hace falta distinguirlos, un rol o un prefijo de mnemónico por variante.
- Filtrar también histograma, crossplot y la lista de curvas (D6).
