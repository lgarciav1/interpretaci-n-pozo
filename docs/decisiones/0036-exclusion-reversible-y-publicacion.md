# ADR 0036: P3a, exclusión reversible por intervalos

Fecha: 2026-10-30. Continúa ADR 0035 sobre PR #44. Habilita la primera operación del editor: máscara manual v1. No admite todavía despike, filtrado, interpolación, alineación ni correcciones físicas.

## Receta, referencias y semántica

Interpretation.preparation es opcional: su ausencia conserva el proyecto anterior. El estado tiene schemaVersion=1 y hasta 32 MaskNode. Cada nodo tiene id, kind=mask, methodVersion=1, enabled, input={kind:original,inputRevisionId,curveId} y hasta 256 intervalos identificados. Hay un nodo por curva; P3a solo consume originales. Se rechazan estructura, campos, versiones o referencias desconocidos. No hay funciones ni buffers dentro de la receta.

Los intervalos son **MD en metros, cerrados [top, base]**. Se admiten exclusiones de una muestra exacta. La UI rechaza límites fuera del pozo, base menor al tope y tramos sin muestras. Las exclusiones solapadas se evalúan como unión, pero se conservan sus ids para restaurar cada decisión por separado. Restituir una exclusión no elimina las otras que la solapan. Restituir la última elimina la receta y selecciona explícitamente su original; si ese original ya no existe y es una fuente elegida, se bloquea la operación hasta revisar la fuente. Nunca se borra una fila, cambia el índice ni interpola un valor.

Ejemplo independiente: profundidad 10,11,12,13,14; original 10,NaN,30,40,50; excluir [11,13] produce 10,NaN,NaN,NaN,50 y calidad 0,3,2,2,0. Los originales permanecen intactos. Se distinguen tres muestras en el tramo de dos mediciones que efectivamente pasan a sin dato.

| Flag | Valor | Semántica |
|---|---:|---|
| OriginallyMissing | 1 | Ya era NaN en el original. |
| Excluded | 2 | La muestra está en una exclusión manual. Puede combinarse con 1. |
| Suspect / Interpolated / Filtered / Shifted | 4 / 8 / 16 / 32 | Reservados; la máscara v1 no los produce. |
| Corrected / OutOfDomain | 64 / 128 | Reservados; corrected nunca garantiza exactitud. |

La máscara v1 solo publica flags 0–3. Su ledger de correcciones está explícitamente vacío. Un valor infinito en el original hace fallar esta operación; no se convierte silenciosamente en medición válida. Cambiar esta semántica o los extremos requiere otra versión del método.

## Vínculo a datos, planificación y worker

La referencia a la revisión original se persiste. En cada pedido se resuelve su curva y profundidad contra el almacén de revisiones; se comparan versiones de array, índice, rol, unidad y mnemónico con los datos activos. Cambiar solo laboratorio/encabezado puede compartir exactamente esos orígenes y mantener la preparación. Reemplazar curvas, cambiar su metadata o cambiar la grilla deja el nodo needs-input; el puerto seleccionado y sus consumidores quedan bloqueados por ADR 0035. Una referencia inexistente o de otro pozo es un error estructural de proyecto.

Las claves son de sesión, no hashes persistidos. La firma de la máscara incluye versión, curva/versionado, unidad/rol, índice y unión normalizada de intervalos. Los ids de intervalos no cambian la física. El plan predice las identidades de los artefactos sin producir arrays en el hilo principal. stateKey identifica además las decisiones/orígenes que justifican la proyección; el cliente y calibrationKey rechazan recetas distintas con un contexto anterior. Cuando cambia solo metadata de una receta físicamente equivalente, el puente puede volver a vincular el paquete sin ejecutar el motor.

El worker conserva los **originales residentes separados** de las curvas que entrega al motor. Revalida el plan contra receta y versiones recibidas, evalúa máscaras puras y ejecuta petrofísica sobre esa misma proyección. No realimenta un resultado preparado como original. El worker/in-process usan los mismos validadores y evaluador. La ascendencia viene del catálogo y de la fuente original, no del nombre de salida. Los métodos y modelos petrofísicos/ML no cambian.

El resultado transporta outputs y todos los artefactos preparados del pedido. El cliente valida versiones, ids, tamaños, Float64Array, Uint16Array y flags antes de reemplazar caché o publicar **cualquier** salida. Los outputs mantienen sus deltas; las preparadas se envían completas. Un paquete incompleto fuerza full una vez y conserva el reinicio/error acotados de ADR 0034, incluyendo el reenvío de la receta. Todos los buffers transferidos son copias; proyecto y caché viva conservan los suyos.

## Aceptar, cancelar y guardar

Preparar datos se abre desde el panel del pozo. El borrador no modifica Project: Previsualizar construye una propuesta, la evalúa por el IsolatedRunner de snapshots y muestra hasta 14 muestras alrededor del tope y los conteos de calidad. Comparación y preview comparten una sola tarea pesada aislada; el preview más reciente tiene prioridad sobre snapshots pendientes. El motor principal no recibe esa propuesta.

Aplicar comprueba el mismo proyecto base, borrador y contexto completo. Acepta migración de entradas, receta y selección de fuente en **un commit del historial**. En legado, activa las revisiones v7 al aceptar; cancelar no migra el proyecto. Los snapshots anteriores quedan legacy-current-inputs según ADR 0033. Guardar/abrir persiste recetas y originales, sin añadir curvas preparadas ni blobs derivados. Los snapshots nuevos fijan revisión y receta y su runner resuelve ambos. v1–v6 sin preparación conserva su comportamiento; un archivo v6 con recetas se rechaza para no descartar su vínculo. Los lectores antiguos de v7 que no admiten preparation pueden rechazar estos archivos nuevos.

Restaurar, alternar fuente original/preparada y aceptar son reversibles por undo/redo. Cambiar el proyecto o el tramo invalida la propuesta pendiente; cerrar libera su lease y cancela la preparación cuando es posible. Cancelación trabaja por bloques de 16.384 muestras y cede al event loop. La fase petrofísica síncrona no se interrumpe: un resultado cancelado/superado se descarta. Mensajes cancelled liberan la cola y no publican datos parciales ni un error científico falso.

## Consumidores y calidad visible

La publicación contiene la proyección preparada y la interpretación del mismo pedido. Motor, visor, overlays, plots, fuentes del inspector, snapshots, figuras, exportación e informe resuelven ese paquete. Los datos originales del proyecto y su QC permanecen disponibles para auditoría; excluir mediciones no hace desaparecer sus problemas originales del reporte QC.

La vista muestra la preparada elegida. Comparar originales y preparadas solo cambia la presentación, sin modificar fuentes o archivo. Los gráficos conservan las selecciones explícitas por id (m: identifica el original o la preparada concreta); la opción Fuente de interpretación sigue r:ROL. No se cambian silenciosamente los gráficos que ya eligieron un original.

LAS/CSV/XLSX pueden exportar original, preparada y QC. QC codifica 0=conservada, 1=faltante original, 2=excluida, 3=ambas; se explica en el diálogo y descripciones donde el formato las soporta. Una preparada excluida por la sarta no se ofrece como vigente en esa exportación. El informe describe las exclusiones y conserva QC de originales; vuelve a verificar receta/contexto para rechazar un resultado anterior. Una selección que ya no está disponible se rechaza al exportar.

## Presupuestos y límites

Antes de evaluar se estima N × 10 bytes × artefactos (f64 + u16) y se rechaza superar 128 MiB. La caché LRU del evaluador cuenta bytes reales hasta ese límite; las copias de transferencia y los originales son memoria adicional. La caché del runner también aplica límite de arrays de 128 MiB además de seis entradas; resultados con leases activos quedan fijados hasta soltarlos. Estos límites no prometen un techo global del proceso ni evitan por sí solos presión de memoria durante migración/transferencia. Se conservan los límites de archivo de ADR 0033.

P3a queda limitado a máscaras manuales sobre originales y a las operaciones aquí descritas. Métodos automáticos, encadenar preparaciones desde la UI, interpolación/puesta en profundidad, calibración DRX y correcciones ambientales necesitan versiones, validación y evidencia propias. No se cierran #31 ni #32. La validación por file:// sigue limitada por la política del Chromium del entorno; HTTP local y la alternativa offline sin Worker/SubtleCrypto sí se recorren.
