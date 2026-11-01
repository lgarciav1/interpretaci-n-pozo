# Validación P3a: exclusión reversible por intervalos

Base: PR #44, commit `2316dcc198871334beaa9d642f9205af278b0515`. Rama encadenada `codex/preparacion-mascaras-p3`; sin merges. Contrato normativo: ADR 0036.

## Alcance probado

- Máscara v1 de intervalos MD cerrados, filas/profundidad intactas y flags que distinguen faltantes previos de exclusiones. Solapamientos se conservan al restaurar una decisión; restaurar la última vuelve explícitamente al original.
- Recetas JSON versionadas con revisión/curva de origen. Cambiar grilla o datos/metadata de curva bloquea su nodo; cambiar solo encabezado/laboratorio puede reutilizar la preparación si conserva los mismos orígenes. Referencias inexistentes/de otro pozo y métodos futuros se rechazan.
- Firma independiente de ids de intervalos; repetir un mismo alcance conserva arrays y firma incluso con varias curvas preparadas, sin reordenar nodos. LRU por bytes y cancelación por bloques sin resultados parciales.
- Worker/in-process devuelven máscara y motor en un paquete validado. Faltantes, calidad de tamaño inválido, versiones equivocadas o duplicados requieren una recuperación completa única. Fallos persistentes reinician una vez, terminan en error visible y permiten un pedido posterior limpio. El worker replanifica y rechaza un alcance alterado en tránsito.
- Migración de entradas, receta y fuente se aceptan en una sola unidad de undo/redo. Los originales son los únicos perfiles persistidos; guardar/reabrir reproduce preparación/calidad y snapshots. Versiones/referencias/intervalos corruptos no se reparan silenciosamente.
- Exportación ofrece original, preparada y QC. Informes/exportaciones y calibrationKey rechazan recetas anteriores con el mismo id de curva. El QC del informe sigue describiendo los originales. El runner comparte la cola con snapshots, prioriza el último preview y limita también su caché por bytes sin evictar vistas en uso.

## Verificación final

**2.716 pruebas en 156 archivos**, 23 nuevas; sin fallos ni omisiones. Typecheck y diff check aprobados. Una corrida con dos navegadores/compilación/suite en paralelo excedió 5 s en un caso preexistente de tool-string; la suite final se ejecutó sin esa competencia y aprobó manteniendo el umbral original. No se relajaron sus pruebas.

Build aprobado, sin dependencias nuevas. HTML base 5.532.035 bytes; final **5.566.981 bytes** (+34.946, ~0,63 %). SHA-256 final: `3c3cd34828d67cd1e68811009dd024d7bc62b17001eb1b8feea43383abc4e4e0`.

## Recorrido real de la aplicación

`scripts/qa/preparation.py` usa UI y la API nativa Worker; no accede a stores privados. Sobre TP completo y laboratorio del seed:

1. Previsualizar [7800,7810] m no cambia Project ni la cantidad de pedidos al motor principal. Cambiar el borrador inhabilita Aplicar. Cancelar conserva el proyecto completo.
2. Aplicar excluye **65 mediciones** y mantiene las 5.810 filas. Cada valor de GR original exportado coincide con la base. Cada valor preparado coincide fuera del intervalo; dentro se exporta sin dato. QC 0–3 concuerda muestra por muestra.
3. Deshacer devuelve el LAS original; rehacer devuelve exactamente el LAS preparado. Se inyecta un paquete de preparación vacío al rehacer: ocurre una única recuperación full, sin publicar un resultado incompleto.
4. Guardar/reabrir en un contexto de navegador nuevo conserva la curva preparada y su calidad. Restaurar el snapshot preparado reproduce el mismo LAS. Restaurar el original devuelve el LAS base y no agrega blobs derivados.
5. Una receta con versión de método 99 se rechaza y deja intacto el proyecto preparado activo. Se comprueba la alternativa sin red, Worker ni SubtleCrypto: GR original, preparada y QC coinciden con la ejecución con Worker.
6. Diálogo claro/oscuro a 1366×768, muestras tabuladas acotadas, borrador separado de exclusiones guardadas y control de comparación de vista. Capturas revisadas visualmente; campos y footer legibles sin superponer perfiles.

Además pasaron completos, sobre el mismo HTML final: engine_context (fallos inyectados/resync/reinicio y metadatos de laboratorio sin recálculo), archive_v7 (guardar/reabrir/restaurar/undo/redo/corrupción/offline), project_snapshots (legado y tabla completa) y reading_viewer (geometría normal idéntica, lectura reversible, preferencias, teclado, 47 curvas, Geología, temas, 1366/1920 y DPR 2). Sin excepciones de página. Los cinco recorridos y sus hashes/medidas están archivados en `metricas/2026-10-30-exclusion-reversible.json`.

La primera corrida del script asumía mnemónicos LAS en mayúsculas y sección ~ASCII; el escritor vigente conserva la caja y usa ~A. Se corrigió el lector independiente del ensayo. El selector de comparación también se ajustó al nombre accesible real de Checkbox (incluye descripción). No se alteraron archivos ni producto para satisfacer esas suposiciones del script.

## Rendimiento e integridad

Ensayo Node/Vite SSR sobre TP completo, 1 warmup + 7 cambios de GR limpio. Sin preparación: medianas padre/candidato **61,54 / 63,65 ms**, cociente **1,034×** (umbral 1,25×). Huella científica idéntica, incluyendo fuentes/candidatos/diagnósticos: `e9cb7cbe45d6ba0144dd225d22ffd975524f34dda4442df5beccbbdb5ce456fa`.

Con una máscara [7800,7810], plan + motor/MessageChannel + reconstrucción del paquete con caché caliente: mediana **52,23 ms**. Todas las salidas coinciden por bytes/JSON con el Engine que recibe una GR enmascarada independientemente: `9c1b6d0ca6874b76d8178acef30f4fe7c9559e91647d31bbbc5366e703d495a6`. Se conservan bytes y buffers de todos los originales.

Los warmups se conservan (aprox. 1,09/1,14/1,02 s) junto con cada muestra. Las mediciones se hicieron sin suite ni navegadores compitiendo. No demuestran latencia de Worker/UI, velocidad universal del método ni comportamiento de correcciones pesadas; no se interpreta la máscara más rápida de esa ronda como una mejora general de rendimiento.

## Reproducción

```sh
npm test -- --reporter=json --outputFile=/tmp/preparacion-tests.json
npm run typecheck
npm run build
node /ruta/scripts/qa/preparation.mjs /tmp/identidad.json identity
node /ruta/scripts/qa/preparation.mjs /tmp/mascara.json mask
```

Ejecutar identity desde ambos checkouts con el mismo script/dependencias; mask solo desde candidato. El ensayo mask compara además las salidas con un Engine al que se entrega, independientemente, una GR con NaN en el intervalo seleccionado.

Servir los HTML padre/candidato como parent.html y candidate.html. Generar el seed con archive_v7.mjs según su documentación y ejecutar:

```sh
python scripts/qa/preparation.py --url http://127.0.0.1:4173/ --seed /ruta/seed --output /tmp/preparacion-browser
```

La misma pareja de HTML se recorre con engine_context.py, archive_v7.py, project_snapshots.py y reading_viewer.py. Los scripts conservan evidencia JSON, descargas y capturas locales. El resumen archivado contiene resultados de todos los recorridos y muestras de rendimiento.

## Límites

Se entrega P3a: exclusión/restauración manual, no todas las operaciones de preparación. Sin despike, filtros, interpolación, alineación, calibración DRX ni correcciones ambientales nuevas. El presupuesto LRU no es un techo global del proceso: originales, migración, transferencias y vistas fijadas consumen memoria adicional. Los arrays son inmutables por contrato. La fase petrofísica síncrona descarta resultados cancelados pero no se interrumpe a mitad de compute.

file:// continúa sin verificación porque Chromium del entorno rechaza esa navegación con ERR_BLOCKED_BY_ADMINISTRATOR (documentado en P2b). En esta entrega sí se prueba HTTP local y el flujo offline sin Worker/SubtleCrypto, sin modificar políticas del navegador. Main y los PR anteriores quedan intactos.
