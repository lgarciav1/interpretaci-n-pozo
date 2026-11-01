# 0043 — P4b: configuración, procedencia y evidencia persistentes de comparación DRX

Estado: implementado en rama de revisión sobre #50. No integrado en main. No implementa calibración GR ni cambios de cutoffs.

## Decisión

La comparación aceptada se guarda como JSON versionado en `Interpretation.pointSets[setId].settings['xrd:comparison']`, aprovechando el contrato existente de ajustes por conjunto. Contiene:

- Configuración explícita: id de curva original/preparada, cantidad/base de comparación, soporte máximo, cobertura mínima, desplazamiento diagnóstico adicional y densidades por mineral.
- Densidad en g/cm³, referencia obligatoria y, opcionalmente, incertidumbre absoluta declarada no negativa. No hay densidades por defecto. Los controles conservan el borrador textual y aceptan punto o coma decimal, sin convertir los estados intermedios de escritura en otro valor. La incertidumbre se conserva como información del usuario; no se propaga ni se inventa un intervalo de confianza. Cambiar de ensayo limpia las densidades para evitar trasladarlas por coincidencia de ids de columnas.
- Evidencia: versión del método, revisión de entradas, SHA-256 de entradas y configuración, SHA-256 de resultados, fecha de evaluación, descriptor/unidad de fuente y conteos de filas/utilizables.

Las tablas y arrays derivados no se persisten. Se conserva configuración/evidencia y se recalcula explícitamente para verificarla. Aceptar requiere exactamente el Project sobre el que se calculó: cambiar entradas o decisiones mientras se evalúa impide guardar evidencia obsoleta. Se guarda en una sola receta de historial, sin modificar datos importados, fuentes petrofísicas, parámetros o cutoffs. Undo/redo y snapshots recuperan el registro completo.

## Identidad reproducible

Las claves efímeras del motor se usan para validar el contexto activo, pero no como huella persistente. Las huellas usan contenido: valores de profundidad, curva seleccionada y calidad; contratos/columnas/ids del laboratorio; revisión, preparación, sarta, geometría zonal y decisiones de inclusión/desplazamiento; configuración y procedencia de densidades. Se canonicalizan claves JSON y se codifican números en little endian con NaN canónico. Se reutiliza SHA-256 y su fallback offline existente. Cada buffer se procesa secuencialmente con puntos de cancelación; no se promete un techo global de memoria.

El registro de evidencia se excluye de su propia huella. Decisiones ausentes y decisiones vacías equivalen. La reconstrucción de arrays y contextos tras guardar/abrir no cambia las huellas. Se invalida conservadoramente al cambiar de revisión incluso si la modificación no altera el par. Nombre/presentación del pozo no participa del contenido; cambiar esos metadatos mediante una nueva revisión sí cambia su identidad de revisión.

La metadata homogénea del contrato se resume una sola vez al hashear; no se expande una copia del contrato por cada muestra. Se cachea su validación por PointSet inmutable, evitando la revisión cuadrática de contratos al recorrer filas.

## Estados y compatibilidad

Al abrir/seleccionar un ensayo se muestra «evidencia sin verificar», nunca se presenta una tabla histórica como vigente. Recuperar configuración es explícito. Comparar reconstruye la tabla con el contexto actual: solo se declara evidencia verificada si coinciden ambas huellas. Configuración/entradas/resultados distintos producen un aviso y una tabla nueva recalculada, sin sustituir la evidencia guardada hasta aceptar otra vez.

Un esquema de comparación desconocido/corrupto se informa y se conserva sin reescribir. No se migra silenciosamente a versión 1. Se mantienen v7 y esquema de preparación 4. Lectores anteriores conservan el ajuste genérico pero no ofrecen esta UI ni verifican evidencia. Al ser un diagnóstico sin efecto petrofísico, ignorar su visualización no equivale a recalibrar un proyecto.

Las huellas permiten detectar cambios y verificar reproducción; no certifican autenticidad del informe ni son una firma del laboratorio.

## Exportación

CSV de la tabla completa, no solo las primeras 200 filas visibles: configuración, densidades y referencias/incertidumbres declaradas, evidencia, contrato del ensayo, descriptor/unidad del perfil, ids, profundidades originales/corregidas, contenido de arcillas/cantidad física, lectura del perfil, cobertura, dispersión, calidad, cruce de zona, causas de exclusión y composición/estados originales por mineral. Las profundidades corregidas incluyen desplazamientos ya aceptados por conjunto/corrida y el offset diagnóstico adicional.

Antes de descargar se comprueban huella de entradas actuales, huella de resultados, orden/ids y número de filas. Cambiar proyecto o borrador durante la exportación invalida la descarga. Las cadenas que podrían ejecutarse como fórmulas en una planilla reciben prefijo de texto; los ids originales permanecen intactos en el proyecto.

## Endurecimiento numérico

Un promedio o dispersión no finitos del emparejado se excluyen con motivo explícito, sin serializar Infinity/NaN como un resultado válido. Si un cierre dentro de tolerancia diera contenido nativo de arcillas mayor que uno, se bloquea ese contenido: no se recorta ni renormaliza silenciosamente. No cambia el algoritmo admitido para casos normales.

## Sigue pendiente

Incertidumbres y límites de detección numéricos por muestra/mineral importados del ensayo; validación con DRX real y procedencia externa verificable; refinamientos de escala/campañas. Los archivos siguen siendo homogéneos por conjunto y las distintas bases se separan. No se completa toda P4 ni se habilita P5 por guardar una comparación.
