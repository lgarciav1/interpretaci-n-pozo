# 0006 — Deshacer y rehacer

- Estado: aceptada.
- Alcance: `src/core/state/history.ts` (puro, con tests en `tests/history.test.ts`), `src/app/store/project.ts`,
  `src/app/store/uiSync.ts`, `src/app/shell/historyActions.ts`, botones en `TopBar`.

## Contexto

En el visor los topes de zona se agarran a ±5 px de la línea: un arrastre accidental cambiaba zonas sin vuelta
atrás. Todo cambio del proyecto ya pasaba por `commit(etiqueta, receta)` con recetas puras y proyectos inmutables
con estructura compartida, así que guardar el proyecto anterior cuesta un puntero.

## D1. Historial de proyectos completos, no de operaciones inversas

Cada entrada guarda el proyecto anterior, no un «deshacer» por receta. No hay que escribir inversas (que se
desincronizan con las recetas) y deshacer es exacto por construcción. Memoria: 100 entradas comparten casi todo; lo
que crece son los objetos chicos que cambian (parámetros, zonas, display).

## D2. Agrupado por etiqueta y tiempo

Un slider arrastrado hace decenas de `commit`. Se funden los cambios **consecutivos con la misma etiqueta** a menos
de 800 ms del anterior (ventana deslizante); la entrada conserva el proyecto previo al primero. El tiempo entra como
parámetro (`recordChange(h, prev, label, now)`) para poder probarlo. Deshacer o rehacer corta el grupo: el próximo
cambio con la misma etiqueta abre otra entrada. Consecuencia: la etiqueta tiene que nombrar *qué* se cambia
(«Cambiar Rw», «Mover tope de C»), no un genérico («Parámetro»), o se agruparían cambios distintos.

Alternativa descartada: que cada control avise inicio y fin de gesto (como el arrastre del visor, que hace un solo
`commit` al soltar). Obligaría a tocar todos los controles y a cada módulo nuevo; la regla por etiqueta no.

## D3. Qué se deshace

Todo lo que pasa por `commit`: parámetros, fuentes, comparar, zonas, roles, display de curvas, snapshots, cargar
pozo, cambiar de pozo, marcas del flujo. `replace` (abrir un proyecto) vacía el historial: deshacer hacia otro
archivo sería confuso. El estado de interfaz (`useUi`) no entra; si queda apuntando a algo que ya no existe,
`uiSync` lo corrige después de cada cambio.

## D4. Atajos

Ctrl/Cmd+Z deshace; Ctrl/Cmd+Mayús+Z y Ctrl+Y rehacen, con un `keydown` en `window`. Con el foco en un campo de
texto editable (input de texto o número, textarea, contenteditable) el atajo es del navegador. Durante un arrastre
del visor no se hace nada (el visor avisa con `onDragChange` y `ViewerSlot` lo publica en `useViewer.dragging`). Con un diálogo modal abierto
tampoco: deshacer cambiaría el proyecto detrás del diálogo sin que se vea (los botones de la barra siguen disponibles
al cerrarlo).
