/**
 * Copia texto al portapapeles con respaldo para `file://` e iframes, donde `navigator.clipboard` suele estar
 * bloqueado: en ese caso usa una selección temporal y `document.execCommand('copy')`. Devuelve si pudo copiar.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sin permiso de portapapeles (file://, iframes): copia con una selección temporal.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
