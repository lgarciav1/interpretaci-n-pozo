/** Buffers de una sola etapa; filtro y remuestreo los reutilizan secuencialmente. */
export interface PreparationScratch { data: Float64Array; quality: Uint16Array }
