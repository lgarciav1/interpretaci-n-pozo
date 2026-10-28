# Corpus de compatibilidad de proyectos

Estos seis archivos son **reconstrucciones sintéticas** de los contratos v1–v6 documentados en `src/core/state/serialize.ts`. No son proyectos históricos de usuarios ni sustituyen la comprobación con sus archivos reales.

Se escribieron fuera del serializer de la aplicación. Los arrays se codificaron con Python `struct.pack('<d', ...)`, `zlib.compress` y base64; el shuffle agrupa el byte k de todos los valores antes de comprimir. Se guardan los archivos JSON resultantes como entradas fijas. Las pruebas nunca los generan, rebajan de versión ni actualizan automáticamente.

`manifest.json` registra SHA-256 de cada archivo y los bytes Float64 little-endian decodificados esperados por ruta. La prueba de integridad detecta cambios accidentales; modificar el corpus exige revisar también sus valores, la procedencia y el contrato, no solo actualizar hashes.

| Versión | Contenido incorporado | Codec |
|---|---|---|
| 1 | Curvas, zonas, fuentes, parámetros globales/por zona y snapshot | f64le-b64 |
| 2 | Progreso de pasos | f64le-deflate-b64 |
| 3 | Pistas y overrides | f64le-shuffle-deflate-b64 |
| 4 | Tendencia y exclusión | f64le-b64 |
| 5 | MDT: profundidades repetidas, columnas numéricas/texto y decisiones por id | f64le-deflate-b64 |
| 6 | Corona, puesta en profundidad, sarta, gráficos, plantilla y segundo pozo | f64le-shuffle-deflate-b64 |

La distribución de codecs prueba las tres codificaciones admitidas; no afirma qué codec usó cada release histórico. GR y VSH usan gAPI y v/v. La unidad original de profundidad ft es informativa: el índice guardado ya está en metros. AUX sin rol conserva -0, ±Infinity, NaN y un número subnormal; no alimenta petrofísica.

El campo compare contiene además un id de módulo legado no registrado (`vsh-larionov-old`): se conserva como decisión del archivo y no acredita disponibilidad de ese método. Las pruebas comparan también los diagnósticos del motor antes/después.

Los snapshots originales v1–v6 no contienen una revisión histórica del Well. La futura migración debe declarar esa limitación y fijarlos a la revisión disponible, sin inventar entradas anteriores.

Ejecutar `npm test -- tests/compat/legacy-projects.test.ts --maxWorkers=1`. Para P1 se reutiliza este corpus y se agregan archivos v7; no se reemplazan los v1–v6 con salidas del nuevo serializer.
