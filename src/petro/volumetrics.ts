/**
 * Volumen de hidrocarburo in situ (método volumétrico, por zona).
 *
 * Unidades (SI): área en m², espesor equivalente h·φ·Sh en m, factor de volumen B en m³/m³ (= bbl/STB para el
 * petróleo, = ft³/scf para el gas). El resultado es un volumen en m³ a condiciones de SUPERFICIE (estándar).
 * Sin dato (NaN) → NaN. Entradas fuera de rango físico (área < 0, h·φ·Sh < 0, B ≤ 0) → NaN.
 *
 * Ecuaciones:
 *   V = A · (h·φ·Sh) / B          con  h·φ·Sh = Σ hᵢ·φᵢ·(1 − Swᵢ)  sobre el pay neto
 *   Petróleo   OOIP = A · hφSh / Bo        Gas   OGIP = A · hφSh / Bg
 *
 * Verificación de libro: 1 acre · 1 ft de hφSh = 1 con B = 1 → 43 560 ft³ = 7758,4 bbl (la constante «7758 bbl por
 * acre-pie» de la ingeniería de reservorios).
 *
 * Referencias: Dake, L.P. (1978), "Fundamentals of Reservoir Engineering", cap. 2 (7758 bbl/acre-ft);
 * Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16 (h·φ·Sh).
 */

/** Tipo de hidrocarburo de la zona. */
export type FluidKind = 'oil' | 'gas' | 'none';

/**
 * Volumen in situ a condiciones de superficie (m³): A·hφSh/B.
 * @param areaM2  área (m²), ≥ 0
 * @param hphiSh  Σ h·φ·Sh sobre el pay (m), ≥ 0
 * @param b       factor de volumen de formación (m³/m³), > 0; si no → NaN
 */
export function inPlaceVolume(areaM2: number, hphiSh: number, b: number): number {
  if (!(b > 0) || b === Infinity) return NaN;
  if (!(areaM2 >= 0) || areaM2 === Infinity || !(hphiSh >= 0) || hphiSh === Infinity) return NaN;
  return (areaM2 * hphiSh) / b;
}

/** Volúmenes in situ de una zona (m³ estándar). */
export interface InPlace {
  ooip: number;
  ogip: number;
}

/**
 * 'oil' → { ooip: V(Bo), ogip: 0 }; 'gas' → { ooip: 0, ogip: V(Bg) }; 'none' → { ooip: 0, ogip: 0 }.
 * @param fluid  tipo de hidrocarburo
 * @param areaM2 área (m²)
 * @param hphiSh Σ h·φ·Sh sobre el pay (m)
 * @param bo     factor de volumen del petróleo (m³/m³ = bbl/STB)
 * @param bg     factor de volumen del gas (m³/m³ = ft³/scf)
 */
export function zoneInPlace(fluid: FluidKind, areaM2: number, hphiSh: number, bo: number, bg: number): InPlace {
  switch (fluid) {
    case 'oil':
      return { ooip: inPlaceVolume(areaM2, hphiSh, bo), ogip: 0 };
    case 'gas':
      return { ooip: 0, ogip: inPlaceVolume(areaM2, hphiSh, bg) };
    default:
      return { ooip: 0, ogip: 0 };
  }
}
