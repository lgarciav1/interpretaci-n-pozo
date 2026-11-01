/** Goldberg et al. (2004), Proc. ODP SR 191, cap. 6, p.10, ecuaciones 2–4.
 * Implementación propia del modelo empírico MGT; ninguna carta/dataset se redistribuye.
 * Dominio operativo conservador de esta versión: diámetro > OD 3,375 in y ≤42 cm.
 * Son guardas de implementación (geometría/límite de caliper de la referencia), NO un rango
 * experimental certificado. Incertidumbre cuantificada no publicada; no hay extrapolación.
 */
export const MGT_METHOD = Object.freeze({
  id: "odp-mgt-seawater-gr",
  version: 1,
  algorithmVersion: "goldberg-2004-eq2-4-v1",
  chartVersion: "sin carta interpolada; publicación ODP 2004",
  inputUnits: {
    gr: "gAPI",
    caliper: "in",
    temperature: "degC",
    pressure: "psi",
    ambientDepth: "m",
  },
  effects: ["borehole"],
  incompatibilities: [
    "otra herramienta",
    "pozo entubado",
    "lodo distinto de agua de mar",
    "corrección ambiental previa",
    "entradas preparadas o posiciones desconocidas",
  ],
  interpolation: "evaluación analítica, sin interpolación de cartas",
  outOfDomain: "NaN y QC128; sin extrapolación o fallback original",
  priorState:
    "GR total calibrado en gAPI, todavía sin corregir efecto del pozo",
  redistribution:
    "código propio y fixtures sintéticos independientes; ninguna carta, tabla, figura o dataset de terceros incorporado",
  validation:
    "tests/fixtures/mgt-known.json; cálculo independiente Python Decimal(50), no ensayo de campo",
  tool: "LDEO MGT",
  minDiameterIn: 3.375,
  maxDiameterIn: 42 / 2.54,
  maxTemperatureC: 100,
  maxPressurePsi: 10000,
  hardwareReference:
    "LDEO ODP Logging Services, MGT data sheet 11/2001, p.1: 100 °C y 10000 psi (límite más restrictivo frente a tabla del artículo).",
  hardwareUrl: "https://mlp.ldeo.columbia.edu/BRG/ODP/LEGACY/PDF/MGT.pdf",
  maxAmbientDepthM: 5000,
  reference:
    "Goldberg, Meltser, Myers y Masterson (2004), Proc. ODP Sci. Results 191, cap. 6, pp.5,10,18; ecuaciones 2–4.",
  url: "https://www-odp.tamu.edu/publications/191_SR/VOLUME/CHAPTERS/004.PDF",
  uncertainty:
    "Modelo empírico sin incertidumbre cuantificada publicada; precisión condicionada a caliper y calibración. Las guardas operativas no certifican un rango experimental.",
});
export type MgtPosition = "centered" | "eccentered";
export function mgtFactor(diameterIn: number, position: MgtPosition): number {
  const tolerance = 32 * Number.EPSILON * MGT_METHOD.maxDiameterIn;
  if (
    !Number.isFinite(diameterIn) ||
    diameterIn <= MGT_METHOD.minDiameterIn + tolerance ||
    diameterIn > MGT_METHOD.maxDiameterIn + tolerance ||
    !["centered", "eccentered"].includes(position)
  )
    return NaN;
  // Solo equivalencia de representación al convertir unidades, no extrapolación física.
  const t = 1.316 * Math.min(diameterIn, MGT_METHOD.maxDiameterIn) - 3.5;
  const factor =
    position === "centered"
      ? (((4.7e-6 * t - 2.45e-4) * t + 5.59e-3) * t - 1.31e-3) * t + 0.82
      : ((-8.22e-6 * t + 1.36e-4) * t + 2.44e-2) * t + 0.812;
  return Number.isFinite(factor) && factor > 0 ? factor : NaN;
}
export function mgtGamma(
  gr: number,
  diameterIn: number,
  position: MgtPosition,
): number {
  const value = gr * mgtFactor(diameterIn, position);
  return Number.isFinite(gr) && gr >= 0 && Number.isFinite(value) ? value : NaN;
}
