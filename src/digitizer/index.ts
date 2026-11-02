/**
 * Log Digitizer — motor puro (fase 1). API pública. Docs: docs/decisiones/0062-log-digitizer-motor.md.
 *
 * Flujo típico (la interfaz de la fase 2 lo ejecuta, idealmente en un Web Worker):
 *   1. geometry:   estimateTiltAngle / rotateImage, rectifyQuad (o applyGeometry con los pasos de la sesión)
 *   2. calibration: buildDepthCalibration (amarres) y ValueFrame por curva (axisFromEdgeValues)
 *   3. color:      suggestCurveColors → CurveColorSpec
 *   4. digitizeCurve (pipeline): máscara → traceCurve → serie → calidad
 *   5. sampling:   resampleToUniform / resampleToIndex, medianFilter, removeSpikes
 *   6. integration: addDigitizedCurveToWell / createWellFromDigitized / digitizedExportInput (→ writeLas, writeCsv)
 *   7. session:    DigitizerSession serializable (serializeSession / parseSession)
 */
export * from './types';
export * from './errors';
export * from './calibration';
export * from './geometry';
export * from './color';
export * from './tracing';
export * from './sampling';
export * from './quality';
export * from './integration';
export * from './session';
export * from './pipeline';
