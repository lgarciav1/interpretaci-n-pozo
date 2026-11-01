# Contratos y corpus de compatibilidad para revisiones de entradas

Fecha: 2026-10-28. Base: PR #38, commit eecad95a60b389c7ff4e847a2bbdffd397bbc763. Continúa el masterplan #33, antes de implementar P1. Sin cambios en src, dependencias, formato vigente o interfaz.

## Entrega concreta

- [ADR 0033](../decisiones/0033-revisiones-de-entradas-y-compatibilidad.md): esquema de revisiones y adquisición, alias de Well, snapshots fijados, almacenamiento v7 previsto con blobs, migración v1–v6, integridad, límites y separación del contexto futuro P2.
- [Corpus fijo](../../tests/fixtures/projects/README.md): seis archivos sintéticos reconstruidos desde los contratos de versiones anteriores, codificados independientemente del serializer de la app. No son archivos históricos de usuarios.
- [Pruebas](../../tests/compat/legacy-projects.test.ts): 33 comprobaciones de apertura, migraciones, datos bit a bit, fuentes activas, cálculo, tres codecs, guardado/reapertura, snapshots sin cambiar entradas, undo/redo, corrupción, multipozo y no-op.
- [Medidor reproducible](../../scripts/qa/project_baseline.mjs) y [salida completa](metricas/2026-10-28-proyecto-base.json).

## Decisión importante sobre snapshots

Los snapshots actuales guardan Interpretation; no guardan una revisión histórica del Well, curvas o PointSet. Restaurarlos no puede recuperar entradas que se hayan reemplazado antes de guardar el archivo. La migración propuesta crea una revisión de las entradas disponibles y declara la asociación heredada mediante inputBinding=legacy-current-inputs. Los nuevos snapshots fijarán su revisión con inputBinding=pinned.

Esta entrega no presenta como resuelto ese límite: P1 implementará las revisiones y tendrá que probar importar/cambiar laboratorio después de un snapshot, restaurar/comparar, guardar/abrir y recuperar los datos correctos.

## Inventario inicial del TP para preparación

Fuente: datos/README.md, CSV incluido, catálogo de herramientas y sus fichas. La atribución de familia no acredita el modelo ni las correcciones aplicadas durante adquisición.

| Familia / datos disponibles | Límite conocido | Evidencia que falta para corregir |
|---|---|---|
| GR y espectral: GR, URAN, THOR, POTA | Curvas y unidades disponibles | Corrida, fabricante/modelo, calibración y correcciones previas |
| Geometría: BS, CAL | Trépano 8,5 in; caliper inválido en 189 muestras según inventario del TP | Calidad por corrida, centralización y geometría real; caliper solo no determina toda la rugosidad |
| Densidad/PE/neutrón: ZDEN, PE, NPHI | NPHI con picos imposibles; PE sospechoso de baritina | Modelo de herramienta, lodo, revoque, standoff y curvas auxiliares de corrección disponibles |
| Inducción: AT10/30/60/90 | Varias profundidades de investigación y picos en AT10 | Modelo/respuesta, Rm/Rmf, temperatura, historia de corrección y condiciones para analizar invasión |
| Sónico: DT | 70 muestras sin dato | Modelo, condiciones, forma de onda/indicadores si existen y correcciones adquiridas |
| RMN: PHI_BVI, PHIE_CMR, PHIT_CMR | Salidas de herramienta; no son el espectro T2 ni ecos crudos | Procesamiento, parámetros de adquisición y modelo; no reconstituir T2 desde estas curvas |
| SP | Solo 12 muestras con dato | No habilitar estimación de Rw desde SP como si el registro fuera continuo |
| Laboratorio | Corpus sintético de MDT/corona para compatibilidad; sin DRX real incorporado | Archivo DRX, base masa/volumen/roca total/fracción arcilla, intervalos, incertidumbre y datum |
| Lodo | No hay composición/salinidad/temperaturas confirmadas en el corpus | Rm/Rmf/Rmc a temperatura, salinidad y base declarada; tipo de lodo y baritina por confirmar |

No se habilita ninguna corrección ambiental por este inventario. La sospecha de baritina es diagnóstico del README, no confirmación de composición. Desconocidos quedan explícitos en adquisición; el catálogo científico y cada método con casos independientes pertenecen a P6/P7. Esto no bloquea las revisiones y la preparación básica P1–P3.

## Métricas base, alcance y límites

Node v24.19.0, Linux x64, INTEL(R) XEON(R) PLATINUM 8573C, 3 CPU lógicas observadas. Vite SSR, TP de 5.810 muestras, 18 curvas y cinco zonas. Una vuelta de calentamiento y cinco medidas. Importación e inicialización del registro fuera de los tiempos. No hay reutilización de caché entre corridas computeOnce.

| Operación | Mediana | Máximo de cinco |
|---|---:|---:|
| Guardar con codec auto | 52.47 ms | 66.64 ms |
| Abrir | 6.87 ms | 16.41 ms |
| Cálculo completo sin caché | 905.64 ms | 913.19 ms |

Archivo v6 con codec auto: 290153 bytes. Proceso completo con Vite/modelos cargados: RSS máximo muestreado 468.52 MiB; ArrayBuffers máximo muestreado 41.15 MiB. Son muestras del proceso, no su pico real ni memoria atribuible al proyecto. Los datos de CPU/memoria reportados por el sistema no son una garantía de recursos disponibles.

Una ejecución inicial produjo medianas diferentes (guardar ≈37 ms frente a ≈52 ms en la registrada), lo que confirma ruido del entorno compartido. No usar estos números como umbrales absolutos de CI. El ADR fija cómo comparar base/candidato alternados en el mismo entorno; no se midió latencia de interacción en navegador, Web Worker, hardware objetivo ni file://.

## Verificación y estado de P0

Suite completa: **2.451 pruebas en 148 archivos**, sin fallos ni omisiones; incluye los 33 casos nuevos. Typecheck y build aprobados. El HTML generado es idéntico byte a byte al build previo del PR #38 (5.415.233 bytes), con SHA-256 `feff041b73ab6c9f06c233ba4545cac992a49fc546f78b75536e49ca035999ef`. No se repitió el recorrido visual porque no hay cambios de producción y el artefacto es idéntico. El formato de producción permanece v6: ningún archivo se migra automáticamente a v7. Las pruebas caracterizan el comportamiento disponible; los nuevos contratos todavía no son APIs implementadas.

Esta entrega aporta fixtures, contratos, inventario inicial y métricas a P0. No declara terminados todo P0 ni el masterplan: faltan proyectos históricos reales adicionales, información de adquisición y medición en el equipo/navegador objetivo. La falta de datos ambientales limita la admisión de métodos físicos, no el desarrollo de revisiones.

## Reproducir

~~~sh
npm test -- tests/compat/legacy-projects.test.ts --maxWorkers=1
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/project_baseline.mjs /tmp/pozo-project-baseline.json
~~~

Ejecutar el medidor después de terminar la suite para reducir competencia de CPU. Usa Vite ya instalado como herramienta de desarrollo; no agrega dependencias ni servidor a la aplicación distribuida.

## Siguiente entrega

P1 implementará revisiones, snapshots fijados, guardar/abrir y validación v7, migración de este corpus y resolución de la revisión en comparación aislada. Se agregará un corpus v7 sin regenerar ni reemplazar estos archivos v1–v6. Limpieza, calibración DRX y correcciones continuarán en entregas separadas. Se puede continuar desde esta rama sin integrar los PRs anteriores.
