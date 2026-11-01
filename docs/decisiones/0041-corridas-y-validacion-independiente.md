# 0041 — Corridas registradas y diagnóstico independiente de alineación

Estado: implementado en rama de revisión, sobre P3e (#49). No integrado en main.

## Decisión

La pertenencia a una corrida se registra explícitamente en adquisición. No se deduce de mnemónicos; herramienta, lodo y correcciones permanecen desconocidos. Registrar crea una revisión, conserva originales y snapshots y admite deshacer. Las asignaciones deben ser disjuntas y referir a curvas existentes.

Una alineación de corrida construye todas las recetas constantes de P3e antes de publicar nada. Todas comparten desplazamiento, referencia MD, datum y máximo entre anclajes. No acumula desplazamientos. Conserva exclusión/interpolación/filtro y sus identidades. Si una curva falla validación, se rechaza todo. Si hay alternativas del mismo rol se bloquea la activación ambigua; el usuario debe resolver la pertenencia antes de usar el lote. No elige una alternativa arbitraria.

La vista previa usa el runner aislado existente. Aplicar exige artefactos del contexto vigente y cobertura finita en cada integrante. El lote se acepta como un solo Project y una entrada de historial. Retirar alineación de la corrida conserva las demás etapas y también es una operación atómica. Ediciones posteriores por curva siguen siendo explícitas: la pertenencia no impone un enlace dinámico entre recetas.

Se mantiene esquema 4 dentro de v7: adquisición y recetas ya podían representar esta información. No se agregan curvas derivadas persistidas ni un formato nuevo. Los originales y las muestras de laboratorio no se desplazan.

## Correlación diagnóstica

Se compara una curva original con otra de igual rol/unidad. Se evalúan 21 offsets equiespaciados entre -máximo y +máximo (el evaluador admite 3–101). Positivo desplaza el evento más profundo. Se interpola linealmente sobre MD real con máximo de separación, sin atravesar faltantes ni extrapolar. Se muestran todos los candidatos, pares y cobertura por conteo de posiciones destino.

Pearson usa covarianza y varianzas centradas incrementales; exige tres pares y varianzas positivas. Constantes o fallo numérico dan indeterminado, nunca cero inventado. Es correlación de valores lineales; no transforma logaritmos por la escala visual. La separación entre el pico y un competidor no adyacente menor a 0,05 se marca ambigua. Es una heurística declarada de diagnóstico, no un criterio estadístico de identificación geológica. El borde de la búsqueda se señala expresamente.

La ventana de validación no participa de la búsqueda. Se exige separación mayor que dos veces (máximo absoluto de offsets + hueco máximo), de modo que tampoco comparta soporte original desplazado. Solo se evalúa allí el offset elegido por la búsqueda; no se vuelve a optimizar. Se muestran r, cobertura y número de pares. Las ventanas pueden compartir un sesgo geológico o de adquisición: independencia espacial del soporte no equivale a independencia causal.

No se aplica ni se rellena automáticamente un offset. Diagnóstico y parámetros de búsqueda son transitorios; la receta aceptada conserva el desplazamiento manual. La UI declara esta frontera. Los cálculos ceden por bloques y comprueban cambio de entradas. No se habilita deformación variable, alineación de laboratorio ni validación geológica automática.

Referencia: definición de correlación producto-momento de Pearson (1895), *Notes on regression and inheritance in the case of two parents*, Proceedings of the Royal Society of London 58, 240–242. El umbral de ambigüedad anterior es propio de esta herramienta, no atribuido a esa referencia.

## Cierre funcional P3 y límites

Con P3a–e, esta entrega completa el alcance inicial de limpieza y alineación constante: originales conservados, calidad explícita, preview, corrida atómica, diagnóstico separado, historial y persistencia. La validación y sus límites se detallan en [la evidencia](../validacion/2026-10-31-corridas-drx.md). Métodos adicionales, geometría variable, datos reales de adquisición y correcciones físicas no quedan admitidos por este cierre. La integración de la cadena de PR sigue pendiente.
