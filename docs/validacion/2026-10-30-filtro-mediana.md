# P3d · Filtro de mediana física reproducible

Base: #47, `e37b164a8c9bca68cf365a40ea772d204edafe3f`. Rama `codex/filtro-mediana-p3d`, apilada sin integrar PRs. [Contrato ADR 0039](../decisiones/0039-mediana-fisica-y-composicion.md).

## Resultado

Preparar datos ofrece una mediana móvil con radio MD y separación máxima explícitos. Usa entradas fijas, al menos tres muestras, vecinos de ambos lados y ventana física completa. Conserva bordes sin soporte y no rellena huecos. Nulos, exclusiones, saltos MD y fronteras de zona cortan segmentos. No se habilitan categorías, banderas, roles computados ni curvas de semántica desconocida.

Si ya existe interpolación aceptada, se filtra después de ella, propagando su influencia. No se agrega interpolación automáticamente. Las recetas con filtro usan esquema 3 de preparación dentro de v7; las recetas sin filtro conservan exactamente esquemas 1/2. Quitar filtro conserva las otras etapas; quitar interpolación conserva filtro/exclusiones. Nuevos archivos con filtro requieren esta versión de la aplicación: un lector anterior rechaza el esquema desconocido.

## Pruebas numéricas y de integración

La suite final cubre **2.751 pruebas en 159 archivos**, catorce nuevas. Typecheck, build y diff check aprobados. Casos nuevos:

- Ventana sobre [0,10,100,20,30], radio 1 m, grilla de 1 m: [0,10,20,30,30], QC [0,16,16,16,0]. El penúltimo resultado detecta una realimentación accidental del filtro: debe leer 100 original, no el 20 ya producido.
- Grilla irregular y soporte par: mediana de [10,100,20,40] = 30 en valores lineales. Referencia independiente por selección física y ordenación completa, sin reutilizar el algoritmo deslizante.
- Constantes de magnitud mínima/máxima positiva/negativa y pares con signos opuestos. La media de los dos centrales usa suma/2 cuando es finita y semisumas cuando la suma desborda; evita perder constantes diminutas por dividir primero y evita infinitos por sumar extremos grandes. También se verifica el redondeo subnormal del par MIN_VALUE/2·MIN_VALUE.
- Mínimo de soporte, tramo, separación máxima, nulos y exclusiones como barreras. Mover fronteras zonales invalida versión y caché. Fuera del soporte se conserva la entrada y no se agrega Filtered.
- Composición explícita interpolación → filtro, con QC 25 en un centro originalmente faltante, 24 en un centro finito con soporte interpolado y 16 sin estimaciones. La calidad usa copia fija para no propagar influencia recursivamente.
- Retirar filtro/interpolación, conservar máscaras, restaurar original explícito, no-op, undo/redo, guardar/reabrir y restaurar snapshots con recetas/orden/calidad, sin blobs derivados.
- Esquemas/configuraciones/roles inválidos, límite de 255 muestras, reserva de scratch en el presupuesto (100 bytes para cinco muestras; 99 rechazados), cancelación durante el filtrado sin cachear/publicar arrays parciales y bytes originales intactos.
- Canal MessageChannel real con motor, QC e informe coherentes; plan alterado, calidades imposibles, versiones mezcladas y valores no finitos rechazados.

## Navegador y exportación

Chromium real, HTML de producción por HTTP local, 1366×768. Los fixtures son el TP completo con **señal/hueco sintéticos explícitos**; no modifican datos del repositorio ni prueban que suavizar el TP real sea una decisión adecuada.

`scripts/qa/filtering.py` verifica:

1. Radio 0,05 m sin soporte: Aplicar bloqueado. Radio 0,16 m y separación máxima 0,2 m: cinco centros filtrados dentro del tramo elegido. Cambiar controles invalida el preview; cancelar mantiene Project/v6. Buscar/preview no ejecuta el motor principal.
2. Señal [0,10,20,100,30,40,50,60,70] → [0,10,20,30,40,40,50,60,70], con ventana de tres muestras y bordes conservados. Se comprueban **las 5.810 filas, cada GR original, cada valor preparado y cada QC** mediante un lector LAS independiente. Filtered se marca también cuando el valor coincide: cinco centros filtrados, dos valores cambiados en este caso.
3. Undo devuelve el LAS base; redo, reabrir en otro contexto y restaurar snapshot reproducen el preparado. Quitar filtro devuelve el original; esquema futuro rechazado sin cambiar el proyecto activo.
4. En una segunda entrada con interpolación aceptada: [0,10,NaN,100,30,40,50,60,70] → [0,10,55,55,40,40,50,60,70]. Se validan **QC 25, 24 y 16** muestra a muestra, conservando el NaN original. Quitar interpolación conserva la receta del filtro.
5. Un fixture con frontera de zona reduce los cinco centros elegibles a uno. Fallback offline sin Worker/SubtleCrypto reproduce valores y calidad. Sin excepciones de página.

Capturas [clara](../capturas/filtro-mediana/preview-light.png) y [oscura](../capturas/filtro-mediana/preview-dark.png) revisadas: comparación, estado y footer accesibles con scroll.

Pasaron además las regresiones P3a/P3b/P3c: máscara manual, originales/QC, full único por paquete incompleto, snapshots y offline; propuestas revisadas de espurios; interpolación, barreras, retirada de etapas y persistencia. Se conservan sus hashes y evidencias en el JSON de métricas. El primer intento del script nuevo encontró el servidor HTTP local apagado; se inició y se repitió el recorrido. No se cambió producto por ese error del entorno.

## Rendimiento y tamaño

Ensayo de identidad Node/Vite SSR sobre TP completo, una entrada de calentamiento y siete cambios secuenciales: medianas **53,07 → 51,83 ms** frente a #47 (razón **0,977×**, bajo 1,25). Misma huella científica `e9cb7cbe45d6ba0144dd225d22ffd975524f34dda4442df5beccbbdb5ce456fa`, con bytes y buffers de originales conservados. No demuestra una mejora general.

Evaluación del filtro sobre **100.000 muestras sintéticas**, ventanas de cinco puntos y siete radios distintos dentro del mismo soporte: mediana **73,50 ms**, con calentamiento separado de 78,93 ms. Cada cambio produce una versión nueva, sin hit de caché. Las 99.994 muestras elegibles y todos los valores coinciden con una referencia directa de cinco entradas ordenadas, independiente de la ventana deslizante. Buffers originales intactos; 2.000.000 bytes reservados para resultado + scratch por artefacto; 8.000.000 bytes retenidos en ocho versiones completas. No incluye petrofísica, Worker, UI ni el máximo soporte permitido de 255 puntos.

Ambos ensayos se ejecutaron secuencialmente, sin suite ni navegadores activos. [Evidencia y muestras completas](metricas/2026-10-30-filtro-mediana.json).

HTML final: **5.604.582 bytes**, +11.354 respecto de #47 (~0,203 %). SHA-256 `afd33fe1ccf2acf9cec900ae361734e7ced8784c820b5fa1babfeda8fc2313e8`. Sin dependencias nuevas. El serializer del checkout anterior de #47 rechazó explícitamente un proyecto nuevo con esquema 3 de preparación, como prevé el contrato.

## Reproducción

```sh
npm ci
npm test -- --maxWorkers=1
npm run typecheck
npm run build
node scripts/qa/filtering.mjs /tmp/filter-seed
python -m http.server 4178 --directory dist
# En otra terminal:
python scripts/qa/filtering.py --candidate index.html --seed /tmp/filter-seed --output /tmp/filter-browser
node scripts/qa/filtering-benchmark.mjs /tmp/filter-metric.json
node scripts/qa/preparation.mjs /tmp/identity.json identity
```

La medición identity se ejecuta desde base y candidato, con las mismas dependencias y sin suite/navegadores activos. Las regresiones usan semillas `archive_v7.mjs` para P3a/P3b e `interpolation.mjs` para P3c. Los scripts generan proyectos, descargas y evidencias locales.

## Límites

La mediana es por muestra, sin ponderación de espesor. Puede borrar capas delgadas, picos u otros cambios reales. No hay opción logarítmica, ventana parcial, cruce zonal ni categoría inferida a partir de números. Se requiere asignación correcta del rol. El máximo de 255 muestras es parte del método, no una selección parcial silenciosa.

El presupuesto de buffers incluye resultado y scratch, sin ser un techo global de proceso ni de vistas activas. Los ensayos de rendimiento no garantizan tiempos universales, latencia de navegador o comportamiento del máximo soporte posible. No se repitió toda la matriz visual de pantallas/tamaños/temas y file:// continúa sin verificar.

P3 permanece abierta: sigue alineación constante, otros métodos/dominios admitidos y sus validaciones; después DRX y correcciones físicas. No se cierran #31/#32/#34. Main y los PRs previos siguen sin integrar.
