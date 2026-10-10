# 0009 — Presiones MDT y conjuntos de puntos del pozo

- Estado: aceptada (fase 6b-2).
- Alcance: `src/core/pointSets.ts`, `Well.pointSets`, `Interpretation.pointSets`, `src/core/state/pointSets.ts`,
  formato de proyecto v5, `display.overlays`, unidades `mD/cP` y `kg/cm²`, `src/io/pressures.ts`,
  `src/petro/pressure.ts`, carpeta `src/modules/mdt/`, paneles del dock aportados por módulos (`src/ui/dockPanel.ts`),
  cambios de contrato en el visor (pista propia dinámica, `ViewerData.commit`, `OverlayTrack.unit`) y en la capa de
  tendencias (herramienta sobre una serie dada, conversión de unidades, etiqueta compacta, prioridad del puntero).
- La matemática de ajuste e intersección (`src/petro/regression.ts`) y de gradientes (`src/petro/gradients.ts`) es de
  la 6b-1 y se usa por sus firmas.

## Contexto

Módulo obligatorio del profesor: «Carga de presiones de formación vs. profundidad, con filtro de puntos de mala
calidad. Gradientes por regresión para cada fluido (con la herramienta de líneas de tendencia), densidad de fluido
resultante y contactos donde se cruzan. Superpuesto al visualizador para contrastar con la Sw.»

Hasta acá el pozo solo tenía curvas en un índice de profundidad. Las presiones MDT son otra cosa: unas decenas de
mediciones puntuales, cada una con su profundidad, presión, movilidad, presión del lodo, calidad y comentario. La
6b-3 (corona) trae lo mismo con plugs (φ, k, densidad de grano). La tabla de pendientes dejaba tres preguntas para
esta fase: dónde viven esos puntos, dónde se calculan los contactos (el motor corre en un worker sin proveedores de
series) y cómo se excluyen puntos de un ajuste.

## D1. Conjuntos de puntos genéricos en el pozo

```ts
interface PointSet {
  id: string; kind: 'pressure' | 'core' | string; name: string; source?: string; synthetic?: boolean;
  depth: Float64Array;                      // m MD, finita, no decreciente (se admiten repetidas)
  pointIds: readonly string[];              // clave estable de cada punto (id de la prueba, n.º de plug)
  columns: Record<string, { label, unit, values: Float64Array } | { label, values: string[] }>;
}
Well.pointSets: PointSet[]
```

- **Son datos medidos**: viven en el pozo, como las curvas; arrays inmutables; `createPointSet` valida (largos, ids
  únicos y no vacíos, profundidad finita, columnas numéricas con unidad) y ordena por profundidad arrastrando todas
  las columnas.
- **El núcleo no sabe qué significa cada columna**: las claves las define el módulo dueño del tipo
  (`pressure`, `mobility`, `mudBefore`… para MDT; `phi`, `k`, `rhog` para corona). Agregar un tipo no toca el núcleo.
- **Lo que decide el usuario va en la interpretación** (`Interpretation.pointSets[idConjunto]`):
  `{ points: { [idPunto]: { status?: 'include' | 'exclude', tag?: string } }, depthShift?: number, settings?: {} }`.
  `status` fuerza incluir o descartar por encima de la propuesta automática; `tag` es libre (fluido asignado a mano,
  tipo de roca de un plug); `depthShift` es la puesta en profundidad corona–perfil (6b-3); `settings`, los ajustes del
  módulo para ese conjunto (umbral de movilidad). Entra en snapshots y en deshacer.
- **El motor no los lee.** `toEngineWell` solo lleva id, profundidad y curvas; `sameEngineInputs` no compara
  `pointSets`. Para que cargar presiones no dispare nada, el puente sincroniza el pozo solo si cambian su id, su
  profundidad o su lista de curvas (antes, por identidad del objeto pozo), y el QC se reusa con el mismo criterio.
- Recetas puras en `src/core/state/pointSets.ts`: `addPointSet`, `removePointSet` (también borra sus decisiones),
  `renamePointSet`, `setPointDecision(s)` (un parche por punto; `null` vuelve a la propuesta; si nada cambia, el mismo
  proyecto), `setPointSetSetting`, `setPointSetDepthShift`. Todas por `commit`.
- **Formato v5**: los conjuntos se guardan con la misma codificación de arrays que las curvas (Float64 + deflate en
  base64, exacto bit a bit con NaN) y las columnas de texto como listas. Migración v4 → v5: `pointSets: []` en cada
  pozo y `pointSets: {}` en cada interpretación (pozos y snapshots). Al abrir, un conjunto roto (ids repetidos o vacíos,
  distinta cantidad de ids que de profundidades, profundidad no finita) se descarta con aviso sin perder el resto del proyecto; una
  columna inválida (forma, array ilegible o largo distinto del de la profundidad) se descarta sola, con aviso; las
  decisiones se sanean como las tendencias (`sanitizePointSetDecisions`).

**Cómo lo reusa corona (6b-3)**: un lector `src/io/core.ts` que arme `createPointSet({ kind: 'core', columns: { phi,
k, rhog } })`; la puesta en profundidad es `setPointSetDepthShift` (ya está en el modelo y en el formato); excluir un
plug malo es `status: 'exclude'`; el modelo k–φ es una tendencia (`model: 'exp'` o `'power'`) sobre un proveedor de
series `core` con `xIsDepth: false` y `depth` para filtrar por zona, y los puntos sobre el visor son otra
superposición con pista propia o sobre la pista de porosidad (`xOf('PHIE', φ)`). Nada de eso toca el núcleo.

## D2. Calidad: reglas que proponen, el usuario decide

`assessQuality` (`src/modules/mdt/model.ts`) marca motivos por punto: sin presión; texto de calidad, tipo o comentario
(seca, tight, sobrecargada, sello perdido, inestable; en español e inglés); movilidad por debajo de un umbral (1 mD/cP
por defecto, ajustable por conjunto); presión de formación ≥ presión del lodo (sospecha de sobrecarga). Con algún
motivo, la **propuesta** es descartar. El estado efectivo es la decisión del usuario si la hay o la propuesta
(`pointStatuses`, con caché por identidad). Una decisión que coincide con la propuesta se borra (`decisionFor`): la
interpretación guarda solo lo que el usuario cambió. Una prueba sin presión nunca entra.

## D3. Gradientes = tendencias normales sobre el proveedor `mdt`

- Proveedor `mdt` (`src/modules/mdt/series.ts`): serie = presión (psi) vs. profundidad de los puntos **incluidos**
  del conjunto. Los descartados no están en la serie: no entran en ningún ajuste. `xIsDepth: true` (la pendiente es
  un gradiente: psi/ft, bar/m, kPa/m y densidad equivalente con `gradientReadings`), clave de punto = id de la
  prueba, `placement: { overlayId: 'mdt' }`. Misma identidad mientras no cambien datos ni decisiones (cachés).
- **El fluido va en la clave de la serie**: `<conjunto>` (todos) o `<conjunto>:gas|oil|water`. Un gradiente es un
  `TrendSpec` lineal con `series: { provider: 'mdt', key: 'mdt-…:water' }`; cambiar su fluido es cambiar la clave.
  No hizo falta un campo nuevo en `TrendSpec` y el panel «Tendencias» los muestra como cualquier otra.
- **Fluido de cada punto**: el del gradiente cuyo tramo lo usa (derivado, no se guarda); colorea el punto y la tabla.
- Densidad del fluido: `gradientReadings` (6b-1). Fluido sugerido: `classifyFluidByDensity`
  (`src/petro/pressure.ts`, rangos típicos con cita: gas 0,05–0,35 g/cm³, petróleo 0,55–0,95, agua 0,98–1,20; entre
  rangos, el más cercano con los dos candidatos; ≤ 0 o > 1,6, «densidad no física»). El panel avisa si no coincide
  con el fluido elegido.
- «Nuevo gradiente» del panel arranca la herramienta de tendencias **con una serie dada**
  (`TrendTool.series: { ref, label, name, color, extend, hint }`): el arrastre vale en cualquier pista (la serie no
  depende de la pista), la tendencia nace con nombre, color de fluido y extensión punteada (para ver dónde se cortan)
  y no abre el panel «Tendencias» (el de MDT ya muestra el resultado).

## D4. Contactos en la interfaz, no en el motor

`findContacts` (`model.ts`, puro): ordena los gradientes con fluido por la profundidad media de su tramo y cada par
**contiguo** de fluidos distintos da un contacto: gas–petróleo → CGP; petróleo–agua → CAP (por presiones es el nivel
de agua libre, FWL); gas–agua sin petróleo entre medio → CGA. El corte es `intersectTrends` (6b-1). Sin contacto, con
el motivo: rectas paralelas; corte fuera del rango razonable (30 m por encima del tope del gradiente de arriba a 30 m
por debajo de la base del de abajo); fluido más denso arriba. Con contacto pero advertencia: corte dentro de los puntos
de uno de los dos fluidos. Contactos por conjunto (dos corridas en compartimentos distintos no se cruzan) y solo con
gradientes visibles. `mdtAnalysis(pozo, interpretación)` junta gradientes, densidades, sugerencias, contactos y fluido
por punto, con caché por identidad; lo usan la superposición y el panel.

Se descartó calcularlo en el motor (salida de un módulo): el worker no tiene proveedores de series ni las tendencias
como entrada, y cada arrastre de tramo pasaría por el worker. Es O(n) con n ≈ decenas.

## D5. Superposición: pista «Presión», puntos y contactos que cruzan el visor

- **Pista propia dinámica**: `OverlayTrackDecl.resolve({ well, settings })` (contrato nuevo del visor) devuelve
  escala, unidad y título según el pozo; `withOverlayTracks` lo aplica al resolver las pistas (no en cada cuadro) y, si
  devuelve null, la pista no se muestra (pozo sin presiones). Escala lineal automática con el rango de las pruebas que
  tienen sentido (sin secas, sin sello ni inestables, que estirarían la escala), extremos redondos; no depende de lo
  que se descarte (no salta con un clic). Va después de la pista de saturación (`after: 'saturation'`) para leerla
  junto a la Sw.
- **Unidad**: psi por defecto; bar, kPa y kg/cm² a elección, guardada en `project.display.overlays.mdt.unit`
  (ajustes de pistas propias por superposición: genérico, saneado al abrir, receta `setOverlaySetting`, se deshace).
  `OverlayTrack.unit` la expone; la capa de tendencias convierte sola la serie (psi) a la unidad de la pista.
- **Dos superposiciones** (`mdt`, orden 10, y `mdt-points`, orden 30): la primera dibuja las líneas de contacto (que
  cruzan **todas** las pistas, punteadas, y sólidas en la de presión) y atiende el puntero; la segunda dibuja los
  puntos encima de los gradientes, el rombo donde se cortan y la sigla del contacto en la pista de profundidad (en la
  de presión chocaba con las etiquetas de los gradientes, que nacen en los extremos de cada tramo, justo donde están
  los contactos).
- Puntos: incluidos = llenos del color del fluido (gas rojo, petróleo verde, agua azul); descartados = vacíos con ×;
  incluidos a pesar de la propuesta = anillo de advertencia; fuera de escala = triángulo en el borde. Tooltip con
  prueba, profundidad, presión, movilidad, calidad, propuesta y fluido; **clic** incluye o descarta; Tab y Enter
  desde el teclado (`targets`).
- **Escritura sin stores**: `ViewerData.commit(etiqueta, receta)` (contrato nuevo) es la vía de escritura de una
  superposición de módulo; `ViewerSlot` le pasa `useProject.commit`.
- **Prioridad del puntero**: herramienta y manijas de tendencias (20) > puntos MDT (10) > líneas de tendencia (5,
  superposición nueva `trends-lines`). Antes la línea de tendencia ganaba sobre un punto que está sobre ella (el caso
  normal): el clic seleccionaba el gradiente en vez de descartar el punto. Además una serie puede declarar
  `pickSamples: false` (sus puntos los maneja el módulo: el visor no ofrece excluirlos de a uno con un clic, que en MDT
  confundiría «excluir de este gradiente» con «descartar la prueba») y `canvasLabel: 'gradient'` (etiqueta de una
  línea, «0,453 psi/ft · 1,04 g/cm³», al costado del medio del tramo: en una pista angosta con tres rectas, las
  etiquetas de dos líneas no entraban y se apilaban).

## D6. Panel «Presiones MDT» en el dock, aportado por el módulo

- Es un **panel del dock**, como «Tendencias» (la herramienta que usa): MDT no es un módulo del motor (no calcula
  curvas ni puertos), así que un panel de módulo (`ModulePanel`, que cuelga de un módulo registrado en el flujo) no
  encaja. Para no tocar la app, los paneles del dock ahora también se descubren: `src/modules/<id>/dock.tsx` exporta
  `dockPanels: DockPanelDef[]` (contrato en `src/ui/dockPanel.ts`); van antes de «Motor».
- Contenido: barra (conjunto, rótulo «Ejemplo sintético», movilidad mínima, unidad, cargar otra tabla, borrar el
  conjunto con sus gradientes); tabla de pruebas (incluida, id, MD, presión, movilidad, calidad con el motivo de la
  propuesta, fluido; clic en una fila la muestra en el visor); gradientes (nuevo por fluido, psi/ft, bar/m, densidad,
  R², n, tramo, fluido elegido y sugerido, elegir otro tramo, ver, ocultar, borrar) y contactos (sigla, profundidad,
  presión, advertencias). Estado vacío con «Cargar presiones» y «Usar presiones de ejemplo». Todo por `commit`.
- Asistente de carga (`LoadPressuresDialog.tsx`, mismas piezas que el de pozos): archivo → columnas (qué es cada una y
  su unidad, con confianza) → vista previa de las pruebas con los avisos de lectura y cuántas se proponen descartar.
  El de pozos mapea columnas a roles de curva; este, a campos de una prueba: por eso es otro asistente y no un modo
  del primero.

## D7. Lectura

`src/io/pressures.ts`: `parseTable(…, { requireDepth: false })` (opción nueva: una tabla de pruebas suele empezar por
el id, no por la profundidad) → `suggestPressureMapping` (por nombre sin tildes, por la descripción del LAS o por la
unidad: MD/TVD, presión de formación, movilidad, hidrostática antes/después, calidad, tipo, comentario, id; cada campo
una vez) → `buildPressureSet` (m, psi y mD/cP; filas sin profundidad descartadas con aviso; sin presión, conservadas;
ids de la columna de prueba o P01…, repetidos numerados). Excel, CSV y LAS. Unidades nuevas en el núcleo: `mD/cP`
(dimensión movilidad) y `kgf/cm2`, y alias psia/psig/bara/barg (el cero no cambia gradientes ni contactos).

## D8. Datos de ejemplo

`src/modules/mdt/example.ts`: 21 pruebas sintéticas para el pozo del TP, con `synthetic: true` y nombre «MDT · ejemplo
sintético» (la interfaz lo rotula siempre). Columna continua en D–E: FWL 8086 m (donde la Sw calculada con los
parámetros por defecto pasa a ≈ 1) y CGP 8009 m (donde la Sw es mínima); agua 0,45 psi/ft, petróleo 0,33, gas 0,08;
ruido ±2 psi con semilla fija; una prueba seca, una sobrecargada y una tight. «Usar presiones de ejemplo» carga los
puntos y los tres gradientes ya trazados; los contactos salen a menos de 5 m de los de diseño (el ruido sobre rectas
que difieren en ≈ 0,39 psi/m).

## Alternativas descartadas

- **Puntos en un store del módulo.** No entrarían en el proyecto ni en deshacer, y el proveedor de series (que solo
  lee pozo e interpretación) no los vería; además la capa de tendencias no se redibujaría al cambiarlos.
- **Puntos como curvas dispersas en el índice del pozo** (NaN salvo en las cotas de prueba). Dos pruebas a la misma
  cota no caben, la cota se redondea al paso del perfil, no hay columnas de texto y el motor las trataría como perfiles.
- **Decisiones (descartado, fluido) en el conjunto.** Mezclaría datos con interpretación: un snapshot no las guardaría.
- **Un `fluid` en `TrendSpec`.** Cambio de núcleo para algo que la clave de la serie ya expresa.
- **Contacto como salida del motor.** Ver D4.
- **Panel MDT como panel de módulo del motor.** Obligaría a registrar un módulo sin cálculo en el flujo guiado.
- **Rótulos de contacto en la pista de presión.** Chocan con las etiquetas de los gradientes (ver D5).

## Pendiente

- Pozos desviados: los gradientes se calculan contra MD; el panel avisa si TVD difiere de MD en más de 1 m. Usar TVD
  como variable independiente cuando haya un pozo desviado.
- «Usar el contacto como tope de zona» (opcional del pedido): no se hizo; sería una receta que parta la zona que lo
  contiene a esa profundidad (`createZone` de `src/core/state/zones.ts`).
- Ecuaciones (ρ = gradiente/g, contacto = intersección) para el futuro módulo Ecuaciones.
