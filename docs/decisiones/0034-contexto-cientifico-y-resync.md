# ADR 0034: contexto científico y recuperación del protocolo

Fecha: 2026-10-30. Estado: P2a implementado; continúa ADR 0033/D5 y masterplan #33 sobre PR #42. No habilita preparación ni DRX. La proyección de artefactos evaluados, las fuentes preparadas y calibrationKey se concretan en ADR 0035 (P2b); el evaluador de recetas queda en P3.

## Identidad y alcance

EngineContext contiene wellId, inputRevisionId (null en legado), depthKey, preparationKey y engineKey. Se exige en todos los resultados producidos por EngineClient. gen/seq siguen identificando transporte; syncId identifica cada sincronización de entradas, incluido un reenvío completo. Ninguno sustituye la identidad científica.

Las claves son de sesión, basadas en identidades de arrays inmutables y metadatos; no son SHA ni se persisten en v6/v7. engineKey incluye la lista de curvas (id, mnemónico, rol, unidad, contenido y procedencia) y zonas/parámetros/fuentes/comparaciones/desactivaciones/sarta. La representación de objetos de interpretación ordena claves JSON para evitar invalidar por su orden. El cambio de identidad de un array también cambia su clave. No se hashean perfiles al mover el cursor.

La proyección actual es identidad: conserva arrays y fuentes. preparationKey es identity. El productor engineContext rechaza una curva preparada que pretenda usar esta proyección sin plan validado. WireCurve transporta origin, contentVersion, depthKey, ancestorToolIds y qualityKey opcional. La identidad usa origin=original, versión de array y ascendencia vacía cuando no está atribuida; no inventa herramienta/modelo/corrección. La ascendencia vacía indica falta de atribución, no independencia demostrada de herramientas; el planificador P2b debe completarla antes de usarla para preparación. En legado, inputRevisionId=null tampoco atribuye laboratorio histórico. No hay productor preparado ni nueva fuente preparada disponible en la UI. La selección explícita de una curva inexistente sigue bloqueando consumidores por las reglas vigentes del grafo; no se añade un fallback implícito.

## Publicación y cachés

EngineClient guarda el contexto de cada pedido y el último solicitado. Un mensaje de otro gen/seq no libera el pedido en vuelo. Una respuesta válida de una interpretación ya superada puede conservarse como base incremental por versiones, pero no se publica como el estado actual. Solo se instala una caché cuando todas las salidas están presentes y son coherentes: versiones, claves/tipos, unidades, dimensiones y formas de escalares/tablas. Una respuesta incompleta nunca se publica junto con un error.

El puente calcula el contexto desde WellEntry y verifica su coincidencia completa antes de publicar. Al cambiar entradas/decisiones del motor, retira las salidas obsoletas mientras calcula; las curvas medidas y navegación permanecen disponibles. Display, tendencias y decisiones puntuales sin consumidores del motor no provocan recálculo.

Cambiar solo laboratorio/adquisición/encabezado puede cambiar inputRevisionId sin cambiar la física del motor actual. En ese caso se permite volver a vincular un resultado completo únicamente si coinciden wellId, depthKey, preparationKey y engineKey. Se publica una copia con el contexto nuevo y las mismas salidas, sin ejecutar el motor. Este permiso depende de que el motor actual no consuma laboratorio: P2b debe extender la dependencia o añadir calibrationKey antes de conectar consumidores DRX.

El runner aislado incorpora el contexto completo en la clave de snapshots y rechaza reutilizar una clave para otro contexto. Su cola/comparación no publica en el motor principal. Las funciones de curvas/tablas comprueban su correspondencia física antes de usar cachés. Las entradas de exportación e informe que conocen WellEntry verifican el contexto completo; las APIs puras que solo reciben Well validan la correspondencia de los datos y aceptan un contexto esperado adicional. Una selección de curvas que dejó de existir se rechaza en vez de generar una copia incompleta.

## Recuperación acotada

- Una curva omitida en un delta requiere la misma contentVersion disponible. Cambio de dominio requiere profundidad completa. Datos nuevos con la misma contentVersion no pueden tener bytes distintos.
- Si un delta de entradas es inválido, el servidor responde resync con gen/syncId. El cliente reenvía profundidad, todas las curvas y un pedido con full=true. Un resync duplicado del syncId anterior se ignora.
- Si una respuesta incremental está incompleta/incoherente, el cliente pide full=true una vez, sin publicar ni alterar su caché completa anterior.
- Si la respuesta completa vuelve a fallar, el supervisor reinicia el motor una vez y reenvía el último pozo/pedido. Un nuevo fallo persistente termina en error visible y busy=false; no hay bucle de reinicios. Un pedido explícito posterior puede iniciar otra recuperación.
- La recuperación del protocolo es distinta del presupuesto vigente de caídas de Worker, que conserva su fallback en proceso.

Se copian entradas por el canal, sin transferir sus buffers activos. Las salidas numéricas se copian desde la caché del servidor y solo esas copias se transfieren. La misma implementación serveEngine/client se prueba con MessageChannel y Worker. No se modifica el archivo de proyecto, fórmulas ni el grafo de cálculo en esta entrega.

## Evidencia y trabajo siguiente

Ver docs/validacion/2026-10-30-contexto-motor.md para suite, fallos inyectados en Worker y regresiones. Este paso cierra identidad/publicación/resync P2a. ADR 0035 concreta P2b para artefactos ya evaluados y consumidores. P3 debe agregar el evaluador y la publicación de artefactos antes de habilitar preparación o calibración en la UI.


Actualización P2b (2026-10-30): ADR 0035 concreta la proyección de artefactos ya evaluados, las fuentes preparadas estrictas y la clave separada de laboratorio. El caso identidad mantiene este contrato. Evaluador, recetas persistidas y publicación de artefactos hacia los stores siguen en P3.
