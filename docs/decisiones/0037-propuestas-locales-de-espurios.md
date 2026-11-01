# 0037 · Propuestas locales de espurios, sin exclusión automática

Fecha: 2026-10-30. Continúa P3a (#45) y el masterplan #33.

La siguiente entrega de P3 agrega diagnóstico asistido al editor de preparación. Una desviación local no prueba un error instrumental: capas delgadas, transiciones y señales reales también pueden aparecer como candidatos. La aplicación exige revisar y seleccionar cada muestra y después previsualizar la exclusión antes de aceptarla.

## Método v1 y dominio

Se consideran los tres vecinos finitos de cada lado del centro, excluyendo el propio centro. Se calcula su mediana, la mediana de las seis desviaciones absolutas (MAD) y el umbral `max(piso, 3 × 1,4826 × MAD)`. Sólo una diferencia absoluta estrictamente mayor produce un candidato. El piso positivo es explícito en unidades de la curva; evita convertir cualquier pequeña variación en espurio cuando MAD vale cero. La separación máxima MD también es positiva y explícita. No se infieren límites físicos universales ni se recomiendan parámetros por herramienta.

Es un diagnóstico inspirado en la identificación robusta por mediana/MAD (Hampel et al., *Robust Statistics: The Approach Based on Influence Functions*, Wiley, 1986), con esta ventana y exclusión del centro definidas por nuestro contrato. No es una implementación de un filtro Hampel que sustituya muestras, ni se atribuye una tasa de falsos positivos a la constante 1,4826 en registros correlacionados.

La ventana completa debe estar dentro del tramo pedido. Faltantes, exclusiones ya activas y separaciones MD mayores que el máximo cortan la ventana. Los tres extremos de cada segmento no se evalúan. El método usa vecinos por número de muestras y un máximo de separación; no usa una ventana física simétrica ni remuestrea grillas irregulares. No detecta todos los tipos de anomalías ni resuelve grupos de espurios/mesetas. Se muestran valor, mediana y umbral para evaluar cada candidato.

## Ciclo de vida

La búsqueda usa originales y omite ventanas que cruzan máscaras activas. Es asíncrona, cede cada 4096 muestras y se cancela al cerrar o cambiar pozo/proyecto/parámetros. Retiene como máximo 256 candidatos. Al encontrar otro se informa truncamiento y se bloquea el preview hasta acotar el tramo o ajustar los límites; no se permite aceptar un prefijo silencioso.

No hay selección por defecto ni botón de exclusión total. El usuario elige muestras individuales. El lote crea intervalos MD cerrados de ancho cero con identidad propia usando la máscara v1. Mantiene límites existentes (256 intervalos por curva), originales, filas, calidad y fuentes. Aceptar publica migración optativa v7, todas las exclusiones y selección de fuente como un solo undo/redo. Un error del lote no publica una parte.

El diagnóstico, selección y parámetros de búsqueda son temporales. La UI explica que se persisten decisiones manuales, no una receta reproducible de detección ni un indicador Suspect duradero. Guardar/reabrir reproduce exactamente las exclusiones aceptadas y permite restaurarlas por separado. No se cambia formato, worker petrofísico, protocolo ni flags: una exclusión elegida sigue siendo Excluded, nunca una corrección certificada. Un futuro detector persistible necesita esquema, procedencia y contrato propios.

Cualquier cambio de parámetros, selección o proyecto invalida la propuesta antes de aceptar. El preview usa el runner aislado P3a; no actualiza Project hasta Aplicar. Cancelar conserva v6 y el proyecto original.

## Pendiente

Filtros, interpolación, alineación y diagnóstico reproducible con evidencia persistida requieren métodos y validación propios. Esta entrega no cierra P3 completa ni #31/#32. No integra los PRs anteriores.
