import { sameContext } from '../../core/engine/context';
import { effectiveWell, entryContext } from '../preparation/data';
/**
 * Vista 3D de la sarta (docs/decisiones/0033): ocupa el centro en lugar del visor mientras la pantalla de la sarta está
 * abierta. Se gira, se mueve y se acerca; pasar el puntero resalta y dice el nombre; clic selecciona y abre la ficha.
 * La escena es una función pura del estado (`buildToolStringScene`); `ToolStringRenderer` solo la dibuja.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { registry } from '../../modules';
import { Button, Callout, curveStyle, formatNumber, Icon, prefersReducedMotion, useResolvedTheme, useThemeTokens } from '../../ui';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { hasWebGL2, ToolStringRenderer } from './render3d';
import { AXIAL_COMPRESSION, boreholeDiameter, buildToolStringScene, type Pick } from './scene';
import { useToolStringView } from './select';
import { useToolStringUi } from './store';
import { wellColumn, wellRadialLog } from './wellColumn';
import { ToolSheetCard } from './ToolSheetCard';
import './toolString.css';

type Hover = { text: string; x: number; y: number } | null;

const FORMATION_SOURCE_LABEL = { facies: 'litología sugerida (modelo de facies)', gr: 'GR (de arena limpia a lutita)' } as const;

export function ToolStringView() {
  const entry = useProject(selectActiveEntry);
  const view = useToolStringView();
  const theme = useResolvedTheme();
  const tokens = useThemeTokens();
  const selectedId = useToolStringUi((s) => s.selectedId);
  const hoverId = useToolStringUi((s) => s.hoverId);
  const setTs = useToolStringUi((s) => s.set);
  const setUi = useUi((s) => s.set);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ToolStringRenderer | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  const curves = entry?.well.curves;
  const borehole = useMemo(() => boreholeDiameter(curves ?? []), [curves]);
  const candidate = useResults((s) => s.result);
  const result = useMemo(() => entry && sameContext(candidate?.context, entryContext(entry)) ? candidate : null, [entry, candidate]);
  const well = entry ? effectiveWell(entry.well, result) : undefined;
  const column = useMemo(() => wellColumn(well, result), [well, result]);
  const radial = useMemo(() => well && entry ? wellRadialLog(well, entry.interpretation, result) : null, [well, entry, result]);
  // El tramo que mostraba el visor (sigue montado debajo); sin visor, la mitad del pozo.
  const visible = useViewer((s) => s.visible);
  const center = visible ? (visible.top + visible.base) / 2 : radial?.depth.length ? (radial.depth[0]! + radial.depth[radial.depth.length - 1]!) / 2 : 0;
  const desc = useMemo(() => {
    if (!view) return null;
    return buildToolStringScene({
      entries: view.resolved.entries,
      mode: view.resolved.mode,
      borehole,
      selectedId,
      hoverId,
      colors: tokens.scene,
      accent: tokens.color.accent,
      curveColor: (role) => curveStyle(role, theme, registry.roles).color,
      theme,
      ...(radial ? { radial: { log: radial, center } } : {}),
      formation: column ? { column, center } : null,
    });
  }, [view, borehole, selectedId, hoverId, tokens, theme, column, radial, center]);

  const ready = !!desc;

  // La selección desaparece si la herramienta sale de la sarta.
  useEffect(() => {
    if (selectedId && view && !view.resolved.entries.some((e) => e.tool.id === selectedId)) setTs({ selectedId: null });
  }, [selectedId, view, setTs]);

  // Renderizador: uno por montaje; se libera al desmontar.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!hasWebGL2()) {
      setGlError('Este navegador no puede dibujar en 3D (WebGL 2 no está disponible o está desactivado).');
      return;
    }
    let r: ToolStringRenderer;
    try {
      r = new ToolStringRenderer(
        host,
        {
          onHover(pick: Pick | null, at) {
            if (!pick || !at) {
              setHover(null);
              if (useToolStringUi.getState().hoverId) setTs({ hoverId: null });
              return;
            }
            const text = 'fixed' in pick ? pick.fixed : (registry.tools.get(pick.toolId)?.name ?? pick.toolId);
            setHover({ text, x: at.x, y: at.y });
            const id = 'toolId' in pick ? pick.toolId : null;
            if (useToolStringUi.getState().hoverId !== id) setTs({ hoverId: id });
          },
          onPick(pick) {
            if (!pick) setTs({ selectedId: null });
            else if ('toolId' in pick) setTs({ selectedId: pick.toolId });
          },
        },
        prefersReducedMotion,
      );
    } catch (e) {
      setGlError(`No se pudo iniciar la vista 3D: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    rendererRef.current = r;
    return () => {
      r.dispose();
      rendererRef.current = null;
    };
  }, [setTs, ready]);

  useEffect(() => {
    if (desc && rendererRef.current) rendererRef.current.setScene(desc, tokens.scene.bg);
  }, [desc, tokens]);

  // Sin pozo no hay sarta: vuelve al visor.
  useEffect(() => {
    if (!entry) setUi({ toolStringOpen: false });
  }, [entry, setUi]);

  // Escape: cierra la ficha y, si no hay, la pantalla (no si lo usa un menú, un diálogo o un campo de texto).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      if (useToolStringUi.getState().selectedId) setTs({ selectedId: null });
      else setUi({ toolStringOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTs, setUi]);

  // Al salir de la pantalla, sin herramienta bajo el puntero.
  useEffect(() => () => setTs({ hoverId: null }), [setTs]);

  if (!entry || !view || !desc) return null;
  const selected = selectedId ? registry.tools.get(selectedId) : undefined;

  const onKey = (e: KeyboardEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const step = Math.PI / 24;
    const map: Record<string, () => void> = {
      ArrowLeft: () => r.orbit(-step, 0),
      ArrowRight: () => r.orbit(step, 0),
      ArrowUp: () => r.orbit(0, -step),
      ArrowDown: () => r.orbit(0, step),
      '+': () => r.zoom(0.85),
      '=': () => r.zoom(0.85),
      '-': () => r.zoom(1 / 0.85),
      Home: () => r.resetView(),
    };
    const fn = map[e.key];
    if (fn && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      fn();
    }
  };

  // Leyenda compacta: una línea por herramienta con sus cáscaras (colores de curva) y su profundidad.
  const legend = view.resolved.entries
    .map((e) => {
      const sh = desc.shells.filter((s) => s.toolId === e.tool.id);
      if (!sh.length) return null;
      const ins = [...new Set(sh.map((s) => Math.round((s.doiCm / 2.54) * 100) / 100))];
      const fmt = (v: number) => formatNumber(v, { significant: 3, grouping: false });
      const range = ins.length > 1 ? `${fmt(Math.min(...ins))}–${fmt(Math.max(...ins))} in` : `${fmt(ins[0]!)} in`;
      return {
        id: e.tool.id,
        short: e.tool.short,
        swatches: sh.map((s) => ({ color: s.color, present: s.present, role: s.role })),
        range,
        axis: sh[0]!.from === 'axis',
        ghost: !e.hasData && view.resolved.mode === 'planning',
        selected: e.tool.id === selectedId,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const anyAbsent = legend.some((l) => l.swatches.some((s) => !s.present));
  const env = desc.environment;
  const fmtDepth = (v: number) => formatNumber(v, { digits: 1 });
  const formationNote =
    env.source === 'neutral' || !env.depth
      ? view.resolved.mode === 'planning'
        ? 'Formación esquemática (planificación)'
        : 'Formación esquemática (sin GR ni facies)'
      : `Formación ${fmtDepth(env.depth.top)}–${fmtDepth(env.depth.base)} m · color por ${FORMATION_SOURCE_LABEL[env.source]}`;
  const bands = env.radial ?? [];
  const measured = bands.some(b => b.measured);
  const calculated = bands.some(b => b.invasion !== null);
  const runs: { top: number; base: number; wall: string; invasion: string }[] = [];
  for (const b of bands) {
    const wall = b.measured ? 'CAL medido' : 'pared ilustrativa';
    const invasion = b.invasion !== null ? 'DI calculado' : b.incompatible ? 'invasión ilustrativa (DI dentro de la pared)' : 'invasión ilustrativa';
    const previous = runs[runs.length - 1];
    if (previous && previous.wall === wall && previous.invasion === invasion) previous.base = b.base;
    else runs.push({ top: b.top, base: b.base, wall, invasion });
  }
  const mid = env.depth ? (env.depth.top + env.depth.base) / 2 : center;
  const current = bands.find(b => mid >= b.top && mid < b.base);
  const bh = `${formatNumber(desc.boreholeDiameterIn, { significant: 3, grouping: false })} in`;

  return (
    <section className="ts-view" aria-label="Sarta de perfilaje en 3D">
      <header className="ts-view__bar">
        <div className="ts-view__titles">
          <span className="ts-view__overline">Sarta · vista 3D</span>
          <span className="ts-view__scale">
            Radios y profundidades de investigación a escala real · largos comprimidos {AXIAL_COMPRESSION}:1 · montaje nominal de {bh}
            {desc.boreholeSchematic ? ' (esquemático)' : borehole.source === 'BS' ? ' (trépano)' : ' (calibre)'}
          </span>
        </div>
        <div className="ts-view__tools">
          <Button size="sm" variant="ghost" icon="view-reset" onClick={() => rendererRef.current?.resetView()} disabled={!!glError} title="Volver a la vista inicial (Inicio)">
            Vista inicial
          </Button>
          <Button size="sm" variant="ghost" icon="tracks" onClick={() => setUi({ toolStringOpen: false })} title="Cerrar la sarta y volver al perfil (Esc)">
            Volver al perfil
          </Button>
        </div>
      </header>
      <div className={`ts-view__body${selected ? ' has-sheet' : ''}`}>
        <div className="ts-view__stage">
          {glError ? (
            <div className="ts-view__nogl">
              <Callout tone="warn" title="Sin vista 3D">
                {glError} La lista de la izquierda y las fichas siguen funcionando.
              </Callout>
            </div>
          ) : (
            <div
              ref={hostRef}
              className={`ts3d${hover ? ' is-hovering' : ''}`}
              tabIndex={0}
              role="img"
              aria-roledescription="vista 3D"
              aria-label={`Sarta de ${view.resolved.entries.length} herramientas en el pozo, con su profundidad de investigación. Flechas: girar; más y menos: acercar; Inicio: vista inicial. Para elegir una herramienta usá la lista.`}
              onKeyDown={onKey}
            >
              {hover && (
                <div className="ts3d__tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 12}px)` }}>
                  {hover.text}
                </div>
              )}
            </div>
          )}
          {!glError && (
            <>
              <div className="ts-view__legend">
                <span className="ts-view__legend-title">
                  Profundidad de investigación <span className="ts-view__legend-ref">· pared al centro de la herramienta</span>
                </span>
                <ul aria-label="Profundidad de investigación por herramienta">
                  {legend.map((l) => (
                    <li key={l.id} className={[l.ghost ? 'is-ghost' : '', l.selected ? 'is-selected' : ''].filter(Boolean).join(' ') || undefined}>
                      <span className="ts-view__legend-swatches" aria-hidden="true">
                        {l.swatches.map((s, i) => (
                          <span key={i} className={s.present ? undefined : 'is-absent'} style={{ ['--sw' as string]: s.color }} title={s.present ? undefined : `${s.role ?? ''}: el pozo no tiene esta curva`} />
                        ))}
                      </span>
                      <b>{l.short}</b> {l.range}
                      {l.axis && <span className="ts-view__legend-ref">desde el eje</span>}
                    </li>
                  ))}
                </ul>
                <span className="ts-view__legend-states">
                  <span className="ts-view__state ts-view__state--off" /> apagada
                  <span className="ts-view__state ts-view__state--ghost" /> sin datos
                  <span className="ts-view__state ts-view__state--dash" /> aproximado
                  {anyAbsent && (
                    <>
                      <span className="ts-view__state ts-view__state--absent" /> el pozo no tiene la curva
                    </>
                  )}
                </span>
              </div>
              <div className="ts-view__formation">
                <span>
                <span className={`ts-view__formation-swatch is-${env.source}`} aria-hidden="true" />
                {formationNote}</span>
                <details className="ts-view__radial">
                  <summary>{measured ? 'Pared · CAL medido' : 'Pared ilustrativa'} · {calculated ? 'invasión · DI calculado' : 'invasión ilustrativa'}{runs.length > 1 ? ' · por tramos' : ''}</summary>
                  <p>Sección circular esquemática. Los huecos usan respaldo por capa. El filtrado difuso y el revoque son ilustrativos. El borde definido marca DI. La regla parte de la pared superior.</p>
                  {current?.rxo != null && <p>RXO a {fmtDepth(mid)} m MD · {formatNumber(current.rxo, { significant: 3 })} Ω·m (zona lavada)</p>}
                  <ul>{runs.map(run => <li key={run.top}>{formatNumber(run.top, { digits: 2 })}–{formatNumber(run.base, { digits: 2 })} m MD · {run.wall} · {run.invasion}</li>)}</ul>
                </details>
              </div>
              <p className="ts-view__help" aria-hidden="true">
                <Icon name="info" size={12} /> Arrastrá para girar · clic derecho o dos dedos para mover · rueda para acercar · clic para ver la ficha
              </p>
            </>
          )}
        </div>
        {selected && (
          <ToolSheetCard
            key={selected.id}
            tool={selected}
            entry={view.resolved.entries.find((e) => e.tool.id === selected.id)}
            layout={desc.tools.find((t) => t.toolId === selected.id)}
            view={view}
            well={entry.well}
            interpretation={entry.interpretation}
            onClose={() => setTs({ selectedId: null })}
            {...(glError ? {} : { onFocus: () => rendererRef.current?.focusTool(selected.id) })}
          />
        )}
      </div>
    </section>
  );
}

