/** Piezas compartidas de las secciones del panel «Calibración» (dato destacado y leyenda de los gráficos). */

export function KPI({ label, value, unit, title, tone }: { label: string; value: string; unit?: string; title?: string; tone?: 'muted' }) {
  return (
    <div className="ccal-kpi" title={title}>
      <div className="ccal-kpi__label">{label}</div>
      <div className={`ccal-kpi__value num${tone ? ' is-muted' : ''}`}>
        {value}
        {unit && <span className="ccal-kpi__unit"> {unit}</span>}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; dash?: boolean; dot?: boolean }[] }) {
  return (
    <div className="ccal-legend">
      {items.map((it) => (
        <span key={it.label} className="ccal-legend__item">
          <span className={`ccal-legend__mark${it.dot ? ' is-dot' : ''}${it.dash ? ' is-dash' : ''}`} style={{ ['--mark' as string]: it.color }} aria-hidden="true" />
          {it.label}
        </span>
      ))}
    </div>
  );
}
