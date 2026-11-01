# Validación P2b: proyección efectiva y laboratorio

Base: PR #43, commit `0d452cc9701cbe5710033d103c34e362b873c1ba`. Rama apilada sobre `codex/contexto-cientifico-motor`; ningún merge. Contrato: ADR 0035.

## Comportamiento verificado

- El TP completo sin preparación conserva las referencias originales y el resultado científico del motor anterior.
- La API de artefactos evaluados verifica revisión, profundidad, unidades, dimensiones, ids, colisiones, padres/versiones y ciclos. Resuelve dependencias fuera de orden y conserva el orden de presentación. Datos, calidad o receta diferentes cambian contexto; un no-op reutiliza la proyección.
- Las preparadas no compiten por ser la fuente por defecto. Elegir una ausente, de unidad inválida o con cualquier ancestro apagado/fuera del plan bloquea el puerto y sus consumidores, incluso entradas opcionales. Motor, disponibilidad y series concuerdan; no hay fallback silencioso.
- Visor/rellenos y series por rol siguen la preparada elegida; el original sigue accesible por id. Los adaptadores distinguen su origen en visor, series, columnas y descripciones de exportación. Un resultado coherente con la proyección puede alimentar el informe.
- Los ids reservados se remapean en imports nuevos, conservando mnemónico. Los originales legados con ese prefijo conservan su identidad. Guardar una proyección como originales se rechaza; abrir v6 con una proyección incrustada también se rechaza antes de activar el proyecto. El formato no cambia.
- Cambiar valores/decisiones de laboratorio, ventana, configuración o versión de método cambia calibrationKey. No cambia engineKey cuando el motor no consume laboratorio. Nombres, encabezado y tendencias no invalidan esa evidencia. No hay ajuste DRX ni aceptación de propuestas en esta entrega.

## Suite y build

**2.693 pruebas en 154 archivos**, sin fallos ni omisiones; 36 nuevas. Typecheck, build y diff check aprobados. Sin dependencias nuevas. HTML base 5.519.941 bytes; candidato 5.532.035 bytes (+12.094, ~0,22 %). SHA-256 final: `894be14ab817873b4ac77d43bdff191d73c42551d1598462c50d8d451dcd867d`.

Ensayo Node/Vite SSR con TP (5.810 muestras, 18 curvas): proyección de identidad y motor completo por MessageChannel, 1 warmup y 7 cambios secuenciales de GR limpio. Medianas padre/candidato **64,56 / 59,06 ms**, cociente **0,915×**, bajo el umbral 1,25×. Huella científica idéntica: `e9cb7cbe45d6ba0144dd225d22ffd975524f34dda4442df5beccbbdb5ce456fa`. Buffers originales intactos. Medido sin suite ni navegadores compitiendo. No representa latencia de Worker de navegador, un benchmark de preparación pesada ni una garantía de hardware; se conservan todas las muestras.

## Worker y navegador

El harness independiente `scripts/qa/data_context.html` importa el worker incrustado de producción y usa EngineClient, sin stores ni hooks de prueba. Una entrada preparada de 40/NaN/60 gAPI produce IGR 0,4/NaN/0,6 con GR limpio=0 y GR arcilla=100. Hereda GR y caliper; apagar solo caliper bloquea IGR aunque la GR original continúe disponible. Omitir el artefacto tampoco vuelve al original. Elegir explícitamente el original recupera 0,1/0,2/0,3. También se rechaza una proyección enviada con contexto de originales antes de sincronizar, y el cliente sigue admitiendo el pedido válido posterior. Buffers originales, preparados y de calidad permanecen intactos. HTTP local aprobado, sin excepciones.

La navegación `file://` fue rechazada por Chromium con `ERR_BLOCKED_BY_ADMINISTRATOR`. El script registra `blocked-by-environment`, no un aprobado ni un fallo científico. No se modificó la política del navegador. El recorrido de la aplicación por file:// sigue sin verificar.

Cuatro recorridos completos sobre el HTML final, sin excepciones de página:

- engine_context: delta incompleto con recuperación completa única, respuesta tardía del mismo pozo/profundidad, reinicio acotado/error terminal, recuperación posterior y revisión de metadatos de laboratorio sin otro cálculo.
- archive_v7: guardar/reabrir en contexto nuevo, restaurar curvas/laboratorio, undo/redo/cortina, corrupción sin modificar el proyecto activo, workers terminados y alternativa offline sin Worker/SubtleCrypto.
- project_snapshots: legado v6, comparar/restaurar/undo/redo, tabla FLOW_UNITS completa y exportaciones LAS/SVG iguales al padre y al restaurado.
- reading_viewer: geometría normal idéntica al padre, lectura reversible, preferencias/recarga/teclado, 47 curvas, Geología, claro/oscuro, 1366/1920 y DPR 2. Sin modificar los datos por navegar.

Los hashes de LAS/SVG, geometría y tablas se conservan en `metricas/2026-10-30-proyeccion-efectiva.json`, junto con evidencia del Worker y muestras de rendimiento.

Una primera ejecución de engine_context encontró una carrera del script al cerrar un toast que venció entre comprobar visibilidad y hacer clic. El helper ahora usa un timeout corto y solo tolera ese caso si el aviso ya desapareció; no fuerza clics ni modifica el DOM. Una corrida del test nuevo que ejecuta dos motores completos sobre TP excedió 5 s mientras corrían suite, compilación y navegador simultáneamente; se asignó 30 s solo a ese caso de integración. El rendimiento se mide aparte, sin esos procesos compitiendo.

## Reproducción

```sh
npm test -- --reporter=json --outputFile=/tmp/proyeccion-tests.json
npm run typecheck
npm run build
node /ruta/scripts/qa/data_context.mjs /tmp/proyeccion-perf.json
```

Ejecutar el mismo medidor desde los checkouts padre y candidato; el padre usa su productor de contexto de identidad y el candidato resolveDataContext. No instalar dependencias diferentes entre ellos.

Para compilar el harness con la configuración vigente, desde la raíz:

```sh
node --input-type=module - <<'JS'
import {build} from 'vite';
await build({build:{outDir:'/tmp/proyeccion-harness',emptyOutDir:true,rollupOptions:{input:'scripts/qa/data_context.html'}}});
JS
python scripts/qa/data_context.py --url http://127.0.0.1:4173/scripts/qa/data_context.html --file /tmp/proyeccion-harness/scripts/qa/data_context.html --output /tmp/proyeccion-worker.json
```

Servir `/tmp/proyeccion-harness` por HTTP en el puerto del ejemplo. Para regresiones, servir ambos HTML como parent.html y candidate.html y ejecutar engine_context.py/archive_v7.py con el seed de archive_v7.mjs, además de project_snapshots.py y reading_viewer.py. Los recorridos conservan capturas y evidencia JSON; las métricas archivadas contienen los resultados finales.

## Límites

P2b prepara el contrato y los consumidores de artefactos ya evaluados. No agrega productores a los stores, editor, evaluador de recetas, flags científicos, ledger de efectos, LRU de intermediarios ni cancelación de preparación; pertenecen a P3. Los arrays son inmutables por contrato, no por una prohibición física de escritura. Las claves son de sesión. No se modifican fórmulas ni modelos ML, no se habilitan correcciones físicas ni calibración DRX y no se cierran #31/#32.
