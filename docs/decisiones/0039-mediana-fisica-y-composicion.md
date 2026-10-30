# 0039 · Mediana física y composición explícita de preparación

Fecha: 2026-10-30. P3d sobre #47; continúa el masterplan #33.

## Método admitido

`median-filter@1` define una mediana móvil en una ventana MD simétrica de radio positivo, sobre **valores lineales**, independientemente de la escala del visor. La ventana incluye muestras cuya profundidad está entre centro-radio y centro+radio, con extremos incluidos. La mediana de soporte par es la semisuma de los dos valores centrales. No es una mediana en log, media móvil, filtro ponderado por espesor, despike automático ni corrección de herramienta.

La mediana móvil es una técnica robusta clásica (Tukey, *Exploratory Data Analysis*, Addison-Wesley, 1977). Aquí su soporte y dominio se fijan por contrato y casos independientes; esa referencia no valida que suavizar una capa o una herramienta concreta sea apropiado. Puede eliminar señales geológicas reales. La ventana física no implica ponderación espacial: una grilla irregular aporta una observación por muestra y su densidad puede influir en la mediana.

La etapa trabaja sobre una **copia fija** de la entrada; un resultado filtrado no realimenta ventanas siguientes. El ordenado deslizante usa inserción/remoción por búsqueda binaria, con hasta **255 muestras por ventana**. Superar ese soporte invalida el artefacto entero y muestra un error para reducir el radio; no se trunca el soporte ni se devuelve un prefijo.

## Bordes, huecos y barreras

Se requiere al menos tres muestras y un vecino de cada lado. La ventana física completa debe quedar dentro del tramo elegido y del segmento continuo válido; no se reduce la ventana en los bordes. Donde no hay soporte se conserva exactamente la entrada de esta etapa, sin agregar Filtered. Esto también vale en tramos cortos y ventanas con pocos vecinos.

NaN, exclusiones, fronteras de zona y diferencias MD entre muestras mayores que `maxStepM` cortan segmentos. Cada tope/base de cualquier zona actúa como barrera en (a,b], igual que ADR 0038, incluso con zonas solapadas. No hay opción implícita para atravesarlas. Radio y separación máxima son positivos, finitos y explícitos. Los límites se comparan con el MD almacenado, sin remuestrear ni agregar una tolerancia física adicional.

El filtro nunca rellena NaN ni extrapola. Sólo admite los mismos roles incorporados de perfiles medidos (o de origen any) y unidades compatibles de ADR 0038; bloquea banderas, categorías, roles computados y curvas sin significado reconocido. Asignar correctamente el rol sigue siendo necesario.

## Orden y modelo persistido

Una receta por curva y revisión conserva la salida primaria `prep:<id>:masked`, sufijo interno histórico. El orden fijo es:

1. Exclusiones manuales.
2. Interpolación lineal acotada, **si el usuario la aceptó explícitamente**.
3. Mediana física.

Agregar un filtro no activa interpolación ni rellena exclusiones. Si ya existe interpolación aceptada, sus muestras finitas pueden aportar al filtro y su influencia se conserva en calidad. Cambiar la interpolación conserva el filtro; quitar interpolación vuelve a filtrar la entrada con huecos originales. Quitar filtro conserva interpolación y/o exclusiones. Restaurar original quita la receta completa y vuelve explícitamente a su fuente original. No hay reordenado ni composición arbitraria de métodos en esta entrega.

Las recetas con filtro usan **schemaVersion:3 de preparación**, dentro del contenedor v7. `median-filter@1` tiene configuración `{top,base,radiusM,maxStepM}`, las exclusiones previas y un `gapFill` opcional tipado. Versiones anteriores se conservan exactamente para recetas sin filtro: máscaras 1, interpolación 2. Retirar etapas vuelve al esquema mínimo necesario, sin cambiar ids silenciosamente. Lectores anteriores rechazan recetas 3 en lugar de perder decisiones. Snapshots fijan receta y entradas; las zonas de interpretación se persisten junto con ellas.

Radio, separación, tramo, métodos, exclusiones y fronteras zonales forman parte de la versión derivada/contexto. Cambiar cualquiera invalida arrays y resultados dependientes; un no-op conserva el estado. Se conserva la ascendencia de herramientas del original y el ledger físico vacío: filtrar no corrige efectos ambientales.

## Calidad

Los flags combinan historia de la muestra central y procedencia de su soporte:

| QC | Significado |
|---|---|
| 0 | Entrada conservada, sin filtro aplicado. |
| 1 | Faltante original no estimado. |
| 2 / 3 | Exclusión manual, sobre medición / faltante original. |
| 9 | Faltante original estimado por interpolación, sin filtro aplicado. |
| 16 | Muestra filtrada, sin contribuyentes interpolados. Se marca también si la mediana coincide con su valor anterior. |
| 24 | Centro originalmente finito filtrado con al menos un contribuyente interpolado en su soporte. |
| 25 | Faltante original interpolado y luego filtrado. |

OriginallyMissing describe **el centro original**; no se inventa un faltante original porque un vecino sea estimado. Interpolated se propaga conservadoramente desde todo el soporte, aunque el valor mediano final pudiera coincidir con una medición. No afirma impacto numérico ni incertidumbre cuantificada. Los conteos separan estimaciones de centros originalmente faltantes de centros medidos con soporte interpolado. La copia fija incluye calidad para evitar propagar influencia de forma recursiva.

Comparación, informe y exportación QC distinguen esas clases. Cliente/worker siguen publicando preparación y petrofísica completas bajo el mismo contexto. No se admite un flag combinado desconocido, calidad de faltante con valor finito ni un valor no finito presentado como filtrado. No se interpolan ni promedian los números de las bitmasks.

## Recursos y ciclo de vida

Se reservan **10 bytes por muestra de scratch** (copia fija f64 + u16), además de 10 bytes por muestra por artefacto retenido. El plan y evaluador incluyen una reserva adicional equivalente a un artefacto si existe filtro, antes de asignar arrays. El LRU expulsa versiones no fijadas antes de reservar resultado + scratch; sólo cachea un resultado completo. La memoria auxiliar de ventanas tiene hasta 255 números. Es un presupuesto de buffers del evaluador, no un techo de memoria global: originales, migración, transferencias, vistas en uso y contenedores JS consumen memoria aparte.

Se cede y verifica cancelación por bloques de trabajo de 4096 pasos, tanto al segmentar como al filtrar. El preview usa el runner aislado y no modifica Project ni ejecuta el motor principal. Cero ventanas elegibles bloquea Aplicar. Cambiar controles, curva, tramo o proyecto invalida el preview. Aceptar método, migración optativa y fuente es un undo/redo. Persisten originales y decisiones, nunca blobs filtrados.

## Pendiente

Alineación constante, otros filtros y dominios, reordenado/otros métodos con contratos propios, DRX y correcciones físicas. No se cierra toda P3 ni #31/#32/#34; ningún PR anterior se integra.
