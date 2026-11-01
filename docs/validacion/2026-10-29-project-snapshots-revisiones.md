# P1b: conexión optativa de Project y snapshots a revisiones

Estado: **validación completada; preparado para revisión, sin mergear**.

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
- HTML final: 5.415.233 → 5.432.496 bytes (+17.263; ≈0,32 %), sin dependencias nuevas de producción. La lógica está enlazada, pero su activación sigue optativa.

### Navegador: bloqueo resuelto y recorridos aprobados

La investigación del bloqueo reproducido en el padre detectó **21.939 animaciones CSS ui-flash activas**, sobre una página de aproximadamente 62.000 elementos. La geometría permanecía estable y los timers avanzaban, pero casi no llegaban frames. La tabla FLOW_UNITS del TP contiene 1.790 filas y 26.850 celdas; animar sus miles de cambios simultáneamente impedía que terminaran las acciones/capturas.

ResultsPanel limita los destellos a tablas de hasta 200 celdas numéricas. Las mayores siguen mostrando todas las filas, columnas, unidades y valores; conservan los mismos spans/estilos de disposición sin activar useFlash. Se mantiene el feedback en tablas pequeñas y valores escalares. No se altera cálculo, datos ni exportación. El DOM completo de la tabla todavía se monta; no es una implementación de virtualización.

La lista de snapshots ahora tiene flex-shrink:0 dentro del diálogo. La comparación extensa desplaza el cuerpo sin comprimir las acciones debajo de la cabecera fija. El recorrido final utiliza clics reales en Restaurar y Cortina, sin force ni APIs internas.

En el diagnóstico posterior a restaurar/cerrar por teclado se observaron cero animaciones activas y 59/120/181 frames acumulados en tres lecturas de aproximadamente un segundo; antes fueron 1/2/2 frames con los timers avanzando y 21.939 animaciones. La captura posterior ahora termina. Son observaciones del entorno, no una garantía universal de FPS.

**project_snapshots.py pasó completo** a 1366×768: igualdad de geometría y comparación inicial, guardado/apertura v6 sin marcadores de revisiones, diferencia de GR limpio=50, restauración, guardar, undo/redo, cortina y exportaciones posteriores. Las 1.790 filas de FLOW_UNITS y su contenido completo coinciden por hash entre padre, candidato y estado restaurado. LAS/SVG anteriores y posteriores coinciden por bytes. Sin excepciones de página.

**reading_viewer.py pasó completo**: geometría normal idéntica al padre; lectura amplia reversible, teclado, preferencias propias/recarga, paneles y editores, las 47 curvas de fábrica, Geología, claro/oscuro a 1366×768, captura clara a 1920×1080 y DPR 2 a 1366×768. El proyecto y las exportaciones permanecen iguales. Sin excepciones de página. file:// sigue fuera de este recorrido HTTP local.

[Resultados completos y hashes de builds](metricas/2026-10-29-project-snapshots-navegador.json). Hashes SHA-256 de exportaciones iguales: LAS ce05261de2da6624cc0d94f2611ec20fe0125b62d15cbb60aafd8808fcca6c2b; SVG faed7fe0052c14429515ff1564a87477fb0de9d804de3b5d5991b4d4e8a726f8.

### Rendimiento legado en Node

Una vuelta de calentamiento y cinco medidas consecutivas por build, sin navegador concurrente. La medición antecede al ajuste visual; ese ajuste no cambia las rutas Node/core medidas. Medianas padre → candidato: guardar 37,04 → 34,22 ms; abrir 6,09 → 7,37 ms; calcular 782,14 → 782,15 ms. Cocientes 0,924 / 1,210 / 1,000; ninguno supera 1,25. No prueban rendimiento en navegador/equipo objetivo ni guardado de revisiones. [Mediciones completas](metricas/2026-10-29-project-revisions.json).

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

Para reproducir el bloqueo del padre, usar --candidate parent.html --keyboard-actions y otro --output. El candidato corregido se validó con clics reales a 1366×768. El diagnóstico adicional de teclado también completó la captura. --width/--height permiten investigar otros tamaños; no se declara una matriz exhaustiva de tamaños para snapshots.

El verificador de snapshots selecciona el pozo por activeWellId y opera por la UI, incluyendo guardar/abrir v6, comparación, restauración, undo/redo, cortina y exportaciones. No activa APIs internas de revisiones ni se incluye en producción. Las pruebas de dominio cubren el modo optativo que aún no se expone en la UI.

## Pendiente

P1c: archivo/migración v7 con revisiones y blobs, integridad, límites de descompresión y prueba de recuperar snapshots después de guardar/cerrar/abrir. Mantener marcado el límite de datos históricos de snapshots v1–v6. La activación en la UI requiere completar esa persistencia. El protocolo/contexto de P2, preparación básica, calibración DRX y correcciones ambientales permanecen pendientes.
