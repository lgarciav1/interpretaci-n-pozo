/**
 * Pestaña «Digitalizar» del dock: resumen de la sesión actual y botón para abrir la mesa. También monta la mesa (un
 * portal a ventana completa): las pestañas del dock están siempre montadas, así la mesa se abre desde la paleta o la
 * columna del pozo sin tocar el armazón de la app.
 */
import { Badge, Button, EmptyState, StatusDot } from '../../../ui';
import { saveSession } from '../actions';
import { QUALITY_LABEL, QUALITY_TONE } from '../model/outputs';
import { openDigitizerDesk, useDigitizer } from '../store';
import { DigitizerDesk, useStepStates } from './Desk';
import { pickSessionFile } from './StepImage';
import { useDigitized } from './StepReview';
import { CurveSwatchDot } from './StepCurves';
import './digitizer.css';

function Summary() {
  const image = useDigitizer((s) => s.image);
  const states = useStepStates();
  const rows = useDigitized();
  if (!image) {
    return (
      <EmptyState
        size="sm"
        icon="pen"
        title="Digitalizá un registro escaneado"
        description="Cargá la imagen de un perfil (JPG, PNG o WebP), calibrala y trazá sus curvas para agregarlas al pozo o crear uno nuevo."
        actions={
          <>
            <Button size="sm" variant="primary" icon="expand-view" onClick={openDigitizerDesk} data-testid="digitizer-open-desk">
              Abrir mesa de digitalización
            </Button>
            <Button size="sm" variant="ghost" icon="folder" onClick={() => (openDigitizerDesk(), pickSessionFile())}>
              Abrir sesión…
            </Button>
          </>
        }
      />
    );
  }
  return (
    <div className="dz-dock">
      <div className="dz-dock__head">
        <div>
          <span className="ui-overline">Sesión actual</span>
          <div className="dz-dock__name">{image.name}</div>
          <div className="dz-muted num">
            {image.original.width.toLocaleString('es-AR')} × {image.original.height.toLocaleString('es-AR')} px
          </div>
        </div>
        <span className="dz-spacer" />
        <Button size="sm" variant="ghost" icon="save" onClick={saveSession}>
          Guardar sesión
        </Button>
        <Button size="sm" variant="primary" icon="expand-view" onClick={openDigitizerDesk} data-testid="digitizer-open-desk">
          Abrir mesa de digitalización
        </Button>
      </div>
      <ol className="dz-dock__steps">
        {states.map((s, i) => (
          <li key={s.id} className={`is-${s.status}`}>
            <span className="dz-dock__n num">{i + 1}</span>
            <span>{s.label}</span>
            <span className="dz-muted">{s.hint}</span>
          </li>
        ))}
      </ol>
      {rows.length > 0 && (
        <ul className="dz-dock__curves">
          {rows.map(({ curve, quality }) => (
            <li key={curve.id}>
              <CurveSwatchDot c={curve} />
              <strong>{curve.mnemonic}</strong>
              {quality && <StatusDot tone={QUALITY_TONE[quality.level]} label={`Calidad ${QUALITY_LABEL[quality.level].toLowerCase()}`} />}
              {quality && <Badge tone={QUALITY_TONE[quality.level]}>{QUALITY_LABEL[quality.level]}</Badge>}
              {quality && <span className="dz-muted num">cobertura {Math.round(quality.metrics.coverage * 100)} %</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DigitizerDockPanel() {
  return (
    <div className="dock-pad">
      <Summary />
      <DigitizerDesk />
    </div>
  );
}
