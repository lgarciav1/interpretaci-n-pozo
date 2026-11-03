/**
 * Alternativa estática de la sarta sin WebGL (docs/decisiones/0065): un alzado en SVG hecho con la misma descripción
 * de la escena (`buildToolStringScene`), acostado como en la vista 3D. Los diámetros van exagerados ×4 para que se lean
 * las herramientas (se dice en pantalla). Clic en una herramienta = la misma selección que en 3D.
 */
import type { ToolStringScene } from '../toolString/scene';

/** Exageración radial del alzado: aun con los largos comprimidos 5:1, la sarta es decenas de veces más larga que ancha. */
export const SILHOUETTE_RADIAL_EXAGGERATION = 4;

export function Silhouette({ desc, selectedId, onSelect }: { desc: ToolStringScene; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const EX = SILHOUETTE_RADIAL_EXAGGERATION;
  const bodies = desc.primitives.filter((p): p is Extract<typeof p, { kind: 'cylinder' }> => p.kind === 'cylinder');
  const top = desc.focus.max[1];
  const bottom = desc.focus.min[1];
  const maxR = Math.max(...bodies.map((b) => b.radius), 1) * EX;
  const pad = maxR * 0.6;
  const x = (y: number) => top - y;
  const toolOf = (key: string) => (key.startsWith('body:') ? key.slice(5) : null);
  return (
    <svg className="home-sil" viewBox={`${-pad} ${-maxR - pad} ${top - bottom + 2 * pad} ${2 * (maxR + pad)}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="home-sil-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--home-steel-hi)" />
          <stop offset="0.45" stopColor="var(--home-steel)" />
          <stop offset="1" stopColor="var(--home-steel-lo)" />
        </linearGradient>
      </defs>
      <line x1={x(top)} x2={x(bottom)} y1={0} y2={0} className="home-sil__axis" />
      {bodies.map((b) => {
        const id = toolOf(b.key);
        const r = b.radius * EX;
        const x0 = x(b.y1);
        const w = b.y1 - b.y0;
        const ring = Math.min(4.5, w * 0.1);
        const selected = !!id && id === selectedId;
        return (
          <g key={b.key} className={`home-sil__piece${id ? ' is-tool' : ''}${selected ? ' is-selected' : ''}`} onClick={id ? () => onSelect(selected ? null : id) : undefined}>
            <rect x={x0} y={-r} width={w} height={2 * r} rx={Math.min(r * 0.35, 3)} fill="url(#home-sil-steel)" />
            {id && b.detail === 'tool' && w > 20 && (
              <>
                <rect x={x0 + 4} y={-r} width={ring} height={2 * r} fill={b.style.color} />
                <rect x={x0 + w - 4 - ring} y={-r} width={ring} height={2 * r} fill={b.style.color} />
              </>
            )}
            {selected && <rect x={x0 - 2} y={-r - 2} width={w + 4} height={2 * r + 4} rx={4} className="home-sil__halo" />}
          </g>
        );
      })}
    </svg>
  );
}
