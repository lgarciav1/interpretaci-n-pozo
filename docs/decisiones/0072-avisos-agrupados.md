# 0072 — Avisos agrupados y navegables

- Estado: aceptada (ficha F02 de `docs/masterplan-funciones-nuevas.md`).
- Alcance: `src/core/module.ts` (`ComputeContext.warn`), `src/core/engine/graph.ts` (`Diagnostic`),
  `src/core/engine/engine.ts`, `src/core/state/project.ts` y `serialize.ts` (marcas «visto»), los módulos que avisan
  por zona, `src/app/shell/dockPanels.tsx` (panel Avisos). Capturas: `docs/capturas/avisos/`.

## Contexto

El panel Avisos pintaba `level` y `message` en una lista plana: con el pozo del TP son 30 renglones, 12 de ellos de un
solo módulo (invasión escalonada). La zona a la que se refiere un aviso existía solo dentro del texto («en la zona C»),
así que no había forma de saltar al visor sin leer el texto, y no se podía decir «esto ya lo vi».

## Decisión

1. **La zona viaja como dato, no se lee del texto.** `ComputeContext.warn(message, where?)` acepta un segundo
   argumento opcional `{ zoneId?: string; depth?: number }`. `Diagnostic` suma `zoneId?` y `depth?` (m, profundidad
   medida) opcionales. El motor guarda en caché el aviso con su `where` y lo copia al diagnóstico. Dos avisos con el
   mismo texto y distinta zona son distintos (la deduplicación compara texto y zona).
   - Se completa en los módulos que hoy avisan «en la zona X»: el que tiene la zona a mano pasa su id. Los avisos de
     pozo entero no llevan zona.
   - `depth` queda para avisos puntuales (una muestra o un punto MDT). Ninguno lo usa todavía en el TP; el panel lo
     soporta igual (salta a ±5 m de esa profundidad).
   - Compatibilidad: ambos campos son opcionales; los módulos que llaman `warn(texto)` siguen igual.
2. **Agrupado por paso del flujo y, dentro, por módulo.** El paso se toma de `stepsOfModule` (el primero si hay varios);
   los módulos sin paso van a un grupo «Otros módulos» al final, y los diagnósticos sin `moduleId` (errores del
   planificador, zonas, ciclos) a «General» al principio. Cada grupo es plegable y muestra cuántos avisos tiene y de
   qué gravedad. Se abre plegado por defecto todo grupo sin errores cuando hay más de 10 avisos.
3. **Filtro por gravedad.** Tres fichas (error, advertencia, información) con su cuenta; se puede ocultar cada gravedad.
   El filtro y el plegado son estado de interfaz, no del proyecto.
4. **Un clic navega.** Clic en el nombre del módulo: abre su paso en el flujo (mismo efecto que elegirlo en el
   Inspector: `activeModuleId` y `activeStepId`). Clic en un aviso con zona: además lleva el visor a esa zona
   (`useTrendsUi.requestRange(top, base)`, el mismo pedido que el comando «Ir a la zona X en el visor»).
5. **«Visto» se guarda por pozo, fuera de `interpretation`.** `WellEntry.seenDiagnostics?: string[]` guarda huellas
   de los avisos marcados. La huella es `moduleId|code|zoneId|message` (texto completo): si el aviso cambia (otro
   porcentaje, otra cantidad de muestras) la huella cambia y el aviso vuelve a aparecer sin marcar. Igual que
   `progress`, vive fuera de `interpretation`: marcar no recalcula, no entra en snapshots ni en el historial de
   deshacer de la interpretación. Se serializa con el proyecto (campo opcional, sin cambiar la versión del formato:
   un archivo sin el campo abre igual). Las huellas de avisos que ya no existen se podan al marcar.
   - Los vistos no se ocultan: se atenúan y bajan al final de su grupo. Un interruptor «Ocultar vistos» los saca.
   - La insignia del panel cuenta solo los no vistos.

## Alternativas descartadas

- **Leer la zona del texto con una expresión regular.** Frágil (cada módulo redacta distinto, «zona A» vs «capa A»,
  nombres de zona con espacios) y ata el texto, que es para la usuaria, a la lógica.
- **Guardar «visto» en `interpretation`.** Dispararía el recálculo y ensuciaría snapshots y comparaciones.
- **Guardar «visto» en `localStorage`.** La ficha pide que viaje con el proyecto.
- **Huella por `moduleId|code|zoneId` sin el texto.** No reiniciaría el visto cuando cambia el aviso (p. ej. de 3 a 30
  muestras recortadas), que es justo lo que la ficha pide.
