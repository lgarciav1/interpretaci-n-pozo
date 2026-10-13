/**
 * Modelos de facies (ola 4): random forest de litología entrenado con FORCE 2020, electrofacies sin supervisión,
 * importancia de curvas y validación por tramos de profundidad. API pública del módulo; ver `README.md`.
 *
 * Todo es TypeScript puro (sin React ni DOM) y corre en Web Worker y en Node.
 */

export { FEATURES, CURVE_ALIASES, buildFeatureMatrix, resolveCurveAliases, nphiIsPercent, featureValue } from './features.ts';
export type { CurveKey, FeatureName, FeatureDef, ModelCurves, FeatureMatrix, FeatureOptions, NphiUnit } from './features.ts';

export { LITHOLOGY_CLASSES, FORCE_PENALTY_MATRIX, lithologyIndexOfCode } from './lithology.ts';
export type { LithologyClass } from './lithology.ts';

export { trainRandomForest, predictForest, argmaxRows, leafCount } from './forest.ts';
export type { ForestModel, ForestOptions, ForestPrediction, TrainingMatrix, PredictOptions } from './forest.ts';

export { predictLithology, modelClasses, modelImportance } from './lithologyModel.ts';
export type { LithologyPrediction, LithologyPredictOptions } from './lithologyModel.ts';

export { getLithologyModel, chooseLithologyVariant, predictLithologyEmbedded } from './embedded.ts';
export type { LithologyVariant, PeUsage, VariantChoice } from './embedded.ts';

export { serializeModel, deserializeModel, encodeModelText, decodeModelText } from './serialize.ts';

export { clusterElectrofacies, clusterMatrix, scanClusterCount, robustStandardize, DEFAULT_CLUSTER_FEATURES } from './electrofacies.ts';
export type { ElectrofaciesOptions, ElectrofaciesResult, ClusterMethod, ClusterScanRow } from './electrofacies.ts';
export { kmeans } from './kmeans.ts';
export type { KMeansOptions, KMeansResult } from './kmeans.ts';
export { gmm } from './gmm.ts';
export type { GmmOptions, GmmResult } from './gmm.ts';

export { permutationImportance } from './importance.ts';
export type { PermutationImportanceOptions, PermutationImportanceResult, ImportanceMetric } from './importance.ts';

export { depthBlockFolds, leaveOneWellOutFolds, crossValidate, forestFitPredict, confusionMatrix, evaluatePredictions, metricsFromConfusion } from './validation.ts';
export type { Fold, DepthBlockOptions, CrossValidateOptions, CrossValidationResult, FoldResult, Metrics, ClassMetrics } from './validation.ts';

export { mulberry32, deriveSeed } from './rng.ts';
