# src/ml

Modelos de facies (ola 4). TypeScript puro: sin React, sin DOM, sin dependencias nuevas. Corre en Web Worker y en
Node/Vitest. Decisión de diseño y métricas: `docs/decisiones/0030-modelos-de-facies.md`.

## Qué hay

| Archivo | Contenido |
|---|---|
| `features.ts` | Características (GR, RHOB, NPHI, PEF, DTC, LOG_RDEP, CALI), alias FORCE↔TP, rangos físicos, log10, detección de NPHI en % |
| `lithology.ts` | 12 clases FORCE 2020 (códigos, nombres), matriz de penalización de la competencia |
| `forest.ts` | Random forest (entrenamiento por histogramas, faltantes con dirección aprendida, MDI) y `predictForest` |
| `serialize.ts` | Binario del modelo (ida y vuelta exacta) y texto zlib+base64 para incrustar en el build |
| `model/lithologyModels.ts` | **Generado**: los dos modelos entrenados con FORCE 2020 (`withPe`, `noPe`) |
| `embedded.ts` | Carga perezosa de los modelos embebidos y elección con/sin PE. **Fuera del barril `index.ts`** (arrastra ~0,9 MB): importar solo desde el Worker |
| `lithologyModel.ts` | `predictLithology`: curvas → clase, probabilidades, confianza |
| `electrofacies.ts`, `kmeans.ts`, `gmm.ts` | Electrofacies sin supervisión: k-means++ y mezcla gaussiana (EM, covarianza diagonal) |
| `importance.ts` | Importancia por permutación (función pura) |
| `validation.ts` | Folds por bloques de profundidad con buffer, leave-one-well-out, métricas, penalización FORCE, `crossValidate` |
| `rng.ts` | mulberry32 con semilla (nunca `Math.random`) |
| `index.ts` | API pública |

## API (desde `src/ml/index.ts`)

```ts
import { clusterElectrofacies, permutationImportance, depthBlockFolds } from '../ml';
// El modelo embebido (~0,9 MB) NO sale del barril `../ml`: importarlo solo desde el Web Worker, para que el hilo
// principal no lo arrastre al bundle.
import { predictLithologyEmbedded, getLithologyModel } from '../ml/embedded';

// 1. Litología con el modelo embebido. `curves` en las unidades de features.ts (resistividad en ohm·m, sin log;
//    neutrón en v/v o %, se detecta). Los nombres se pueden resolver con resolveCurveAliases({ GR, ZDEN, NPHI, PE, DT, AT90, CAL }).
const r = predictLithologyEmbedded(curves, { pe: 'auto' });   // 'auto' | 'use' | 'ignore'
r.classIndex;      // Int16Array n: índice de la clase ganadora en r.classes
r.classCode;       // Int32Array n: código FORCE (30000, 65000, ...)
r.probabilities;   // Float32Array n × 12 (fila a fila, suma 1, nunca NaN): p[i * r.nClasses + c]
r.confidence;      // Float32Array n: probabilidad de la clase ganadora
r.valid;           // Uint8Array n: 0 si la muestra no tenía datos suficientes (probabilidades = a priori)
r.classes;         // [{ index, code, name, label }]
r.variant;         // 'withPe' | 'noPe' y r.variantReason (texto para un aviso en la UI)
r.missingCurves;   // curvas que el modelo necesitaba y no se dieron

// 2. Electrofacies (sin etiquetas)
const e = clusterElectrofacies(curves, { k: 5, method: 'gmm' /* o 'kmeans' */, seed: 1 });
e.labels; e.probabilities /* n × k */; e.confidence; e.centers /* k × d, unidades originales */;
e.weights; e.counts; e.bic /* gmm */; e.inertia /* kmeans */;
scanClusterCount(curves, [2, 3, 4, 5, 6], { method: 'gmm' });  // elegir k

// 3. Importancia
modelImportance(getLithologyModel('noPe'));        // MDI guardada en el modelo (getLithologyModel: ../ml/embedded)
permutationImportance({ X, n, d, truth, nClasses, predict, metric: 'f1Macro', groups: wellIds });

// 4. Validación sin fuga
depthBlockFolds({ wellIds, depth, nFolds: 5, blockLength: 200, gap: 30 });
leaveOneWellOutFolds(wellIds);
crossValidate({ folds, truth, nClasses, fitPredict });   // exactitud, F1 macro, matriz de confusión, penalización FORCE
```

`serializeModel` / `deserializeModel` (binario) y `encodeModelText` / `decodeModelText` (zlib + base64) dan ida y vuelta
idéntica. Todo es determinístico con semilla.

## Reglas importantes

- La inferencia usa solo el modelo serializado; el dataset FORCE nunca entra al build.
- `chooseLithologyVariant(curves, 'auto')` usa el modelo sin PE si el PE es sospechoso de baritina
  (`detectSuspectPe`, decisión 0029): es lo que ocurre en el pozo del TP. Mostrar `variantReason` al usuario.
- Los modelos se entrenaron con pozos del Mar del Norte (Noruega). Aplicados a otra cuenca (el TP), la métrica de
  validación es optimista; ver «límites de la transferencia» en la decisión 0030. La salida es una **sugerencia** con
  probabilidad, no una litología medida.
- Funciones puras: no leen archivos ni el DOM. El `?raw` del CSV del TP solo se usa en los tests.

## Reentrenar el modelo (offline, a mano)

No corre en `npm test` ni en `npm run build`. Requiere Node ≥ 22.18 (con 22.6–22.17, agregar
`--experimental-strip-types`) y `train.csv` de FORCE 2020 (`datos/FORCE2020/lithology_competition/data/train.zip`,
280 MB descomprimido; **no copiarlo al repo**: extraerlo en un directorio vacío fuera del repo).

```bash
# Modelos finales -> src/ml/model/lithologyModels.ts (~25 s)
npm run ml:train -- --csv /ruta/a/train.csv --final --eval-csv /ruta/a/hidden_test.csv --report /tmp/final.md

# Validación cruzada con la misma configuración (azar, bloques de profundidad, leave-one-well-out; ~15 min por variante)
npm run ml:train -- --csv /ruta/a/train.csv --cv random,blocks,lowo --variants noPe --report /tmp/cv_noPe.md
npm run ml:train -- --csv /ruta/a/train.csv --cv random,blocks,lowo --variants withPe --report /tmp/cv_withPe.md
```

Opciones: `--trees 48 --depth 16 --min-leaf 60 --sample 120000 --bins 64 --mtry <n> --leaf-top 6 --class-power 0.25
--conf-weights 1,0.5,0.25 --seed 20201`, `--folds 5 --block 200 --gap 30 --lowo-group 1`, `--features-no-pe` y
`--features-with-pe` (listas de características). Con la configuración por defecto el resultado es byte a byte
reproducible. Después de reentrenar: `npm test` (el humo del modelo embebido verifica forma, rangos y tamaño < 1,5 MB)
y actualizar las métricas de la decisión 0030.

## Integración en la interfaz (10c, decisión 0031)

- Módulo `src/modules/lithology-facies/`: predicción en el Web Worker; el modelo solo entra al bundle del worker por la
  convención `*.worker-only.ts` / `*.main-thread.ts` (plugin `workerOnlyFiles` de `vite.config.ts`). Importar
  `embedded.ts` solo desde un archivo `*.worker-only.ts`.
- Pista «Litología (ML)» en Geología, selector «Uso del PE» con el aviso `variantReason`, panel con la importancia MDI.
- Módulos `electrofacies` y `electrofacies-scan` (k automático por el codo del BIC o la inercia), pista y panel.
- Pendiente: permutación bajo demanda sobre el pozo y calibración de probabilidades, cuando haya datos del TP.
