# P1b: conexión optativa de Project y snapshots a revisiones

Estado: **borrador; validación de navegador incompleta**.

Fecha: 2026-10-29. Base: PR #40, fb1db6f023ffb4bda840978d701b19f557ccbc01. Continúa el ADR 0033 y el masterplan #33, sin integrar ni mergear PRs.

## Qué cambia

Project admite un mapa inputRevisions; WellEntry conserva Well como alias exacto y agrega inputRevisionId. Los snapshots de un proyecto habilitado fijan esa revisión. La operación de dominio enableProjectInputRevisions captura las entradas actuales y marca snapshots antiguos con legacy-current-inputs; una segunda activación no genera revisiones nuevas. Ningún flujo de UI, carga o creación normal llama a esa operación en esta entrega.

En el modo optativo, agregar pozos y las recetas existentes de edición de curvas/roles y laboratorio crean revisiones. updateWell entrega una copia editable y publica una hija solo si cambió contenido. Cambiar parámetros o decisiones no duplica entradas. Se conserva historial de revisiones; no se implementa limpieza automática. Los estados se validan antes de commit/replace para evitar publicar aliases o referencias inconsistentes.

La restauración de un snapshot fijado cambia atómicamente Well, revisión e interpretación; conserva progreso, display y pozo activo. Undo/redo conserva el proyecto completo y permite crear una rama desde una revisión restaurada. Resolver un snapshot roto produce error y no usa los datos activos como respaldo.

## Comparación

El pedido del runner aislado resuelve las curvas desde la revisión del snapshot; su clave incluye inputRevisionId. Cada lado del sumario usa su propio índice de profundidad y avisa si los datos de entrada pertenecen a versiones distintas. La comparación no modifica el proyecto activo.

La cortina usa las curvas originales del snapshot cuando la grilla y los conjuntos de puntos son iguales por contenido. Si cambia profundidad o laboratorio, se bloquea con una explicación y permite usar sumario/restauración. El renderer de cortina actual comparte índice y overlays: no se inventa una alineación ni se mezclan versiones de datos puntuales. Esta limitación no afecta los snapshots legados sobre los mismos datos actuales.

## Identidad y persistencia

La generación de ids usa 16 bytes de crypto cuando es posible, con fallback local, comprobación de colisiones y ocho intentos como máximo. Reloj y entropía son sustituibles; un no-op no los consulta. El fallback sirve para unicidad local y no se usa como clave de seguridad.

La persistencia vigente sigue siendo v6. serializeProject rechaza proyectos con revisiones antes de generar una copia incompleta. deserializeProject rechaza archivos que declaren v6 o anterior pero traigan marcadores de revisiones. Los proyectos legados conservan su apertura/guardado habitual. No se ofrece todavía activar revisiones desde la UI porque falta el archivo/migración v7.

## Validación

- Suite completa: **2.557 pruebas aprobadas en 150 archivos**, sin fallos ni omisiones; incluye 42 pruebas nuevas.
- Typecheck, build y diff check aprobados.
- Pruebas de restauración de curvas, laboratorio y decisiones tras reemplazar o quitar entradas; aliases, multipozo, no-op, errores atómicos, commit/undo/redo, ramificación, caché por revisión y seis fixtures v1–v6.
- Fallback sin crypto, crypto con fallo, colisiones y límites de reintento comprobados.
- HTML: 5.415.233 → 5.432.296 bytes (+17.063; ≈0,32 %), sin dependencias nuevas de producción. La lógica está enlazada, pero su activación sigue optativa.

### Navegador: validación parcial, entrega en borrador

En Chromium a 1366×768 se comprobó igualdad de geometría inicial, comparación sin diferencias, guardado v6 sin marcadores de revisiones y exportaciones iniciales LAS/SVG iguales por bytes entre padre y candidato. El proyecto abierto con GR limpio=50 conserva el snapshot anterior y muestra la diferencia esperada.

El recorrido completo **no pasó**: después de restaurar por teclado y cerrar el diálogo, Chromium se bloquea; guardar y capturar pantalla agotan su tiempo. El mismo script usando parent.html también como candidato reproduce el bloqueo. Además, a ese tamaño el encabezado de tabla intercepta el clic en Restaurar. Son observaciones reproducidas en el padre; no se atribuyen a esta entrega ni se consideran resueltas. No se aprobó restauración/undo/redo/cortina/exportaciones posteriores por UI. Las pruebas de dominio sí cubren esas operaciones. La matriz completa reading_viewer no se ejecutó en esta entrega. Un intento posterior de verificación amplia no llegó a ejecutarse; no aporta evidencia.

Hashes SHA-256 iniciales iguales: LAS ce05261de2da6624cc0d94f2611ec20fe0125b62d15cbb60aafd8808fcca6c2b; SVG faed7fe0052c14429515ff1564a87477fb0de9d804de3b5d5991b4d4e8a726f8.

### Rendimiento legado en Node

Una vuelta de calentamiento y cinco medidas consecutivas por build, sin navegador concurrente. Medianas padre → candidato: guardar 37,04 → 34,22 ms; abrir 6,09 → 7,37 ms; calcular 782,14 → 782,15 ms. Cocientes 0,924 / 1,210 / 1,000; ninguno supera 1,25. No prueban rendimiento en navegador/equipo objetivo ni guardado de revisiones. [Mediciones completas](metricas/2026-10-29-project-revisions.json).

Archivo TP de 290.153 bytes idéntico, SHA-256 20d3a825fdd8a148c3ac33f0a7c1241bd47726ffbd1303dfd94671c6c5e5dc3a. Las mediciones tienen variación normal de entorno y no son una garantía universal.

## Reproducir

~~~sh
npm run typecheck
npm test -- --maxWorkers=1
npm run build
~~~

Para navegador, disponer de Python, Playwright y Chromium. Servir por HTTP local el HTML padre como parent.html y el candidato como candidate.html:

~~~sh
python3 scripts/qa/project_snapshots.py --url http://127.0.0.1:4173/ --output /tmp/pozo-project-snapshots --chromium /usr/bin/chromium
python3 scripts/qa/reading_viewer.py --url http://127.0.0.1:4173/ --output /tmp/pozo-project-reading --chromium /usr/bin/chromium
~~~

El verificador es un recorrido reproducible que permanece fallando en el punto documentado. Para el control con el padre, usar --candidate parent.html y otro --output. Admite --width/--height para investigar otros tamaños; no hay resultado aprobado de esa variante.

El verificador de snapshots selecciona el pozo por activeWellId y opera por la UI, incluyendo guardar/abrir v6, comparación, restauración, undo/redo, cortina y exportaciones. No activa APIs internas de revisiones ni se incluye en producción. Las pruebas de dominio cubren el modo optativo que aún no se expone en la UI.

## Pendiente

P1c: archivo/migración v7 con revisiones y blobs, integridad, límites de descompresión y prueba de recuperar snapshots después de guardar/cerrar/abrir. Mantener marcado el límite de datos históricos de snapshots v1–v6. La activación en la UI requiere completar esa persistencia. El protocolo/contexto de P2, preparación básica, calibración DRX y correcciones ambientales permanecen pendientes.
