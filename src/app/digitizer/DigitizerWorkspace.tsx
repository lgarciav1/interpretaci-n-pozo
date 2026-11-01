import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { readCalibration, type ImagePoint, type TrackCalibration } from '../../digitizer/calibration';
import './digitizer.css';

type Marker = 'left' | 'right' | 'top' | 'bottom';
const defaultScale = { kind: 'linear' as const, min: 0, max: 150, reversed: false };

export function DigitizerWorkspace({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [marker, setMarker] = useState<Marker>('left');
  const [cal, setCal] = useState<TrackCalibration>({
    left: 0, right: 1, top: { x: 0, y: 0 }, bottom: { x: 0, y: 1 },
    topDepthM: 0, bottomDepthM: 100, scale: defaultScale,
  });
  const [cursor, setCursor] = useState<ImagePoint | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  function openImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setUrl(URL.createObjectURL(file));
    setCursor(null);
    setMarker('left');
  }

  function imagePoint(e: MouseEvent<HTMLImageElement>): ImagePoint | null {
    const image = imgRef.current;
    if (!image || !dimensions.width || !dimensions.height) return null;
    const rect = image.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * dimensions.width,
      y: (e.clientY - rect.top) / rect.height * dimensions.height,
    };
  }

  function selectPoint(e: MouseEvent<HTMLImageElement>) {
    const p = imagePoint(e);
    if (!p) return;
    setCal((prev) => marker === 'left' ? { ...prev, left: p.x }
      : marker === 'right' ? { ...prev, right: p.x }
      : marker === 'top' ? { ...prev, top: p }
      : { ...prev, bottom: p });
    setMarker((prev) => prev === 'left' ? 'right' : prev === 'right' ? 'top' : prev === 'top' ? 'bottom' : 'bottom');
  }

  const readout = cursor ? (() => { try { return readCalibration(cursor, cal); } catch { return null; } })() : null;

  return (
    <section className="digitizer-workspace" aria-label="Log Digitizer">
      <header className="digitizer-header">
        <div><strong>Log Digitizer</strong><span> · Importación y calibración de registros</span></div>
        <button type="button" onClick={onClose}>Cerrar</button>
      </header>
      <div className="digitizer-body">
        <aside className="digitizer-controls">
          <label>Imagen del registro (JPG/PNG)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={openImage} />
          </label>
          <p>Seleccioná cada marcador y hacé clic sobre la imagen. Las coordenadas se guardan en píxeles originales.</p>
          <fieldset><legend>Marcador activo</legend>
            {(['left', 'right', 'top', 'bottom'] as const).map((m) => (
              <label key={m}><input type="radio" checked={marker === m} onChange={() => setMarker(m)} /> {({ left: 'Borde izquierdo', right: 'Borde derecho', top: 'Profundidad superior', bottom: 'Profundidad inferior' })[m]}</label>
            ))}
          </fieldset>
          <label>Profundidad superior (m)<input type="number" value={cal.topDepthM} onChange={(e) => setCal((c) => ({ ...c, topDepthM: Number(e.target.value) }))} /></label>
          <label>Profundidad inferior (m)<input type="number" value={cal.bottomDepthM} onChange={(e) => setCal((c) => ({ ...c, bottomDepthM: Number(e.target.value) }))} /></label>
          <label>Escala
            <select value={cal.scale.kind} onChange={(e) => setCal((c) => ({ ...c, scale: { ...c.scale, kind: e.target.value as 'linear' | 'log' } }))}>
              <option value="linear">Lineal</option><option value="log">Logarítmica</option>
            </select>
          </label>
          <label>Valor mínimo<input type="number" value={cal.scale.min} onChange={(e) => setCal((c) => ({ ...c, scale: { ...c.scale, min: Number(e.target.value) } }))} /></label>
          <label>Valor máximo<input type="number" value={cal.scale.max} onChange={(e) => setCal((c) => ({ ...c, scale: { ...c.scale, max: Number(e.target.value) } }))} /></label>
          <label><input type="checkbox" checked={cal.scale.reversed} onChange={(e) => setCal((c) => ({ ...c, scale: { ...c.scale, reversed: e.target.checked } }))} /> Eje invertido</label>
          <div className="digitizer-readout" aria-live="polite">
            {readout ? `Profundidad: ${readout.depthM.toFixed(2)} m · Valor: ${readout.value.toFixed(3)}` : 'Calibrá los cuatro marcadores para leer valores.'}
          </div>
          <small>Primera fase: no se digitalizan ni exportan curvas todavía. PDF y rectificación de perspectiva quedan para las siguientes fases.</small>
        </aside>
        <div className="digitizer-image-area">
          {url ? <div className="digitizer-image-wrap">
            <img ref={imgRef} src={url} alt="Registro para calibración" draggable={false}
              onLoad={(e) => { const img = e.currentTarget; const w = img.naturalWidth, h = img.naturalHeight; setDimensions({ width: w, height: h }); setCal((c) => ({ ...c, left: w * 0.1, right: w * 0.9, top: { x: 0, y: h * 0.1 }, bottom: { x: 0, y: h * 0.9 } })); }}
              onClick={selectPoint} onMouseMove={(e) => setCursor(imagePoint(e))} onMouseLeave={() => setCursor(null)} />
            {dimensions.width > 0 && <svg viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} preserveAspectRatio="none" aria-hidden="true">
              <line x1={cal.left} x2={cal.left} y1="0" y2={dimensions.height} />
              <line x1={cal.right} x2={cal.right} y1="0" y2={dimensions.height} />
              <line x1="0" x2={dimensions.width} y1={cal.top.y} y2={cal.top.y} />
              <line x1="0" x2={dimensions.width} y1={cal.bottom.y} y2={cal.bottom.y} />
            </svg>}
          </div> : <p>Seleccioná una imagen para comenzar.</p>}
        </div>
      </div>
    </section>
  );
}
