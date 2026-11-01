/**
 * Datos SCAL del TP (hoja SCAL del Excel de la cátedra). GENERADO por scripts/qa/tp-mdt-scal-data.py: no editar a mano.
 * - `TP_SCAL_DISPLACEMENT`: presión de desplazamiento (kg/cm²) de 8 muestras. `rootRaw` es la columna «RAIZ» de la
 *   hoja, que vale 10 veces √(k/φ%) (usa φ en fracción): no es comparable con `rootKPhi` de la tabla de garganta poral.
 * - `TP_SCAL_THROAT`: las mismas 8 muestras con k de gas (mD), φ (%) y √(k/φ%) de la tabla «diámetro de garganta
 *   poral» de la hoja.
 */
export const TP_SCAL_DISPLACEMENT: readonly { sample: string; rootRaw: number; displacementKgCm2: number }[] = [{"sample":"1-2","rootRaw":7.25902,"displacementKgCm2":3.88868},{"sample":"1-2L","rootRaw":9.15031,"displacementKgCm2":3.88868},{"sample":"1-32","rootRaw":19.95456,"displacementKgCm2":1.75978},{"sample":"1-33CK","rootRaw":9.60586,"displacementKgCm2":0.53715},{"sample":"1-33","rootRaw":15.34687,"displacementKgCm2":0.53715},{"sample":"2-15","rootRaw":9.89731,"displacementKgCm2":2.10991},{"sample":"2-17","rootRaw":7.59342,"displacementKgCm2":2.10991},{"sample":"2-6L","rootRaw":3.66099,"displacementKgCm2":7.02085}];
export const TP_SCAL_THROAT: readonly { sample: string; kGasMd: number; phiPct: number; rootKPhi: number }[] = [{"sample":"1-2","kGasMd":11.1,"phiPct":21.0653,"rootKPhi":0.7259},{"sample":"1-2L","kGasMd":17.8,"phiPct":21.2593,"rootKPhi":0.91503},{"sample":"1-32","kGasMd":92.4,"phiPct":23.2053,"rootKPhi":1.99546},{"sample":"1-33CK","kGasMd":19.6,"phiPct":21.2414,"rootKPhi":0.96059},{"sample":"1-33","kGasMd":54.6,"phiPct":23.1821,"rootKPhi":1.53469},{"sample":"2-15","kGasMd":17.2,"phiPct":17.5588,"rootKPhi":0.98973},{"sample":"2-17","kGasMd":9.4,"phiPct":16.3025,"rootKPhi":0.75934},{"sample":"2-6L","kGasMd":2.09,"phiPct":15.5937,"rootKPhi":0.3661}];
