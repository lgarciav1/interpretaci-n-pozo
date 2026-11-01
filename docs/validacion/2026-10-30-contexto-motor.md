# P2a: contexto científico, publicación y recuperación incremental

Fecha: 2026-10-30. Base: PR #42, f58f473b25fea2c81baf891a7ab399ddb09a58f2. Sigue ADR 0034 y masterplan #33. Sin integrar ni mergear PRs.

## Resultado

Cada resultado del cliente lleva EngineContext completo: pozo, revisión de entradas, profundidad, preparación e identidad de las entradas de cálculo. La proyección disponible sigue siendo identidad; los perfiles y fuentes son los mismos. Las claves son de sesión y no modifican v6/v7. WireCurve agrega procedencia/versionado, sin inventar fabricante, método ni ascendencia. Los datos preparados requieren un plan validado; este productor no los hace pasar por originales.

El cliente no publica respuestas atrasadas ni deltas incompletos. Instala la caché solo después de validar todas las salidas, y mantiene bases incrementales válidas por versión incluso si una interpretación intermedia ya fue superada. gen/seq y syncId conservan funciones de transporte separadas del contexto científico. Los errores de una sincronización anterior tampoco se atribuyen a la actual.

Cuando cambian las entradas del motor se retiran sus salidas obsoletas mientras calcula, conservando perfiles medidos y navegación. El contexto se verifica otra vez antes de publicar en el store. Un cambio de revisión que no afecta a la física del motor actual puede volver a vincular un resultado completo con el contexto nuevo, sin ejecutar el motor; se exige igualdad de identidad de cálculo, pozo, profundidad y preparación. Display/tendencias no invalidan la física. El laboratorio requerirá nuevas dependencias/calibrationKey antes de conectar consumidores DRX.

La cola y caché aisladas de snapshots usan su propio contexto. Visor/tablas comprueban datos físicos; las entradas UI de exportación/informe comprueban el contexto esperado completo. Las APIs puras que solo reciben Well también aceptan un contexto esperado para comprobar interpretación/revisión. Una selección de exportación que dejó de estar disponible se rechaza. No se modifican las fórmulas ni el grafo de cálculo.

## Recuperación comprobada

Un delta de entrada sin su contentVersion requiere sincronización completa. Una respuesta incompleta requiere full=true una vez. Si vuelve a fallar, el supervisor reinicia una vez, reenvía entradas/pedido y finalmente informa error visible si persiste. Los resync duplicados del syncId anterior se ignoran; no hay bucle automático. Un nuevo pedido explícito puede recuperarse después del error terminal.

Los buffers originales no se transfieren. El servidor copia las salidas numéricas y transfiere solo esas copias. Las mismas implementaciones se ejecutan en Worker y MessageChannel/en proceso.

## Validación final

- **2.657 pruebas en 153 archivos**, sin fallos ni omisiones; 29 pruebas nuevas de contexto/protocolo.
- Typecheck, build y diff check aprobados.
- Ensayos de gen/seq/syncId/contexto atrasados, mismo pozo y profundidad con curvas/revisión cambiadas, coalescencia, caché incremental completa, tipos/unidades/dimensiones/versiones inválidos y parámetros con claves JSON reordenadas.
- Resync de entradas, recuperación de respuesta completa, límite de un reinicio, error terminal, nuevo pedido posterior y conservación de buffers comprobados.
- Los fixtures de resultados de informes/tablas ahora declaran el contexto real. El test de coalescencia sigue comprobando dos cálculos como máximo y el último valor, pero solo se publica el último contexto; no se conserva una publicación obsoleta para mantener el contador anterior.

### Worker real en Chromium

engine_context.py instrumenta únicamente la API Worker y el DOM; no accede a stores ni llama funciones privadas de la aplicación. Con el TP completo y su laboratorio:

1. Elimina los valores de una respuesta: se solicita un completo, sin reiniciar y sin publicar parciales.
2. Retiene una respuesta real mientras se restaura un snapshot. Mantiene el mismo wellId, gen y depthKey; cambia revisión/curvas/parámetros. Al liberar la respuesta, no se publica el contexto antiguo. LAS/SVG restaurados coinciden por bytes con el padre.
3. Corrompe persistentemente los valores: se ejecutan cuatro pedidos (inicial/completo y reinicio/completo), se termina el segundo cliente y aparece error visible. El pedido limpio posterior se recupera.
4. Restaura una revisión que solo cambia metadatos de laboratorio, compartiendo arrays: no se envía otro run al motor.

Pasaron también archive_v7.py (contexto de navegador nuevo, guardar/abrir, corrupción sin publicar, avisos y offline sin Worker/SubtleCrypto), project_snapshots.py y reading_viewer.py. Se conservan v6/v7, geometría, tabla completa de 1.790 filas, preferencias y exportaciones. Claro/oscuro, 1366×768/1920×1080 y DPR 2 según la matriz de lectura amplia. Cero excepciones de página en los cuatro recorridos. HTTP local; file:// permanece fuera de esta verificación.

### Rendimiento y build

La medición de protocolo usa el motor completo del TP mediante MessageChannel real en Node/Vite SSR: calentamiento y cinco cambios secuenciales de GR limpio. Compara el mismo script ejecutado desde el padre y el candidato; excluye contexto/tiempos del fingerprint científico. No representa latencia de navegador ni Worker y no es una garantía de hardware. Medianas padre → candidato: 65,67 → 67,81 ms (1,033×, bajo 1,25). Fingerprint científico SHA-256 idéntico y buffers originales intactos. [Muestras, hashes y cuatro recorridos completos](metricas/2026-10-30-contexto-motor.json).

Build final: 5.507.660 → **5.519.941 bytes** (+12.281; ~0,22 %), sin dependencias nuevas. SHA-256: ec3a07da8d6ca2eb8ac50c44565ef33fe202d3ce8deaad2e2f6af01cd3d8cfcb.

## Reproducir

~~~sh
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node /ruta/al/candidato/scripts/qa/engine_context.mjs /tmp/protocolo.json
node scripts/qa/archive_v7.mjs /tmp/pozo-p2-semilla
~~~

Ejecutar la medición desde cada checkout para usar sus módulos reales. Para navegador, servir el HTML de #42 como parent.html y el candidato como candidate.html por HTTP local:

~~~sh
python3 scripts/qa/engine_context.py --url http://127.0.0.1:4182/ --seed /tmp/pozo-p2-semilla --output /tmp/pozo-p2-protocolo --chromium /usr/bin/chromium
python3 scripts/qa/archive_v7.py --url http://127.0.0.1:4182/ --seed /tmp/pozo-p2-semilla --output /tmp/pozo-p2-v7 --chromium /usr/bin/chromium
python3 scripts/qa/project_snapshots.py --url http://127.0.0.1:4182/ --output /tmp/pozo-p2-snapshots --chromium /usr/bin/chromium
python3 scripts/qa/reading_viewer.py --url http://127.0.0.1:4182/ --output /tmp/pozo-p2-lectura --chromium /usr/bin/chromium
~~~

## Pendiente P2b

Planificador compartido de proyección efectiva para motor, visor, plots y exportaciones; fuentes preparadas explícitas y sus bloqueos; consumidores de laboratorio y calibrationKey. Esta entrega no declara terminado todo P2 ni activa preparación, DRX o correcciones ambientales.
