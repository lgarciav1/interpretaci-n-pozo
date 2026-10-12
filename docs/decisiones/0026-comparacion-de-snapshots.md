# 0026 — Comparación de snapshots (fase 9a, tarea J)

- Estado: aceptada (fase 9a).
- Alcance J1: carpeta `src/app/snapshots/` (`SnapshotsDialog.tsx`, `SummaryCompare.tsx`, `useSource.ts`,
  `snapshotEngine.ts`, `runner.ts`, `snapshots.css`), lógica pura `src/core/state/snapshotCompare.ts`, fábrica
  `createEngineSupervisor` en `src/app/engineBridge.ts`, coma decimal en `describeDiff`. `Dialogs.tsx` reexporta el
  diálogo. Sin cambios en el protocolo del worker, en el contrato de módulo, en el formato del proyecto ni en el visor.
- Se apoya en los snapshots ya existentes (`src/core/state/snapshots.ts`: `createSnapshot`, `diffInterpretations`,
  `describeDiff`), en el motor (`computeOnce`, `EngineSupervisor`) y en el módulo `zone-summary` (tabla
  `ZONE_SUMMARY`) y `volumetrics` (`OOIP`/`OGIP` por zona).

## Contexto

Un snapshot guarda la interpretación (zonas, parámetros, fuentes, comparaciones, módulos desactivados) pero no los
resultados. El diálogo solo listaba, restauraba y mostraba la diferencia de parámetros en texto. Faltaba ver qué le
pasa al sumario (espesores netos, promedios, volumen) entre dos estados, y verlo sobre el perfil.

## D1. Cálculo del snapshot: un segundo motor en su propio worker

- **Worker, no hilo principal.** Una corrida completa del pozo de demo tarda decenas de ms y crece con el pozo y los
  módulos; en el hilo principal trabaría el diálogo. El motor principal no sirve: su caché y su resultado son los de
  la interpretación activa, y mandarle otra interpretación dispararía un `result` que el puente publicaría como el
  actual.
- **Sin tocar el protocolo.** `createEngineSupervisor(registry, nombre)` (extraído de `engineBridge.ts`) crea un
  segundo `EngineSupervisor` con el mismo worker incrustado (`motor-snapshots`), con su caída a motor en proceso y sus
  reinicios. Se crea la primera vez que se compara. Los mensajes son los de siempre (`well` + `run`); el pozo viaja
  una vez por generación, como en el principal.
- **Una corrida a la vez (`IsolatedRunner`, `runner.ts`, puro).** El cliente coalesce (gana el último) y su resultado
  no dice qué pedido responde. Se manda un pedido, se espera `busy: false` y recién ahí sale el siguiente: cada
  resultado se atribuye sin ambigüedad. Si el worker se cae a mitad, el supervisor relanza el último pedido (el mismo)
  y se sigue esperando.
- **La interpretación actual no se recalcula**: se usa el resultado del motor principal (`useResults`); mientras está
  ocupado, la fuente figura «calculando…».

## D2. Caché y carreras

- **Clave** = id del snapshot + revisión de su interpretación + pozo + revisión de profundidad y de la lista de curvas
  (`runKey`). La revisión es un número por identidad de objeto (`WeakMap`): los snapshots son inmutables, y editar
  una curva medida cambia la lista y obliga a recalcular. Hasta 6 corridas listas en caché (LRU, nunca las que están
  en uso).
- **Carreras.** Cada consumidor (`useSnapshotRun`) toma la corrida por su clave y la suelta al cambiar la selección o
  desmontarse. Un pedido en cola que nadie quiere se descarta antes de mandarlo; uno en vuelo termina y queda en
  caché (es correcto para su clave). La interfaz lee siempre la entrada de SU clave actual: un resultado viejo nunca
  se muestra con la selección nueva.
- El diálogo y la cortina (J2) comparten la misma caché: elegir el mismo snapshot no vuelve a calcular.

## D3. Filas de comparación (puro, `snapshotCompare.ts`)

- `extractSummary(corrida, zonas, profundidad)` lee `ZONE_SUMMARY` y asigna cada fila a su zona por id con
  `layoutZones` (el mismo orden que usa el módulo), más `OOIP`/`OGIP` por zona del volumétrico (en MMbbl y Bcf). Sin
  tabla, devuelve el motivo (`missing`: faltan entradas, error, módulo desactivado) desde los nodos y diagnósticos.
- Métricas: neto de reservorio, neto pay, φe, Sw, Vsh y k medias **del pay** (las que entrega el módulo para el pay),
  y OOIP/OGIP solo si alguno de los dos estados los entrega con un valor ≠ 0.
- Zonas emparejadas **por id** (una zona renombrada sigue siendo la misma; toma el nombre de B), en el orden de A, con
  las que solo están en B al final («solo en A» / «solo en B») y el total último.
- Δ = B − A; diferencias por debajo de 1e-9 relativo son 0 (ruido de punto flotante). % relativo a |A| en espesores,
  k y volúmenes; en fracciones (φe, Sw, Vsh) solo Δ, en v/v. A = 0 con B ≠ 0 da «sin %»; A = B = 0 da 0 %. NaN, nulos
  o infinitos: sin Δ ni signo, y la celda dice de qué lado falta el dato.
- Tests: `tests/snapshot-compare.test.ts` (Δ cero con snapshots iguales —también con el motor real sobre el pozo de
  demo—, signo y %, zonas agregadas/eliminadas, nulos/NaN, división por cero, cambio de n en una zona) y
  `tests/snapshot-runner.test.ts` (atribución, cancelación de pedidos viejos, caché).

## D4. Interfaz

- El diálogo pasa a `xl` y a su carpeta. Arriba, guardar y la lista (Comparar, Restaurar). Abajo, «Comparar sumario
  por zona»: A y B se eligen con dos selectores (un snapshot o «Interpretación actual»), con botón para
  intercambiarlos; por defecto, el snapshot más reciente contra la actual.
- Cada celda: «A → B» (A tenue, B destacado) y debajo Δ con signo explícito (+ / −) y el %. Sin cambio, un solo valor
  y «0» tenue: lo que cambia salta a la vista. Color sobrio del sistema de diseño **solo como refuerzo del signo**
  (sube: `--color-accent-text`; baja: `--color-warn-text`): no se dice si el cambio es bueno o malo (más Sw es peor,
  más neto pay es mejor). Las filas con cambios llevan una marca de acento a la izquierda; el total va al pie.
- Mientras falta una fuente, «Calculando el sumario de «X»…»; si una no tiene sumario, un aviso que dice cuál y por
  qué. Debajo, la lista de `describeDiff` entre A y B (ahora con coma decimal).

## Abierto

- Comparar más de dos estados a la vez, o exportar la tabla de comparación (CSV/Excel).
- Promedios de reservorio (no solo del pay) como columnas opcionales.
