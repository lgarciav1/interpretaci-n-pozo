/** Paso 1 — Imagen: cargar desde archivo, arrastrar y soltar o pegar del portapapeles; o abrir una sesión. */
import { Button, Callout, FileDrop, Section } from '../../../ui';
import { IMAGE_ACCEPT, loadImage, openSession } from '../actions';
import { formatBytes } from '../model/sessionFile';
import { useDigitizer } from '../store';
import { Kv, StepIntro } from './common';

export function pickSessionFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void openSession(f);
  };
  input.click();
}

export function StepImage() {
  const image = useDigitizer((s) => s.image);
  return (
    <>
      <StepIntro>
        Cargá el registro escaneado o la imagen de un perfil ajeno. La mesa lo endereza, lo calibra en profundidad y escala, y traza las curvas por su color.
      </StepIntro>
      <FileDrop
        accept={IMAGE_ACCEPT}
        title={image ? 'Cambiar la imagen' : 'Soltá la imagen acá o hacé clic para elegirla'}
        description="JPG, PNG o WebP · también podés pegarla con Ctrl+V"
        icon="upload"
        inputTestId="digitizer-image-input"
        onFile={(f) => void loadImage(f, f.name)}
      />
      {image && (
        <Section title="Imagen actual">
          <Kv
            items={[
              ['Archivo', image.name],
              ['Tamaño', `${image.original.width.toLocaleString('es-AR')} × ${image.original.height.toLocaleString('es-AR')} px`],
              ['Peso', formatBytes(image.bytes.length)],
            ]}
          />
        </Section>
      )}
      <Section title="Sesión guardada">
        <p className="dz-muted">Una sesión guarda la imagen, la calibración y las trazas en un archivo aparte del proyecto.</p>
        <div>
          <Button size="sm" icon="folder" onClick={pickSessionFile}>
            Abrir sesión…
          </Button>
        </div>
      </Section>
      <Callout tone="info" title="Qué precisión esperar">
        Con escaneos de unos 20 px por metro, el error típico es del 1–2 % del rango de la escala; peor con ruido, cruces de curvas del mismo color o curvas muy dentadas. Revisá siempre las curvas digitalizadas antes de usarlas.
      </Callout>
    </>
  );
}
