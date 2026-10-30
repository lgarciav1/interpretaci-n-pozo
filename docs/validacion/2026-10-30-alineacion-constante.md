# P3e · Alineación constante manual en MD

Base: #48, `d85c599b91043c7788724160f74de4c84609450f`. Rama `codex/alineacion-constante-p3e`, apilada sin integrar PRs. [Contrato ADR 0040](../decisiones/0040-alineacion-constante-md.md).

## Resultado y alcance

Preparar datos permite desplazar una curva completa en MD y remuestrearla al índice maestro, con referencia/datum declarados, hueco máximo y preview. Positivo mueve un evento más profundo; negativo lo mueve más somero. Se conservan originales, otras curvas, índice y laboratorio. No extrapola ni rellena huecos/exclusiones de forma implícita. Se aplica después de las otras etapas, conserva su calidad y permite retirarlas por separado.

Es alineación **manual por curva**, no aplicación conjunta por corrida inferida ni correlación. No valida pertinencia geológica ni transforma datums/MD/TVD. Un datum conocido incompatible o referencia diferente se rechaza. Si adquisición desconoce el datum, sigue desconociéndolo: se guarda una declaración del usuario en la receta, con observaciones de referencia separadas en el binding.

Las recetas con alineación usan esquema 4 de preparación dentro del archivo v7. Sin alineación se conservan esquemas 1/2/3 y sus claves. Retirar etapas usa el esquema mínimo necesario. El lector anterior de #48 rechaza estos archivos nuevos por esquema desconocido, evitando perder decisiones. Los proyectos sin preparación/revisiones mantienen v6.

## Pruebas

La suite completa aprobó **2.766 pruebas en 160 archivos**, quince nuevas. Tras aclarar el MD de origen de los controles de tramo se repitieron las quince pruebas de alineación, typecheck y build; todo aprobado, igual que diff check. El cambio posterior de UI sólo agrega esa aclaración. Los casos cubren:

- Evento [0,0,100,0,0,0]: +2 m → [NaN,NaN,0,0,100,0]; -2 m → [100,0,0,0,NaN,NaN]. Sin extrapolación ni acumulación de cambios sucesivos de desplazamiento.
- Grilla irregular MD [0,1,3,6], curva [10,12,16,22], +0,5 m → [NaN,11,15,21], QC [160,40,40,40]. Máximo inclusivo entre anclajes; un máximo inferior bloquea ese hueco, sin afectar coincidencias exactas.
- Paso decimal de 0,1524 m en torno a MD 7633: +0,3048 m copia exactamente dos muestras más abajo, con QC 32 y sin bordes perdidos por redondeo. El snap numérico limitado y la comprobación de eje monótono están definidos en el ADR.
- NaN/exclusiones trasladados, soportes candidatos inválidos, fronteras zonales destino y coincidencias exactas que pueden mover observaciones entre zonas. Excluir después de aceptar la alineación sigue usando MD de origen.
- Índice/otras curvas/bytes originales/laboratorio intactos; herencia de herramienta; composición exclusión → interpolación → filtro → alineación; retirada y edición de etapas sin perder las restantes. Conteos previos separados de las salidas alineadas.
- Referencia/MD/TVD/datum incompatibles, cero/infinitos/configuración futura rechazados; adquisición desconocida no inventada; cambio posterior de datum conocido bloqueado; colapso del eje por desplazamiento enorme y cobertura vacía detectados.
- Persistencia/snapshots, no-op y undo/redo atómicos; presupuesto de un solo scratch compartido por filtro/alineación, cancelación durante remuestreo sin cachear parciales.
- Versiones, flags, valores y conteos incoherentes rechazados; claves de contexto/evidencia distintas al cambiar desplazamiento, máximo o zonas; entradas modificadas bloqueadas. Un canal MessageChannel real publica motor/alineación/QC/informe juntos y rechaza un desplazamiento alterado en tránsito. El informe conserva parámetros de las etapas previas; exportación declara transformación/referencia/datum.

El primer ensayo de clave de calibración no incluía laboratorio y fue rechazado correctamente por su contrato. Se corrigió el fixture agregando un conjunto puntual sintético válido; no se debilitó la validación del producto.

## Navegador

Chromium real sobre HTML de producción, HTTP local, 1366×768. El TP contiene un **evento y punto de laboratorio sintéticos explícitos**; no modifica archivos del repositorio ni valida que el TP real deba moverse.

`scripts/qa/alignment.py` comprueba:

1. Declaración de referencia obligatoria antes de previsualizar. Preview sin cambiar Project/v6 ni ejecutar el motor principal; cambiar desplazamiento lo invalida y cancelar conserva el proyecto.
2. +0,3048 m mueve el evento de la muestra **1000 a la 1002**. Se verifican las **5.810 filas, cada GR original, una curva de resistividad independiente y el índice maestro**, fila a fila. Las dos primeras salidas quedan sin soporte, el resto copia su origen con QC 32 (o su faltante de origen si corresponde). La profundidad de laboratorio permanece en su valor original, comprobada decodificando el blob v7.
3. Undo devuelve el LAS base; redo, reabrir en otro contexto y restaurar snapshot reproducen el alineado. Cambiar a -0,3048 m toma la muestra original dos filas más abajo, sin acumular desplazamientos. Quitar alineación recupera el LAS original.
4. Esquema futuro rechazado sin publicar; datum conocido KB frente a declaración RT rechazado sin modificar el proyecto. La declaración no convierte adquisición desconocida en conocida.
5. Fallback offline sin Worker/SubtleCrypto reproduce originales, alineadas y QC. Sin excepciones de página.

Capturas [clara](../capturas/alineacion-constante/preview-light.png) y [oscura](../capturas/alineacion-constante/preview-dark.png) revisadas: comparación muestra el evento trasladado, cobertura y significado de flags, con footer accesible. La UI avisa que las etapas previas usan MD de origen y no convierte automáticamente el rango visible destino.

Se recorren también P3a/P3b/P3c/P3d: exclusiones y QC, recuperación full única, propuestas de espurios, interpolación y filtro, retirada de etapas, recetas/snapshots, esquemas futuros y offline. Evidencias y hashes se archivan en el JSON de métricas.

## Rendimiento y tamaño

Ensayo de identidad Node/Vite SSR sobre TP completo, un calentamiento y siete cambios secuenciales: medianas **57,85 → 62,50 ms** frente a #48 (razón **1,080×**, bajo 1,25). Misma huella científica `e9cb7cbe45d6ba0144dd225d22ffd975524f34dda4442df5beccbbdb5ce456fa`, con bytes/buffers originales intactos. Se conserva la variación de las muestras, sin inferir velocidad universal ni mejora.

Alineación de **100.000 muestras sintéticas** con desplazamientos enteros distintos, sin hits de caché: mediana **67,37 ms** tras calentamiento separado de 77,89 ms. Una evaluación fraccionaria de +0,5 m dio 78,37 ms. Todas las salidas exactas y fraccionarias coinciden con referencias directas independientes, originales intactos. Resultado + scratch compartido: 2.000.000 bytes por artefacto; nueve versiones completas retienen 9.000.000 bytes en caché. No incluye petrofísica, Worker ni UI; no garantiza otros tamaños, hardware, grillas o combinaciones de etapas.

Los ensayos se ejecutaron secuencialmente sin suite ni navegadores activos. [Evidencias y muestras completas](metricas/2026-10-30-alineacion-constante.json).

HTML final: **5.621.559 bytes**, +16.977 respecto de #48 (~0,303 %). SHA-256 `6f0a09440dc64e7da9d7871bbe76f1918a95e58eea0720096f728a5fff2bcf37`. Sin dependencias nuevas. El serializer del checkout #48 rechazó un proyecto con preparación 4 por esquema desconocido, como prevé el contrato.

## Reproducir

```sh
npm ci
npm test -- --maxWorkers=1
npm run typecheck
npm run build
node scripts/qa/alignment.mjs /tmp/alignment-seed
python -m http.server 4178 --directory dist
# En otra terminal:
python scripts/qa/alignment.py --candidate index.html --seed /tmp/alignment-seed --output /tmp/alignment-browser
node scripts/qa/alignment-benchmark.mjs /tmp/alignment-metric.json
node scripts/qa/preparation.mjs /tmp/identity.json identity
```

Para regresiones se usan las semillas previas de archive_v7.mjs, interpolation.mjs y filtering.mjs. La medición identity se repite desde base y candidato con las mismas dependencias, sin suite/navegadores activos.

## Límites

Manual y por curva. No se desplaza una corrida completa automáticamente, no se cambian profundidades del laboratorio y no se ofrecen correlación, anclas, tramos con distintos desplazamientos, datum diferente ni TVD. La cobertura fuera de la grilla se pierde sólo en la proyección; originales y decisiones permanecen. Los flags alineados describen soporte de origen, no el valor crudo de esa fila destino.

Los ensayos sintéticos no prueban calibración geológica ni exactitud física mayor que la representación numérica. La interpolación lineal puede atenuar señales. El presupuesto de buffers no limita la memoria global ni las vistas activas/transferencias/GC. No se repitió toda la matriz visual y file:// continúa sin verificar.

Siguen pendientes agrupado por corrida y puertas de cierre de P3; después DRX y correcciones físicas admitidas. No se cierran #31/#32/#34. Ningún PR previo se integra y main permanece intacto.
