# ADR 0033: revisiones de entradas y compatibilidad

Fecha: 2026-10-28. Estado: contrato P1/P2, con caracterización ejecutable de v1–v6 y primera implementación aislada P1a (ver avance al final). Referencias: masterplan #33, preparación #32 y DRX #31. Base de código: PR #38, eecad95a60b389c7ff4e847a2bbdffd397bbc763. La entrega original #39 no implementó la migración ni modificó la aplicación. P1a agrega un módulo aislado, todavía sin conectarlo a Project o al formato de archivo.

## Problema concreto

Un snapshot actual conserva Interpretation, incluidas decisiones de MDT/corona y sarta, pero restoreSnapshot no recupera los Well.pointSets o curvas que existían al crearlo. Una importación posterior puede cambiar las entradas sobre las que se recalcula. Para preparación y DRX necesitamos identificar las entradas de cada interpretación y restaurarlas juntas.

La versión vigente sigue siendo 6 en la rama base y en main al revisar esta decisión. v7 es la versión prevista; antes de implementarla hay que volver a comprobar que ninguna rama la haya ocupado. La existencia de este documento no hace que la aplicación lea v7.

## D1. Unidad de revisión y propiedad de los datos

Una revisión contiene el Well completo y los metadatos de adquisición, incluido el laboratorio medido. Cambiar curvas, roles, unidades, mnemónicos, origen, índice, encabezado, conjuntos de puntos o adquisición crea una revisión. Cambiar un parámetro, exclusión, desplazamiento de laboratorio o receta modifica Interpretation.

Contratos conceptuales de memoria; se implementarán y validarán en P1:

~~~ts
type InputRevisionId = string;
interface InputRevision {
  id: InputRevisionId;
  wellId: string;
  parentRevisionId?: InputRevisionId;
  schemaVersion: 1;
  createdAt: string;
  reason: 'import' | 'edit-input' | 'legacy-migration';
  well: Well;
  acquisition: AcquisitionMetadata;
}
interface AcquisitionMetadata {
  schemaVersion: 1;
  depth: { kind: 'MD'; datum: string | null };
  runs: AcquisitionRun[];
}
interface AcquisitionRun {
  id: string;
  curveIds: string[];
  tool: { catalogId: string | null; vendor: string | null; model: string | null };
  corrections: { status: 'unknown' | 'declared'; effects: AcquisitionEffect[] };
  mud: { salinityPpmNaClEquivalent: number | null; resistivityOhmM: number | null; temperatureC: number | null };
}
interface AcquisitionEffect {
  effect: string;
  method: string;
  version: string | null;
  reference: string;
}
~~~

Los tipos de AcquisitionEffect se restringirán al catálogo versionado de efectos de P6; no ejecutan fórmulas. Valores desconocidos se conservan como evidencia no ejecutable. Una declaración necesita referencia de procedencia; un valor null significa desconocido, no cero. La salinidad y resistividad no se convierten entre sí sin método y temperatura explícitos. No inferir fabricante/modelo, datum o correcciones aplicadas desde el mnemónico. P1 admite metadatos desconocidos y no exige inventarlos.

Project agrega inputRevisions por id; WellEntry agrega inputRevisionId y mantiene well como alias de lectura. Se exige `entry.well === inputRevisions[id].well` y coincidencia de wellId. El archivo tiene una única representación del Well por revisión; no guarda una segunda copia editable en la entrada activa.

Ids de revisión únicos en el proyecto, opacos y persistentes: prefijo + 128 bits aleatorios. El generador necesita fallback probado si crypto no está disponible en file:// y comprobación de colisión con reintento acotado. No usar fecha o identidad de objeto como única fuente de identidad. Los ids de curvas y PointSet siguen siendo locales al pozo; todas sus referencias se resuelven con revisión/pozo.

Las revisiones comparten arrays que no cambiaron. Un editor recibe una copia para modificar y la receta reemplaza el array; nunca escribe sobre el original ni transfiere su buffer. Readonly de TypeScript no vuelve inmutable un Float64Array: las pruebas de propiedad de buffers y las fronteras de edición deben comprobar esta regla. No prometer protección frente a scripts externos que muten memoria por fuera de las APIs.

## D2. Operaciones atómicas

P1 implementará recetas puras:

- Crear la revisión inicial para un Well y adquisición desconocida.
- Crear una revisión hija con nuevos datos, validar y activar revisión + alias well en un solo proyecto nuevo.
- Crear un snapshot fijando inputRevisionId y una copia de Interpretation.
- Restaurar snapshot resolviendo revisión y devolviendo revisión + well + interpretación juntos. Display y progreso permanecen fuera de la restauración.

Errores de esquema, referencia, longitud, id duplicado o parentesco no publican cambios parciales. No-op conserva la referencia del proyecto y no genera id/revisión. La función de edición recibe el Well actual de la revisión activa, no una salida preparada. Una importación no modifica las revisiones ya referenciadas.

Comparar un snapshot resuelve su propia revisión, sin cambiar el pozo activo. El runner aislado y sus claves de caché incluirán la revisión. Undo/redo restaura el proyecto completo por identidad; P1 no introduce una segunda pila de historial.

P1 conserva todas las revisiones: no incluye recolección automática. Una limpieza futura deberá demostrar alcanzabilidad desde entradas, snapshots y los proyectos retenidos en past/future; no basta inspeccionar el proyecto activo. No se elimina evidencia para reducir el archivo silenciosamente.

## D3. Archivo v7 previsto

~~~text
format: pozo-proyecto
version: 7
savedAt
project:
  name, activeWellId, display
  wells: [{ wellId, inputRevisionId, interpretation, progress }]
  snapshots: [{ id, name, wellId, createdAt, inputRevisionId,
                inputBinding, interpretation }]
  inputRevisions: { [id]: { id, wellId, parentRevisionId?, schemaVersion,
                           createdAt, reason, acquisition, well } }
  blobs: { [blobId]: { scalarType: f64, endian: little,
                      length, byteLength, codec, sha256, data } }
~~~

well mantiene id, name, header, depth, curvas y PointSet con sus metadatos; cada array se representa por `{ blobId }`. Las columnas numéricas de PointSet conservan unidad y blob; las de texto conservan texto. El paso de profundidad es derivado y se valida/recalcula igual que hoy. No introducir arrays preparados o resultados en well.curves.

blobId = `sha256:<hex>` sobre bytes **decodificados** Float64 little-endian. length es número de elementos y byteLength debe ser length × 8. Deduplicación por esos bytes; roles, unidades, origen y nombres viven en sus descriptores, no en el blob. Codificar distinto no crea otra identidad. Se conservan NaN, ceros con signo y valores especiales bit a bit; no canonicalizar, redondear ni convertir unidades para deduplicar. Los lectores comparten buffers solo bajo el contrato de D1.

Usar los codecs existentes. La implementación de hash debe funcionar offline y disponer de fallback probado si SubtleCrypto no existe; no agregar una dependencia de servicio ni esperar que HTTPS esté disponible. Calcular integridad fuera del hilo de UI para datasets grandes, con tareas limitadas; el id de revisión identifica la revisión, el hash identifica bytes. No recalcular hashes en cada movimiento de cursor.

El lector verifica ids, wellId, padres existentes del mismo pozo, ausencia de ciclos, referencias, dimensiones y hashes antes de habilitar una revisión. Una revisión dañada no ejecuta cálculos; otras revisiones independientes pueden recuperarse con diagnóstico. Una entrada o snapshot inválidos no se reasignan a otra revisión como respaldo. Conservar el archivo original para recuperación. Una versión de archivo futura se rechaza; un esquema interno desconocido no se ejecuta ni se borra como si fuera vacío.

Presupuestos iniciales para el lector P1: archivo UTF-8 hasta 64 MiB, total decodificado único hasta 512 MiB y array individual hasta 128 MiB. Validar longitudes enteras no negativas y multiplicaciones seguras antes de asignar; contar un blob compartido una sola vez. Descompresión incremental con límite real de salida, no solo el declarado. Rechazo temprano con mensaje de límite; no truncar ni descartar datos para entrar. P1 debe medir y ajustar estos límites explícitamente si el equipo objetivo lo requiere; no son garantías de memoria libre.

## D4. Migración v1–v6

1. Ejecutar las migraciones vigentes en un objeto separado, conservando avisos de saneamiento. No sobrescribir el texto de entrada.
2. Crear una revisión por Well disponible, con adquisición desconocida; no cambiar arrays, unidades, roles, origen, profundidad o fuentes elegidas.
3. Fijar cada entrada a esa revisión. Asociar cada snapshot antiguo a la revisión disponible de su wellId.
4. Guardar `inputBinding: 'legacy-current-inputs'` en esos snapshots y mostrar un aviso: el archivo antiguo no conservaba entradas históricas. Snapshots creados en v7 usan `inputBinding: 'pinned'`.
5. Preparación ausente equivale a vacía. No cambiar la prioridad de VSH/PHIE/SW importados. No aplicar recetas ni recalibrar al abrir.
6. Guardar en un archivo nuevo v7. No ofrecer guardar íntegramente como v6 si hay revisiones o decisiones sin representación.

No se puede reconstruir el laboratorio o las curvas de un snapshot antiguo si ya fueron reemplazados antes de guardar. La migración hace explícito ese límite; no promete recuperar información que el archivo nunca guardó. Los snapshots cuyo wellId no existe requieren diagnóstico, sin asociación inventada.

## D5. Contexto y protocolo para P2

P1 no modifica el protocolo del motor. P2 añade un sobre de contexto: `{ wellId, inputRevisionId, depthKey, preparationKey, engineKey }`. La calibración lleva su calibrationKey separada (laboratorio, decisiones, emparejado y base composicional). gen/seq siguen identificando generación y pedido de transporte; no reemplazan identidad científica.

WireCurve se ampliará con `{ origin, contentVersion, depthKey, ancestorToolIds, qualityKey? }`, conservando id, mnemonic, role, unit y data incremental. origin discrimina original/prepared; no se inventa un moduleId petrofísico. toEngineWell consume la proyección efectiva validada; no inserta salidas en el almacén original. Cada resultado/client cache/export debe validar el contexto completo.

Sin preparación, el contexto identidad entrega los mismos arrays/fuentes que el flujo actual. Una fuente prep explícita no disponible bloquea sus consumidores; no cae silenciosamente a una medida u otro método. El planificador compartido gobierna motor, visor, plots y exportaciones. Conjuntos de laboratorio sin consumidores no invalidan petrofísica, pero sí pares/propuestas DRX que dependan de ellos.

Publicación atómica de contexto + salidas, copias de buffers de transferencia, rechazo de respuestas atrasadas y resync acotado: delta inválido → pedir completo una vez → reiniciar supervisor una vez → error visible. P2 debe concretar mensajes de resync y pruebas de worker/en proceso antes de conectar preparación. Una tarea aislada de preview/comparación no contamina el motor activo.

## D6. Matriz de aceptación y evidencia disponible

| Caso | Evidencia de esta entrega | Puerta futura |
|---|---|---|
| Abrir v1–v6 | Corpus fijo de seis reconstrucciones sintéticas; bytes y semántica comprobados | P1 migra el mismo corpus a revisiones sin pérdida |
| Tres codecs | Reabrir y reserializar conservan bytes y proyecto normalizado | Blobs v7 verifican integridad y deduplicación |
| Fuente importada VSH | Se comprueba fuente activa y resultados antes/después | Contexto identidad conserva prioridad |
| Snapshot sin cambiar entradas | Parámetros restaurados; display/progreso/datos conservados | Snapshot v7 restaura además su revisión |
| Laboratorio importado tras snapshot | Límite actual documentado por inspección de Snapshot/restoreSnapshot | P1: restaurar y comparar usan datos anteriores, incluso tras guardar/abrir |
| Metadata/curvas | Edición conserva arrays y otro pozo | P1: revisión hija, padre intacto, undo/redo y no-op |
| Corrupción/versión futura | Versión futura rechazada en el corpus | P1: referencias, ciclos, hashes y límites de descompresión |
| Resultados atrasados | Contrato vigente gen/seq inspeccionado | P2: misma prueba con contexto/revisión y resync |

El corpus no contiene proyectos históricos reales. Su hash detecta modificaciones accidentales, pero no sustituye revisión humana de su semántica. Al recibir archivos reales se incorporarán como casos adicionales con autorización y anonimización adecuadas, sin borrar estos casos pequeños.

Para una implementación P1 sin preparación, comparar contra la rama base en el mismo entorno: medianas de guardar/abrir/cálculo ≤ 1,25× base y sin aumento del almacenamiento binario único por compartir revisiones sin cambios; cualquier exceso requiere explicar y revisar antes de integrar. Una sola medición no prueba regresión: repetir base/candidato alternados con calentamiento, sin otra suite compitiendo. No bajar umbrales científicos para pasar. Los objetivos de interacción en navegador del masterplan siguen pendientes de medición específica.

## Siguiente PR acotado

P1: modelo de revisiones, recetas y snapshots fijados, archivo y validación v7, migración de este corpus y runner aislado que resuelva la revisión correcta. Revisión de compatibilidad con guardar/abrir, undo/redo, MDT/corona, fuentes, datos y exportaciones. No agregar limpieza ni calibración en ese mismo cambio. Los tipos y campos de este documento son un contrato a implementar, no APIs disponibles.


## Avance P1a: modelo y operaciones aislados (2026-10-29)

`src/core/inputs/` implementa InputRevision, adquisición declarada y un InputRevisionState independiente de Project. Este almacén temporal conserva revisiones por id y la revisión activa de cada pozo; no es la forma del archivo v7 ni una segunda pila de historial de la aplicación.

APIs implementadas: emptyInputRevisions, addInitialInputRevision, getActiveInputRevision, copyInputWellForEdit, reviseInputRevision, validateInputRevisionState, unknownAcquisition y validateAcquisition. inputRevisionIdFromBytes formatea 16 bytes suministrados por el llamador; no obtiene entropía ni lee el reloj. Las recetas reciben id y fecha ISO UTC con milisegundos. La generación aleatoria/fallback de D1 queda pendiente de la integración, sin introducir ahora un generador distinto del acordado.

La captura inicial copia arrays y estructuras externos; la hija conserva los arrays de su padre que tienen los mismos bytes y copia los que cambiaron. Se conservan subarrays, NaN y sus payloads, ±Infinity y ceros con signo. Los metadatos y contenedores se congelan. Un no-op por contenido mantiene el mismo estado y no publica el sello suministrado. Las fechas/ids de un sello no utilizado no se validan porque no crean una revisión.

El llamador debe usar copyInputWellForEdit para modificar datos. Los Float64Array publicados siguen siendo de lectura por contrato, igual que los Well existentes: ni TypeScript ni Object.freeze protegen sus elementos. No se ofrece protección contra escrituras directas que eludan la API. No se transfiere ningún buffer del almacén. Los estados suministrados manualmente al validador se comprueban estructuralmente; la validación no adquiere propiedad de sus buffers ni los incorpora automáticamente a un almacén.

Validación estricta, sin reparar datos: índice MD creciente/finito y paso consistente, dimensiones, ids, PointSet ordenados (con cotas repetidas admitidas), origen, formas de metadatos, adquisición y grafo. Las unidades/roles no vacíos y nombres de efectos desconocidos se conservan; eso no habilita su uso científico. El esquema 1 asigna cada curva completa a una sola corrida; un futuro soporte de corridas por intervalos requerirá su propio esquema.

Hay una raíz por pozo y padres del mismo pozo; se rechazan ciclos y referencias activas inconsistentes. Cambiar entradas o adquisición crea una hija y cambia su revisión activa en una sola devolución, conservando las anteriores. No se implementó limpieza de revisiones. La validación actual recorre el almacén y sus datos; antes de activarlo sobre historiales extensos deberá medirse ese costo.

Continúan pendientes las partes de P1 que modifican Project, snapshots, runner aislado, generación de ids, persistencia, integridad de blobs y migración. La aplicación continúa guardando v6 y no usa todavía este módulo. Las reglas D1–D6 siguen siendo el contrato para esas próximas entregas.
