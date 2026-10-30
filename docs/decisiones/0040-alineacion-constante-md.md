# 0040 · Alineación constante manual de una curva en MD

Fecha: 2026-10-30. P3e sobre #48; continúa #33. Alcance: una curva completa, sin inferir corridas.

## Transformación y referencia

Convención del masterplan: `z_corregida = z_original + desplazamiento`. Un desplazamiento positivo coloca el evento más profundo. Se aplica a toda la curva después de exclusiones, interpolación opcional y filtro opcional. No se cambia el índice maestro, otras curvas, zonas ni laboratorio. Modificar el valor reemplaza esa etapa; no vuelve a desplazar una salida ya desplazada. Cero se obtiene retirando la etapa, no guardando otra transformación.

La receta `constant-shift@1` guarda desplazamiento en metros, máximo entre anclajes, `referenceId` del índice del mismo pozo, `depthKind:MD` y datum explícito. La UI exige declarar que origen/destino comparten esa referencia MD y datum. Si la adquisición tiene datum conocido, debe coincidir tanto en la revisión de origen como en la activa. Referencia diferente, TVD o datum incompatible se rechazan, sin inventar una conversión.

Si la adquisición tiene datum desconocido, permanece desconocido. El texto del usuario es una **declaración de la receta**, no evidencia nueva de adquisición ni verificación geográfica. La referencia queda restringida al mismo índice/pozo y se fija la revisión original. El binding conserva datums observados de origen/destino por separado; sus cambios invalidan la versión derivada. No hay trayectoria ni conversión MD/TVD, tampoco correlación o recomendación automática de desplazamiento.

La entrega no aplica un cambio conjunto a una corrida inferida. El agrupado/activación atómica por corrida registrada requiere su interfaz e inventario de adquisición; sigue pendiente. Tampoco admite varios tramos con desplazamientos diferentes, juntas, anclas ni deformaciones variables. El desplazamiento global tiene pendiente uno; se verifica además que el eje representado siga siendo finito y estrictamente creciente, rechazando colapsos por redondeo/desbordamientos.

## Remuestreo al índice maestro

Para cada profundidad destino se busca su soporte sobre el eje `z_original+delta`, con dos punteros monótonos. Una coincidencia copia el dato y calidad de origen. Entre muestras adyacentes finitas, se interpola en valores lineales (también para resistividad en escala visual log), usando la distancia real en MD. Referencia numérica: interpolación lineal por tramos, como ADR 0038/Burden, Faires y Burden, *Numerical Analysis*, 10.ª edición, capítulo 3. No valida la pertinencia geológica del ajuste.

Se reconoce coincidencia numérica dentro de `8*EPSILON*max(abs(z_desplazada),abs(z_destino))`, limitada además a un cuarto de las separaciones vecinas, para no convertir un paso decimal representado con distinto redondeo en una estimación o borde perdido. No es una tolerancia física configurable; forma parte del método. No puede seleccionar dos vecinos a la vez. Las pruebas cubren pasos decimales reales del TP y grilla irregular. No se promete exactitud física superior a la representación numérica del índice.

El máximo de hueco sólo limita la estimación entre anclajes desplazados; una medición coincidente no requiere vecinos. No se extrapola. Una muestra de origen NaN o excluida se traslada como tal; no se interpola a través de ella. Si ya fue estimada explícitamente por una etapa anterior puede contribuir, conservando sus flags. Las fronteras de las zonas **destino**, en (a,b], bloquean la estimación entre anclajes; no bloquean copiar una observación desplazada coincidente. Las etapas anteriores siguen usando zonas y tramos de MD **de origen**.

Los valores fuera del alcance desplazado, huecos demasiado grandes, cruces zonales o soportes no finitos permanecen NaN. No se usa el valor original del índice destino como respaldo. El máximo de esta etapa y el de relleno de NaN de la etapa previa son decisiones diferentes. No se añaden filas ni se desplazan puntos de laboratorio por el desplazamiento de una curva.

## Calidad y conteos

Todas las filas de la salida alineada tienen Shifted (32). Una copia coincidente hereda la calidad del soporte original. Una estimación entre dos muestras hereda la unión de sus flags y agrega Interpolated (8). No se interpolan números de bitmask.

OriginallyMissing (1) y Excluded (2) describen el **soporte de origen**, no la curva cruda en esa fila destino. Filtered (16) e Interpolated (8) también se heredan; Interpolated puede indicar estimación en una etapa anterior o en el remuestreo actual. No se presenta una coincidencia como medición adquirida en su nueva posición: Shifted siempre permanece.

NaN coincidente conserva 33/34/35 (faltante/exclusión de origen + Shifted). Ausencia de soporte agrega OutOfDomain (128): 160 fuera del alcance, o 160 unido a flags de los soportes candidatos si falla la estimación. Nunca hay valor finito con Excluded/OutOfDomain ni infinito publicado. No se agrega Corrected: alinear no certifica una corrección ambiental.

El payload conserva dos conteos de la entrada anterior a alinear (muestras interpoladas y filtradas) para que la UI/informe no confundan soportes repetidos en destino con centros originales únicos. Se validan y viajan con la publicación completa; no se persisten como resultados. Los conteos de salida separan finitas, soporte estimado, sin soporte y faltantes trasladados. Comparación, informe y exportación declaran contexto, signo, datum/referencia, máximo y semántica de flags. El informe conserva además parámetros de las etapas anteriores en MD de origen.

## Modelo, recursos y ciclo de vida

Las recetas con alineación usan **schemaVersion:4 de preparación**, en el mismo archivo v7. Las recetas sin alineación conservan esquemas 1/2/3 y sus claves. El id de salida primaria se mantiene. Retirar alineación conserva las otras etapas; editarlas o retirarlas conserva alineación, salvo restaurar toda la receta al original explícito. Un no-op conserva Project y no duplica desplazamiento. Lectores anteriores rechazan esquema 4 en lugar de perder decisiones.

El evaluador reserva resultado y un solo scratch f64/u16 de 10 bytes por muestra, reutilizado secuencialmente por filtro y alineación. No necesita un eje desplazado completo adicional. Presupuesto/LRU por buffers, cancelación por bloques y validación del paquete completo mantienen los contratos previos. El presupuesto no limita todo el proceso, originales, transferencia, vistas activas ni demora de GC.

Preview aislado y declaración de referencia antes de aceptar; cero cobertura finita bloquea Aplicar en la UI. Cambiar proyecto, curva, parámetros o declaración invalida la propuesta. Migración optativa v7, receta y fuente se aceptan en un undo/redo. Sólo originales/decisiones se guardan; reabrir y restaurar snapshots remuestrean otra vez. Los emparejamientos/evidencias de laboratorio dependientes cambian de clave; las profundidades de laboratorio permanecen intactas.

Cuando la curva ya está alineada, la UI aclara que los tramos de las etapas previas son de MD de origen y que el tramo visible del visor no se convierte automáticamente. No se adivina si el usuario está leyendo la curva original o la preparada.

## Pendiente

Alineación conjunta por corrida, cambios parciales/anclas y métodos de correlación con cobertura/ambigüedad y validación independiente. Continúan puertas de cierre de P3, DRX y correcciones físicas. Esta entrega manual por curva no cierra toda P3 ni #31/#32/#34. No se integra ningún PR previo.
