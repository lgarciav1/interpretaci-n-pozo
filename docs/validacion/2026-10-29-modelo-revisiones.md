# P1a: modelo de revisiones de entradas, aislado

Fecha: 2026-10-29. Base: PR #39, 61892056f1842e8d894fa0b3275131229d617ffa. Continúa el masterplan #33 y el ADR 0033. Ningún PR se integra ni mergea.

## Alcance implementado

Se agrega `src/core/inputs/` con un almacén puro de revisiones independiente de Project, del motor y de la UI. No se agrega al barril del núcleo ni se importa desde producción. La aplicación conserva su formato v6 y no usa todavía este almacén.

| API | Función |
|---|---|
| emptyInputRevisions | Estado vacío con mapas protegidos frente a claves de prototipo |
| addInitialInputRevision | Captura un Well y adquisición, crea una raíz por pozo y la activa en el modelo aislado |
| reviseInputRevision | Valida entradas nuevas, crea hija y cambia su revisión activa en una sola devolución |
| getActiveInputRevision | Resuelve la revisión del pozo; no inventa respaldos si está rota o falta |
| copyInputWellForEdit | Entrega una copia editable con buffers separados |
| validateInputRevisionState | Comprueba esquema, entradas, padres, raíces, ciclos y referencias activas en memoria |
| unknownAcquisition / validateAcquisition | Expresa desconocidos y valida declaraciones sin ejecutar correcciones |
| inputRevisionIdFromBytes | Formatea 16 bytes externos como input- + 32 dígitos hexadecimales |

La captura inicial copia buffers, listas y metadatos externos. Al crear una hija, los arrays con los mismos bytes que los del padre se comparten; los modificados se copian. Se compara contenido binario, no igualdad numérica: se preservan NaN y sus payloads, ceros con signo, infinitos y subarrays. Cambiar descripción, rol, unidad o adquisición no duplica datos numéricos sin cambios. Reordenar curvas conserva arrays por id.

Los metadatos y contenedores publicados están congelados. Los elementos de Float64Array siguen siendo inmutables por contrato, como en Well: una escritura directa que eluda copyInputWellForEdit puede mutarlos y queda fuera de las APIs admitidas. La validación estructural de un estado suministrado manualmente no adquiere propiedad de sus buffers. No se promete protección frente a scripts externos que eludan esas fronteras.

Un no-op por contenido devuelve el mismo estado, sin publicar un id nuevo. Id y fecha son argumentos explícitos para mantener operaciones determinísticas; un sello no utilizado no se valida. La generación aleatoria y su fallback, la conexión a Project y la persistencia siguen pendientes. No se añadió otra fuente de azar ni un reloj implícito.

## Rechazos antes de publicar

- Índice no finito, no creciente, fuera de metros o con paso inconsistente; curvas desalineadas/duplicadas y metadatos de forma inválida.
- Laboratorio con columnas desalineadas, ids duplicados o profundidad desordenada. Se admiten mediciones repetidas a la misma cota.
- Curvas de corrida inexistentes o duplicadas; adquisición con esquema no admitido, referencias faltantes o estado de corrección contradictorio.
- Lodo con valores no finitos, salinidad negativa, resistividad no positiva o temperatura bajo el límite admitido.
- Id de revisión duplicado/mal formado, padre ausente/de otro pozo, ciclos, dos raíces por pozo o referencia activa inconsistente.
- Campos no reconocidos en el esquema actual, getters, listas con huecos y buffers compartidos/desconectados. Las entradas no se ordenan, recortan ni reparan silenciosamente.

Las unidades/roles no vacíos desconocidos se conservan, como permite el modelo existente; no se validan ni habilitan físicamente por eso. Los efectos declarados tampoco ejecutan una corrección. Datum, fabricante/modelo y propiedades desconocidas del lodo permanecen null.

## Verificación

El archivo focalizado contiene **64 pruebas**: propiedad de datos, ausencia de mutaciones, compartición, no-op, metadata, laboratorio, integridad y rechazos. Incluye captura del TP completo y del demo producidos por la aplicación, además de los seis fixtures v1–v6 con comparación de cálculo/fuentes y serialización vigente.

Resultado final: **2.515 pruebas aprobadas en 149 archivos**, sin fallos ni omisiones; incluye las 64 pruebas del módulo. Typecheck, build y diff check aprobados. El build previo y el candidato mantienen 5.415.233 bytes y SHA-256 `feff041b73ab6c9f06c233ba4545cac992a49fc546f78b75536e49ca035999ef`. Al estar el módulo sin importar, la aplicación distribuida conserva exactamente su HTML; no se requiere un recorrido visual nuevo sobre bytes idénticos.

Reproducir:

~~~sh
npm test -- tests/inputs/revisions.test.ts --maxWorkers=1
npm run typecheck
npm test -- --maxWorkers=1
npm run build
~~~

La validación actual recorre el almacén completo y sus datos. No se midió todavía su costo sobre historiales extensos; debe perfilarse antes de activar la integración. Esta entrega no modifica la persistencia ni sus métricas base.

## Próximo paso y límites

Esta es P1a, no P1 completa. Faltan integrar revisiones y alias de Well en Project, fijar/restaurar snapshots con sus datos, resolver su revisión en el runner aislado, generación de ids y la persistencia/migración v7 con blobs e integridad. No habilita edición/preparación de datos en la UI, limpieza, calibración DRX ni correcciones ambientales.

La próxima entrega debe conectar snapshots/Project con pruebas de importar o reemplazar laboratorio después de crear un snapshot y recuperar exactamente su revisión. La migración antigua declarará el límite de los snapshots v1–v6, sin inventar datos históricos. Se conserva el pedido de avanzar con PRs encadenados y sin merges.
