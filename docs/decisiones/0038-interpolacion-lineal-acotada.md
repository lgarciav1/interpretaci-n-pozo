# 0038 · Interpolación lineal acotada de faltantes originales

Fecha: 2026-10-30. P3c, sobre #46, continúa el masterplan #33.

## Método, dominio y límites

Se entrega una única estimación explícita: interpolación lineal por profundidad MD, en el dominio numérico de la curva. Entre dos mediciones originales finitas `x(a)` y `x(b)`, una muestra faltante en `d` toma `(1-t)*x(a)+t*x(b)`, con `t=(d-a)/(b-a)`. Es interpolación lineal por tramos, como en Burden, Faires y Burden, *Numerical Analysis*, 10.ª edición, capítulo 3. No se propone una ley física ni se cuantifica incertidumbre a partir de esa referencia.

La distancia máxima es **b-a**, incluidos los anclajes, en metros MD; no es el número de NaN ni el espesor de las filas sin dato. Debe ser positiva y explícita. Ambos anclajes deben estar dentro del tramo cerrado elegido. Se usa el MD real, también en grillas irregulares. Las fronteras de todas las zonas detienen el relleno: no se admite ningún tope/base en (a,b]. Un anclaje izquierdo sobre una frontera puede iniciar un hueco de la zona siguiente; el derecho en la frontera pertenece a otro tramo y bloquea. Se aplica conservadoramente también a zonas solapadas y no existe opción para atravesarlas en este método. Los límites de zona se toman de la interpretación persistida, forman parte de la versión del artefacto y moverlos invalida caché/contexto.

No se extrapola, no se cambian mediciones finitas, no se agregan filas y no se modifica el índice maestro. Las estimaciones no se convierten en nuevos anclajes de otros huecos.

La máscara manual se evalúa primero. Una exclusión, incluso sobre un NaN original, **bloquea todo el hueco** delimitado por sus anclajes. No se rellena parcialmente alrededor de un punto excluido ni se revierte la decisión manual. Esta entrega estima sólo faltantes originales; reemplazar un dato finito señalado como espurio o rellenar exclusiones necesita una operación con consentimiento y procedencia propios. Los extremos sin dos anclajes y los huecos más largos siguen sin dato.

La operación interpola valores sin transformación logarítmica, independientemente de la escala visual. Sólo se admiten roles incorporados de perfiles medidos (o de origen any) con unidad dimensionalmente compatible; se rechazan banderas, categorías, roles computados y curvas sin rol reconocido, sin inferir continuidad por contener números. Asignar correctamente el rol es responsabilidad del usuario. No incorpora un método especial para resistividad ni límites por herramienta. La hipótesis local de linealidad puede ocultar capas delgadas, contactos y cambios reales; el usuario debe revisar el preview. No es una corrección ambiental y no modifica el ledger de efectos físicos.

## Modelo y compatibilidad

Se conserva una receta/salida por curva y revisión original, evitando un grafo arbitrario en esta entrega. `linear-interpolation@1` contiene la referencia explícita al original, sus exclusiones con identidad propia y `gapFill={top,base,maxGapM}`. El orden es fijo: exclusión → estimación de faltantes permitidos. Modificar el límite reemplaza esa etapa, no encadena estimaciones sobre estimaciones.

Las máscaras existentes conservan exactamente sus contratos, claves y `schemaVersion:1`. Sólo una receta que contiene interpolación usa **schemaVersion:2 de preparación**. No cambia el contenedor de archivo v7. Los lectores anteriores rechazan esa receta por su esquema desconocido; no se promete apertura hacia atrás de proyectos nuevos con interpolación. Los proyectos viejos, máscaras v1, originales y snapshots previos se siguen leyendo. Un proyecto sin preparación/revisiones conserva v6.

Se conserva el id de salida de la receta (`prep:<id>:masked`, sufijo histórico interno) al agregar/quitar interpolación: fuentes y comparaciones no cambian de identidad silenciosamente. Sí cambian versión de contenido, clave de preparación y contexto científico según límites/método/exclusiones. Preparación, petrofísica, snapshots, exportación e informes consumen la misma proyección y rechazan mezclas de versiones.

`Quitar interpolación` conserva las exclusiones y devuelve esa receta a máscara v1. Restaurar una exclusión conserva la interpolación; si se quita una barrera puede habilitar otra vez la estimación del hueco. `Restaurar original` quita la receta completa y vuelve explícitamente a la curva original. Si hay otras curvas interpoladas, el estado global permanece en esquema 2. Los snapshots pueden conservar recetas 2 aunque la receta activa ya haya vuelto a 1 o desaparecido.

## Calidad y publicación

Las muestras finitas conservadas llevan 0; los faltantes originales 1; las exclusiones 2/3. Una estimación lleva **9 = OriginallyMissing (1) | Interpolated (8)**: conserva la evidencia de que no había medición. No se publica 8 aislado, una estimación marcada como exclusión ni un valor finito con calidad de faltante. El cliente valida calidad y finitud antes de publicar el paquete completo. El evaluador trabaja sólo sobre copias derivadas, con LRU de 128 MiB por arrays y cancelación por bloques también durante el rellenado. No hay arrays temporales del tamaño del pozo para interpolar. El presupuesto no es un techo global del proceso.

Preview aislado, método, migración optativa v7 y fuente siguen el circuito P3a. No se acepta una interpolación con cero muestras elegibles desde la UI; se informa la causa y se mantienen proyecto/migración intactos. Cambiar tramo, curva, límite o proyecto invalida el preview. Aplicar es un solo undo/redo. Guardar/reabrir y restaurar snapshots evalúan otra vez originales + decisiones; no se guardan arrays ni blobs estimados.

La comparación muestra `Estimada · interpolada`; el resumen separa estimaciones y exclusiones. La exportación agrega el significado de QC 9 y el informe declara método, tramo, máximo y cantidad estimada. El QC de entrada sigue describiendo originales. Los gráficos con referencia por id al original mantienen ese original; la fuente de interpretación elegida usa la preparada.

## Pendiente

Filtros, reemplazo explícito de exclusiones/espurios, alineación, modelos por herramienta, DRX y correcciones físicas. No se cierra toda P3 ni #31/#32/#34. Esta entrega no integra PRs previos.
