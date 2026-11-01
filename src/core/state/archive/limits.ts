/** Límites del lector: se pueden reducir para un equipo/prueba, nunca ampliar silenciosamente. */
export interface ArchiveLimits { fileBytes: number; totalBytes: number; arrayBytes: number }
export const ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({ fileBytes: 64 * 1024 ** 2, totalBytes: 512 * 1024 ** 2, arrayBytes: 128 * 1024 ** 2 });
export class ArchiveLimitError extends Error {}
export function archiveLimits(value: Partial<ArchiveLimits> = {}): ArchiveLimits {
  const result = { ...ARCHIVE_LIMITS };
  for (const [key, n] of Object.entries(value)) {
    if (!(key in result) || !Number.isSafeInteger(n) || n! < 0 || n! > ARCHIVE_LIMITS[key as keyof ArchiveLimits]) throw new ArchiveLimitError('Límites de archivo inválidos.');
    result[key as keyof ArchiveLimits] = n!;
  }
  return result;
}
export function checkFileSize(text: string, limit: number): void {
  if (text.length > limit) throw new ArchiveLimitError('El proyecto supera el límite de tamaño de archivo.');
  // Sin otra copia del archivo completo en memoria. UTF-8 usa 1–4 bytes por carácter.
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > limit) throw new ArchiveLimitError('El proyecto supera el límite de tamaño UTF-8.');
  }
}
export class DecodeBudget {
  private used = 0;
  constructor(readonly limits: ArchiveLimits = archiveLimits()) {}
  reserve(length: number): number {
    if (!Number.isSafeInteger(length) || length < 0 || length > Number.MAX_SAFE_INTEGER / 8) throw new ArchiveLimitError('Longitud de array inválida o fuera de límite.');
    const bytes = length * 8;
    if (bytes > this.limits.arrayBytes || this.used + bytes > this.limits.totalBytes) throw new ArchiveLimitError('El proyecto supera el límite de datos descomprimidos.');
    this.used += bytes;
    return bytes;
  }
}
