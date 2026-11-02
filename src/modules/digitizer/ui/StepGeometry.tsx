/** Paso 2 — Geometría: inclinación (2 puntos) y, opcional, perspectiva (4 esquinas), con vista previa y «omitir». */
import { estimateTiltAngle } from '../../../digitizer';
import { Badge, Button, Callout, Section } from '../../../ui';
import { formatNumber } from '../../../ui/format';
import { applyGeometryPicks, hasDownstreamWork, resetGeometry, skipGeometry } from '../actions';
import { useDigitizer } from '../store';
import { StepIntro, ToolButton } from './common';

export function StepGeometry() {
  const picks = useDigitizer((s) => s.picks);
  const geometry = useDigitizer((s) => s.geometry);
  const skipped = useDigitizer((s) => s.geometrySkipped);
  const job = useDigitizer((s) => s.job);
  const set = useDigitizer((s) => s.set);
  useDigitizer((s) => s.work);
  let angle: number | null = null;
  let angleError: string | null = null;
  if (picks.tilt.length === 2) {
    try {
      angle = (estimateTiltAngle(picks.tilt[0]!, picks.tilt[1]!) * 180) / Math.PI;
    } catch (e) {
      angleError = e instanceof Error ? e.message : String(e);
    }
  }
  const ready = (picks.tilt.length === 2 && !angleError) || picks.quad.length === 4;
  const rotation = geometry.find((g) => g.kind === 'rotate');
  const perspective = geometry.some((g) => g.kind === 'perspective');
  const downstream = hasDownstreamWork();

  return (
    <>
      <StepIntro>Si el escaneo quedó torcido, enderezalo: la profundidad y los valores se leen por filas y columnas de la imagen corregida.</StepIntro>
      {geometry.length > 0 && (
        <Callout tone="ok" title="Imagen corregida">
          {rotation && rotation.kind === 'rotate' ? `Rotación ${formatNumber((rotation.angleRad * 180) / Math.PI, { digits: 2 })}°` : 'Sin rotación'}
          {perspective ? ' · perspectiva rectificada' : ''}. Compará con «Original» en la barra del lienzo.
        </Callout>
      )}
      {skipped && geometry.length === 0 && <Callout tone="info">Sin corrección geométrica: la imagen se usa tal cual.</Callout>}

      <Section title="Inclinación" meta={<Badge tone={picks.tilt.length === 2 ? 'accent' : 'neutral'}>{picks.tilt.length} de 2 puntos</Badge>}>
        <p className="dz-muted">Marcá dos puntos lejanos sobre una línea que debería ser vertical: el borde de una pista o una línea de grilla.</p>
        <div className="dz-row">
          <ToolButton tool="tilt" icon="pen" kbd="I" />
          {picks.tilt.length > 0 && (
            <Button size="sm" variant="ghost" icon="trash" onClick={() => set({ picks: { ...picks, tilt: [] } })}>
              Borrar
            </Button>
          )}
        </div>
        {angle !== null && (
          <p className="dz-stat">
            Inclinación medida: <strong className="num">{formatNumber(angle, { digits: 2 })}°</strong>
          </p>
        )}
        {angleError && <Callout tone="warn">{angleError}</Callout>}
      </Section>

      <Section title="Perspectiva (opcional)" meta={<Badge tone={picks.quad.length === 4 ? 'accent' : 'neutral'}>{picks.quad.length} de 4 esquinas</Badge>}>
        <p className="dz-muted">Para fotos tomadas en ángulo: marcá las 4 esquinas del marco de la pista en orden (arriba izquierda, arriba derecha, abajo derecha, abajo izquierda). La imagen se recorta a ese marco.</p>
        <div className="dz-row">
          <ToolButton tool="quad" icon="expand-view" kbd="Q" />
          {picks.quad.length > 0 && (
            <Button size="sm" variant="ghost" icon="trash" onClick={() => set({ picks: { ...picks, quad: [] } })}>
              Borrar
            </Button>
          )}
        </div>
      </Section>

      {downstream && ready && <Callout tone="warn">Aplicar una corrección nueva borra los amarres y las curvas marcados (estaban sobre la imagen anterior).</Callout>}
      <div className="dz-actions">
        <Button variant="primary" icon="check" disabled={!ready || !!job} onClick={() => void applyGeometryPicks()}>
          Aplicar corrección
        </Button>
        {geometry.length > 0 ? (
          <Button variant="ghost" icon="restore-view" disabled={!!job} onClick={() => void resetGeometry()}>
            Quitar corrección
          </Button>
        ) : (
          <Button variant="ghost" icon="skip" disabled={!!job} onClick={skipGeometry}>
            Omitir
          </Button>
        )}
      </div>
    </>
  );
}
