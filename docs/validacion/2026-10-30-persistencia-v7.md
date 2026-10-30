# P1c: archivo v7 con revisiones y recuperación de snapshots

Fecha: 2026-10-30. Base: PR #41, 9df898ef2050f44e9219fc609e7daecc35b89cce. Continúa ADR 0033 y masterplan #33. Sin integrar ni mergear PRs.

## Comportamiento y compatibilidad

serializeProject elige v7 si el proyecto tiene revisiones. Los proyectos legados siguen guardando v6, sin activación automática. version:6 con revisiones continúa rechazando una copia incompleta. deserializeProject admite v7; upgradeInputs:true migra explícitamente v1–v6 después del saneamiento legado. El texto original permanece intacto. Los snapshots migrados llevan legacy-current-inputs y muestran el límite histórico al abrir y comparar. Los nuevos snapshots de un proyecto v7 usan pinned. No se agrega un botón de preparación/activación en esta entrega.

PROJECT_VERSION sigue describiendo la escritura legada (6); REVISION_PROJECT_VERSION identifica v7. El test de archivo futuro usa ahora v8. Las expectativas temporales de P1b se ajustaron para exigir el rechazo al forzar v6 y admitir la escritura completa v7; no se reducen comprobaciones de datos.

El archivo guarda una sola representación de Well por revisión y referencias activas por id. Los arrays de profundidad, curvas y laboratorio usan blobs f64 LE identificados por SHA-256 de sus bytes decodificados. Un mismo contenido ocupa un solo blob aunque cambien unidad, procedencia o adquisición. Se conservan NaN/payloads, infinitos, ceros con signo y subarrays. El lector reconstruye aliases exactos y comparte arrays por blob; metadatos/contenedores quedan congelados. Typed arrays siguen siendo de lectura por contrato.

## Integridad, límites y recuperación

La apertura normal valida hashes, esquemas, referencias, dimensiones, raíz/padres/ciclos y pertenencia al pozo antes de publicar. No sustituye una referencia dañada por datos actuales. recoverProject es una API explícita separada: devuelve project|null e issues con ubicación y motivo; conserva pozos independientes válidos y diagnostica lo omitido. Si no queda un pozo válido devuelve null; no selecciona otra revisión ni otro pozo activo como respaldo. No hay todavía interfaz gráfica de recuperación. El original no se reescribe.

Límites: 64 MiB UTF-8 de archivo, 512 MiB decodificados únicos y 128 MiB por array. Se pueden reducir para pruebas/equipos, no ampliar por options. La descompresión lee por chunks y se interrumpe si excede lo declarado, sin devolver arrays truncados. En v1–v6, un límite de laboratorio no se convierte en una columna descartable. Estos presupuestos no equivalen a memoria pico/libre.

SHA-256 usa SubtleCrypto o fallback offline probado con vectores y subarrays. La UI procesa archivos en un worker separado, una tarea activa, hasta ocho blobs simultáneos, sin transferir buffers del proyecto. Termina el worker al finalizar, fallar o agotar 120 segundos. Sin Worker se usa la alternativa en proceso y el hash cede ejecución por bloques. Los codecs deflate siguen requiriendo las APIs nativas; sin compresión nativa se puede escribir f64le-b64. No se agrega dependencia.

## Verificación

- **2.628 pruebas aprobadas en 152 archivos**, cero fallos/omisiones; 71 pruebas nuevas.
- Typecheck, build y diff check aprobados.
- Fixture v7 sintético e independiente del serializer, generado con Python struct/base64/hashlib; su origen y SHA están en tests/fixtures/archive/README.md. No representa un proyecto histórico real.
- Migración explícita del corpus fijo v1–v6: datos, fuentes, decisiones, progreso y display conservados; snapshots marcados con su límite histórico. Los proyectos originales mantienen escritura v6.
- Tres codecs y auto; deduplicación por bytes; laboratorio y texto; múltiples pozos; restauración tras cerrar/abrir; nuevos hijos después de reabrir; caché/runner sobre GR histórico; payloads NaN y ceros con signo.
- Corrupción de un bit, hashes, ids, referencias activas/de snapshot, metadatos, dimensiones, padres de otro pozo, ciclos, dos raíces y esquemas futuros rechazados. Recuperación independiente probada sin reasignación de referencias.
- Límites UTF-8/array/total y stream de alta expansión, truncado o corto; validación antes de asignar arrays enormes. Worker: copias, aliases, exclusión concurrente, error, respuesta inválida, timeout y fallback.

### Navegador

archive_v7.py pasó sobre el TP completo y laboratorio preparado por archive_v7.mjs. Abre v7, guarda, cierra el contexto del navegador y reabre el archivo guardado: restaura curvas/laboratorio originales, guarda, deshace/rehace y abre/cierra cortina. Los blobs guardados se verifican de forma independiente con hashlib, struct y zlib de Python. Tras un archivo corrupto, el proyecto activo guardado sigue idéntico. Se comprueba el aviso de snapshots migrados. Instrumentación de la API Worker: una tarea de archivo como máximo y todos los workers de archivo terminados. También pasó sin Worker/SubtleCrypto y con la red desconectada después de cargar el HTML. Sin excepciones de página. LAS y SVG tras restaurar coinciden por bytes con el padre sobre las entradas originales.

project_snapshots.py pasó para el flujo legado: geometría normal, comparación, archivo v6, restauración, undo/redo, cortina, tabla completa FLOW_UNITS y exportaciones iguales al padre.

reading_viewer.py pasó completo: geometría normal idéntica al padre, lectura reversible, teclado, preferencias/recarga, paneles/editores, 47 curvas de fábrica y Geología; claro/oscuro a 1366×768, captura clara a 1920×1080 y DPR 2. Proyecto y exportaciones iguales, sin excepciones de página. [Evidencia completa y hashes](metricas/2026-10-30-archivo-v7.json). Los tests son HTTP local, no certifican file:// ni todos los navegadores/equipos.

### Rendimiento y almacenamiento

La versión inicial secuencial se midió y se optimizó antes de entregar. La medición alternada final en Node/Vite SSR usa una vuelta de calentamiento y cinco medidas por modo, TP de 5.810 muestras/18 curvas y laboratorio. Medianas legado/v7: guardar 36,05/30,38 ms y abrir 5,69/6,35 ms; cocientes 0,843/1,116, bajo 1,25. No son tiempos de worker/UI ni garantías de hardware. Los resultados científicos completos del motor tras reabrir/restaurar coinciden con los originales, excluyendo estadísticas temporales de ejecución.

Cambiar solo adquisición mantiene 21 blobs y 883.136 bytes únicos; no duplica binario. El flujo legado se midió contra #41 en dos rondas: padre/candidato y candidato/padre, calentamiento + cinco muestras por ejecución, sin suites ni navegador concurrentes. La primera razón de apertura fue 1,25147 y motivó la repetición en orden inverso. Medianas agregadas de diez muestras por build, padre → candidato: guardar 43,57 → 36,27 ms; abrir 6,38 → 7,39 ms; calcular 837,12 → 811,50 ms. Cocientes 0,832 / 1,158 / 0,969, dentro de 1,25. Se conservan ambas rondas y su variación en la evidencia. Archivo TP de 290.153 bytes y SHA-256 idénticos.

HTML: 5.432.496 → **5.507.660 bytes** (+75.164; ~1,38 %), incluye el worker y la alternativa offline. Sin dependencias nuevas. Hash SHA-256 final: 5bdf0199b8ec69a53997d306a384b37035ab9b5ce239f63057cda76f10709e8b.

## Reproducir

~~~sh
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/archive_v7.mjs /tmp/pozo-v7
~~~

Servir por HTTP local el HTML de #41 como parent.html y el candidato como candidate.html. Con Python, Playwright y Chromium:

~~~sh
python3 scripts/qa/archive_v7.py --url http://127.0.0.1:4178/ --seed /tmp/pozo-v7 --output /tmp/pozo-v7-browser --chromium /usr/bin/chromium
python3 scripts/qa/project_snapshots.py --url http://127.0.0.1:4178/ --output /tmp/pozo-v7-snapshots --chromium /usr/bin/chromium
python3 scripts/qa/reading_viewer.py --url http://127.0.0.1:4178/ --output /tmp/pozo-v7-reading --chromium /usr/bin/chromium
~~~

## Próxima fase

P2: contexto científico y protocolo de invalidación/resync antes de conectar preparación. Preparación reversible, calibración DRX y correcciones ambientales siguen pendientes. No se presenta esta entrega como implementación de esas funciones ni como cierre de todas las puertas del masterplan.
