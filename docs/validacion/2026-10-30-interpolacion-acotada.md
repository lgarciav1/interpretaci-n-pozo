# P3c · Interpolación lineal acotada de faltantes originales

Base: #46, `adf1b9049ec7a0cd67ea5d0e606e3f1afc12580e`. Rama `codex/interpolacion-acotada-p3c`, apilada sin integrar PRs. [Contrato ADR 0038](../decisiones/0038-interpolacion-lineal-acotada.md).

## Resultado y compatibilidad

Preparar datos permite estimar huecos cortos entre mediciones originales, dentro de un tramo MD y una distancia máxima entre anclajes explícitos. No extrapola, no cambia valores finitos, no rellena exclusiones y no cruza fronteras de zona. Se bloquean categorías, banderas, roles computados y curvas sin rol reconocido. La interpolación se realiza en los valores de la curva, también cuando el visor usa escala log.

Se guardan método/tramo/límite junto con las exclusiones conservadas y las zonas de interpretación. Las estimaciones llevan QC 9 = faltante original + interpolada. La comparación las identifica, el informe declara método y alcance, y la exportación conserva sus valores y calidad. Las curvas medidas originales siguen accesibles.

Las máscaras existentes conservan receta/esquema 1 y claves anteriores. Sólo la interpolación requiere esquema **2 de preparación**, dentro del mismo contenedor v7. Una aplicación anterior rechazará esos archivos nuevos por esquema desconocido; no los abrirá perdiendo decisiones. Se mantiene lectura de proyectos y máscaras previos. Quitar sólo interpolación conserva máscaras e id de salida y vuelve al esquema mínimo necesario. No se activa v7 al cancelar el preview.

## Verificación numérica y de estado

**2.737 pruebas en 158 archivos**, quince nuevas. Suite final completa aprobada, sin fallos ni omisiones; typecheck, build y diff check aprobados. Incluye:

- Grilla irregular MD [0,1,3,6], valores [10,NaN,NaN,22]: resultado independiente esperado [10,12,16,22], calidad [0,9,9,0]. El máximo se mide entre los anclajes, con igualdad incluida.
- Huecos demasiado largos, extremos y anclajes fuera del tramo permanecen sin dato; no se sustituyen finitos. Exclusiones sobre mediciones o faltantes bloquean el hueco entero.
- Fronteras de zona, caso de frontera en un anclaje y caché invalidada al moverlas. Se respeta la regla (a,b] del ADR, sin habilitar atravesarlas.
- Restricción a roles medidos del catálogo y unidades compatibles; rechazo de banderas/categorías/roles desconocidos. Configuración, referencias, esquema futuro y calidad/valores incoherentes se rechazan.
- Ceros con signo, valores extremos sin desbordamiento en el caso probado y bytes originales intactos. Cancelación durante el rellenado de un hueco de 50.000 muestras sin publicar/cachear arrays parciales.
- Lote y fuente en un undo/redo; no-op, límites en la versión del artefacto, datos de entrada cambiados bloqueados, quitar interpolación conservando máscara y restaurar todo volviendo explícitamente a original.
- Guardar/reabrir v7 y restaurar snapshot reproducen método/calidad/valores sin blobs derivados. Un canal MessageChannel real publica motor y estimaciones juntos; otro rechaza límites alterados en tránsito. Exportación QC e informe usan ese mismo contexto.

Los controles de protocolo previos siguen cubiertos por sus pruebas. No se modificaron ecuaciones petrofísicas ni modelos ML. El evaluador mantiene LRU por bytes y cancelación por bloques sin un tercer array del tamaño del pozo para interpolar; ese presupuesto no limita toda la memoria del proceso.

## Recorrido de navegador

Chromium real, HTML de producción por HTTP local, 1366×768. El seed usa el TP completo y **huecos sintéticos explícitos**, sin modificar datos del repositorio: dos NaN entre anclajes 10/22, once NaN en un hueco más largo y faltantes en los extremos. No son mediciones históricas adicionales ni evidencia de que interpolar el TP real sea apropiado.

`scripts/qa/interpolation.py` verifica:

1. Con máximo 0,3 m no hay huecos elegibles y Aplicar está deshabilitado. Con 1 m se estiman sólo dos muestras: **14 y 18**; la comparación las marca como estimadas. La búsqueda/preview no ejecuta el motor principal; cambiar el límite invalida la propuesta y cancelar conserva Project y v6.
2. Aceptar mantiene las **5.810 filas y cada GR original**. Las dos estimaciones exportan QC 9; las otras muestras, el hueco largo y los extremos conservan sus valores/calidad. Se valida muestra por muestra mediante un lector LAS independiente del producto.
3. Undo devuelve el LAS base; redo, guardar/reabrir en otro contexto y restaurar snapshot devuelven el LAS preparado. Una exclusión sobre uno de los faltantes bloquea todo ese hueco. Quitar interpolación conserva la exclusión como máscara v1; restaurar original devuelve el LAS base.
4. Un esquema futuro se rechaza sin cambiar el proyecto activo. Fallback offline sin Worker/SubtleCrypto reproduce originales, preparadas y QC. Un segundo fixture con una frontera de zona dentro del hueco bloquea el relleno y Aplicar.
5. Sin excepciones de página. Capturas [clara](../capturas/interpolacion-acotada/preview-light.png) y [oscura](../capturas/interpolacion-acotada/preview-dark.png) revisadas; muestras/estado y footer legibles con scroll del diálogo.

También se recorren las regresiones de P3a y P3b: exclusiones manuales, calidad y originales, recuperación full única, snapshots, fallback offline y propuestas revisadas de espurios. Los resultados y hashes se archivan en el JSON de evidencia.

## Rendimiento y tamaño

El mismo ensayo Node/Vite SSR de identidad sobre TP completo, 1 warmup y siete cambios secuenciales, dio medianas **59,66 → 52,85 ms** frente a #46 (razón **0,886×**, umbral 1,25). Misma huella científica `e9cb7cbe45d6ba0144dd225d22ffd975524f34dda4442df5beccbbdb5ce456fa`, con bytes y buffers originales conservados. Ambas rondas se ejecutaron sin suite ni navegadores activos. La diferencia de esta ronda no demuestra una mejora general ni mide la interpolación o la latencia de Worker/UI.

HTML final: **5.593.228 bytes**, +19.997 respecto de #46 (~0,359 %). SHA-256 `32c5e6466c95798c1643312ece1223d529f56e66f8d6cac386e2467fc29accab`. Sin dependencias nuevas. El serializer del checkout anterior de #46 también se ejecutó contra el archivo nuevo: rechazó el esquema de preparación 2 explícitamente, como prevé el contrato.

[Resultados de navegador, compatibilidad y muestras de rendimiento](metricas/2026-10-30-interpolacion-acotada.json).

## Reproducción

```sh
npm ci
npm test -- --maxWorkers=1
npm run typecheck
npm run build
node scripts/qa/interpolation.mjs /tmp/p3c-seed
python -m http.server 4178 --directory dist
# En otra terminal:
python scripts/qa/interpolation.py --candidate index.html --seed /tmp/p3c-seed --output /tmp/p3c-browser
# Semilla del TP con laboratorio para regresiones previas:
node scripts/qa/archive_v7.mjs /tmp/p3c-regression-seed
python scripts/qa/preparation.py --candidate index.html --seed /tmp/p3c-regression-seed --output /tmp/p3c-mask
python scripts/qa/suspects.py --candidate index.html --seed /tmp/p3c-regression-seed --output /tmp/p3c-suspects
node scripts/qa/preparation.mjs /tmp/identity.json identity
```

La última medición se ejecuta desde base/candidato con las mismas dependencias, sin suite/navegadores activos. No mide detector/interpolación ni latencia UI/Worker. No se promete rendimiento en el equipo objetivo.

## Límites

La hipótesis de linealidad puede ocultar transiciones reales. No se permite interpolar categorías o curvas de semántica desconocida ni cruzar zonas mediante una opción implícita. Se requiere asignación correcta del rol; no se detecta automáticamente una categoría mal declarada como perfil medido. No hay transformación logarítmica, estimación de incertidumbre, relleno de datos descartados ni reemplazo de espurios finitos.

No se repitió la matriz visual amplia de todas las pantallas/tamaños/temas ni se verificó file://. Continúan filtros, alineación constante, otros métodos, DRX y correcciones físicas; P3 completa permanece abierta. Main y los PRs previos permanecen sin integrar.
