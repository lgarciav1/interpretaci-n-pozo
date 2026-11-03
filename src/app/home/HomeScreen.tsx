/**
 * Pantalla de Inicio (docs/decisiones/0065): la sarta de perfilaje como pieza exhibida, el nombre del producto, la
 * acción principal y la entrada cinematográfica al pozo. Es una capa sobre el espacio de trabajo, que queda montado e
 * inerte debajo (visor, dock y disposición intactos): al terminar la entrada, el visor ya está listo.
 *
 * - Con pozo activo, la sarta es la del configurador (`useToolStringView`, misma derivación); sin pozo, una
 *   composición de demostración rotulada como tal.
 * - Explorar no cambia nada del proyecto: girar y seleccionar son estado de interfaz.
 * - La escena se monta solo mientras Inicio está a la vista y se libera al cerrarse.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { registry } from '../../modules';
import { BrandMark, Button, curveStyle, formatNumber, Icon, IconButton, prefersReducedMotion, ThemeToggle, useResolvedTheme, useThemeTokens } from '../../ui';
import { effectiveWell } from '../preparation/data';
import { loadDemoWell } from '../demo/loadDemo';
import { pickProjectFile } from '../shell/projectActions';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { hasWebGL2 } from '../toolString/render3d';
import { AXIAL_COMPRESSION, boreholeDiameter, buildToolStringScene, familyColor, type Pick } from '../toolString/scene';
import { useToolStringView } from '../toolString/select';
import { useToolStringUi } from '../toolString/store';
import { wellColumn } from '../toolString/wellColumn';
import { closeHome, exploreToolString } from './actions';
import { demoToolString } from './demoString';
import { ShowcaseRenderer } from './showcase3d';
import { Silhouette, SILHOUETTE_RADIAL_EXAGGERATION } from './Silhouette';
import { ENTRY_TIMING, entryKind, useHome, type EntryKind } from './store';
import './home.css';

export const PRODUCT_NAME = 'fiubaLog';

type GlState = 'ok' | 'unavailable' | 'lost' | 'error';

/** Equipos modestos (o `?escena=simple`): escena sin suavizado y a 1 píxel por píxel CSS. */
function sceneQuality(): 'high' | 'low' {
  if (new URLSearchParams(location.search).get('escena') === 'simple') return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return cores <= 4 || memory <= 4 || coarse ? 'low' : 'high';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Inicio montado solo cuando está a la vista. */
export function HomeRoot() {
  const phase = useHome((s) => s.phase);
  return phase === 'closed' ? null : <HomeScreen />;
}

function HomeScreen() {
  const phase = useHome((s) => s.phase);
  const via = useHome((s) => s.via);
  const entry = useProject(selectActiveEntry);
  const projectName = useProject((s) => s.project.name);
  const view = useToolStringView();
  const theme = useResolvedTheme();
  const tokens = useThemeTokens();
  const selectedId = useToolStringUi((s) => s.selectedId);
  const setTs = useToolStringUi((s) => s.set);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [gl, setGl] = useState<GlState>(() => (hasWebGL2() ? 'ok' : 'unavailable'));
  const [interacted, setInteracted] = useState(false);
  const [fadeMs, setFadeMs] = useState(0);
  /** Entrada elegida (completa, breve, reducida, saltada): solo para leerla en el DOM (`data-entry`, pruebas). */
  const [entryShown, setEntryShown] = useState<EntryKind | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Caja libre para la sarta dentro del escenario (sin el rótulo ni las herramientas): el renderizador encuadra acá. */
  const frameRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const rendererRef = useRef<ShowcaseRenderer | null>(null);

  // ── Escena: la sarta del pozo activo o la composición de demostración ─────────────────────────────────────────
  const demo = !entry || !view;
  const demoEntries = useMemo(() => demoToolString(registry.tools), []);
  const entries = view?.resolved.entries ?? demoEntries;
  const mode = view?.resolved.mode ?? 'data';
  const curves = entry?.well.curves;
  const borehole = useMemo(() => boreholeDiameter(curves ?? []), [curves]);
  const result = useResults((s) => s.result);
  const well = entry ? effectiveWell(entry.well, result) : undefined;
  const column = useMemo(() => wellColumn(well, result), [well, result]);
  const visible = useViewer((s) => s.visible);
  const center = visible ? (visible.top + visible.base) / 2 : column ? (column.top + column.base) / 2 : 0;
  const desc = useMemo(
    () =>
      entries.length
        ? buildToolStringScene({
            entries,
            mode,
            borehole,
            selectedId,
            hoverId,
            colors: tokens.scene,
            accent: tokens.color.accent,
            curveColor: (role) => curveStyle(role, theme, registry.roles).color,
            theme,
            formation: column ? { column, center } : null,
          })
        : null,
    [entries, mode, borehole, selectedId, hoverId, tokens, theme, column, center],
  );
  const ready = !!desc;

  // La selección desaparece si la herramienta no está en esta sarta.
  useEffect(() => {
    if (selectedId && !entries.some((e) => e.tool.id === selectedId)) setTs({ selectedId: null });
  }, [selectedId, entries, setTs]);

  // Sombra de apoyo del fondo, debajo del centro de la caja de la sarta (sigue al diseño: escritorio o angosto).
  useEffect(() => {
    const frame = frameRef.current;
    const root = frame?.closest<HTMLElement>('.home');
    if (!frame || !root) return;
    const place = () => {
      const r = root.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      root.style.setProperty('--floor-x', `${f.left - r.left + f.width / 2}px`);
      root.style.setProperty('--floor-y', `${f.top - r.top + f.height * 0.66}px`);
      root.style.setProperty('--floor-w', `${f.width * 0.42}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  // ── Renderizador: uno por montaje, liberado al cerrar o si se pierde el contexto ─────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host || gl !== 'ok' || !ready) return;
    let r: ShowcaseRenderer;
    try {
      r = new ShowcaseRenderer(
        host,
        {
          onHover(pick: Pick | null, at) {
            const id = pick && 'toolId' in pick ? pick.toolId : null;
            setHoverId(id);
            setTip(pick && at ? { text: 'fixed' in pick ? pick.fixed : (registry.tools.get(pick.toolId)?.name ?? pick.toolId), x: at.x, y: at.y } : null);
          },
          onPick(pick) {
            const id = pick && 'toolId' in pick ? pick.toolId : null;
            useToolStringUi.getState().set({ selectedId: id });
          },
          onInteract: () => setInteracted(true),
          onContextLost: () => setGl('lost'),
        },
        prefersReducedMotion,
        {
          quality: sceneQuality(),
          frame: () => {
            const h = host.getBoundingClientRect();
            const s = frameRef.current?.getBoundingClientRect() ?? h;
            return { x: s.left - h.left, y: s.top - h.top, w: Math.max(1, s.width), h: Math.max(1, s.height) };
          },
        },
      );
    } catch (e) {
      // Si falló a mitad del constructor, el lienzo ya tiene contexto: se libera acá.
      host.querySelector('canvas')?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      console.warn('Inicio: no se pudo iniciar la vista 3D', e);
      setGl('error');
      return;
    }
    rendererRef.current = r;
    const ro = new ResizeObserver(() => r.reframe());
    if (frameRef.current) ro.observe(frameRef.current);
    return () => {
      ro.disconnect();
      rendererRef.current = null;
      // Se detiene y se oculta ya, y se libera apenas después: liberar el contexto WebGL bloquea el hilo (con
      // SwiftShader, ~1,2 s entre `forceContextLoss` y sacar el lienzo) y así el espacio de trabajo se pinta antes. Con
      // el contexto perdido no hay nada caro: se libera en el acto.
      r.stop();
      if (r.contextLost()) r.dispose();
      else setTimeout(() => r.dispose(), 120);
    };
  }, [gl, ready]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !desc) return;
    r.setScene(desc, tokens.scene.bg);
  }, [desc, tokens, gl]);

  useEffect(() => {
    rendererRef.current?.setTheme(theme);
  }, [theme, gl, ready]);

  // Giro automático en reposo (no con movimiento reducido ni después del primer gesto: lo decide el renderizador). Se
  // reevalúa si cambia la preferencia de movimiento con Inicio abierto.
  useEffect(() => {
    const apply = () => rendererRef.current?.setSpinning(phase === 'open');
    apply();
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    mq?.addEventListener('change', apply);
    return () => mq?.removeEventListener('change', apply);
  }, [phase, gl, ready]);

  // Una sola vista 3D a la vez: si algo abre el configurador (la paleta de comandos, por ejemplo), Inicio se cierra.
  useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if (s.toolStringOpen && !prev.toolStringOpen) closeHome();
      }),
    [],
  );

  // Al volver desde el espacio de trabajo, el foco va a la acción principal (al arrancar, el orden natural).
  useEffect(() => {
    if (via === 'return') primaryRef.current?.focus({ preventScroll: true });
  }, [via]);

  // ── Entrada al pozo ──────────────────────────────────────────────────────────────────────────────────────────
  const leave = useCallback((ms: number) => {
    if (ms <= 0) {
      closeHome();
      return;
    }
    setFadeMs(ms);
    useHome.getState().set({ phase: 'leaving' });
    setTimeout(() => {
      if (useHome.getState().phase === 'leaving') closeHome();
    }, ms);
  }, []);

  const enter = useCallback(
    async (forced?: EntryKind) => {
      const home = useHome.getState();
      if (home.phase !== 'open' || !selectActiveEntry(useProject.getState())) return;
      const kind = forced ?? entryKind({ reducedMotion: prefersReducedMotion(), fullEntrySeen: home.fullEntrySeen, hasScene: !!rendererRef.current });
      home.set({ phase: 'entering', fullEntrySeen: home.fullEntrySeen || kind === 'full' });
      setEntryShown(kind);
      const t = ENTRY_TIMING[kind];
      setTip(null);
      if (t.camera && rendererRef.current) {
        try {
          // Tope de seguridad: si la escena no avanza (contexto perdido, cuadros que no llegan), se entra igual.
          await Promise.race([rendererRef.current.enter(useToolStringUi.getState().selectedId, t.camera), sleep(t.camera + 1500)]);
        } catch (e) {
          console.warn('Inicio: la entrada al pozo falló; se entra sin animación', e);
        }
      }
      if (useHome.getState().phase !== 'entering') return; // saltada
      leave(t.fade);
    },
    [leave],
  );

  const skip = useCallback(() => {
    rendererRef.current?.finish();
    closeHome();
  }, []);

  // Teclado en captura, antes que los atajos del espacio de trabajo (que escuchan en `window` aunque esté inerte):
  // Escape es de Inicio (salta la entrada; en reposo cierra la ficha o entra directo) y deshacer/rehacer no corren a
  // ciegas sobre un proyecto que no se ve. Los diálogos y menús abiertos encima manejan sus teclas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      const p = useHome.getState().phase;
      if (p === 'closed') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key !== 'Escape') return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (p === 'entering' || p === 'leaving') skip();
      else if (p === 'open') {
        if (useToolStringUi.getState().selectedId) useToolStringUi.getState().set({ selectedId: null });
        else if (selectActiveEntry(useProject.getState())) void enter('skip');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enter, skip]);

  useEffect(() => () => setTs({ hoverId: null }), [setTs]);

  // ── Teclado sobre la escena ────────────────────────────────────────────────────────────────────────────────────
  const onStageKey = (e: ReactKeyboardEvent) => {
    const r = rendererRef.current;
    if (!r || phase !== 'open') return;
    const step = Math.PI / 24;
    const map: Record<string, () => void> = {
      ArrowLeft: () => r.orbit(-step, 0),
      ArrowRight: () => r.orbit(step, 0),
      ArrowUp: () => r.orbit(0, -step),
      ArrowDown: () => r.orbit(0, step),
    };
    const fn = map[e.key];
    if (fn && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      r.setSpinning(false);
      setInteracted(true);
      fn();
    }
  };

  // ── Textos ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const selected = selectedId ? entries.find((e) => e.tool.id === selectedId) : undefined;
  const toolCount = entries.length;
  const depth = entry?.well.depth.values;
  const fmtDepth = (v: number) => formatNumber(v, { digits: 0 });
  const interval = depth && depth.length ? `${fmtDepth(depth[0]!)}–${fmtDepth(depth[depth.length - 1]!)} m` : '';
  const measuredCount = entry?.well.curves.filter((c) => c.origin.kind === 'measured').length ?? 0;
  const busy = phase !== 'open';
  const glNote =
    gl === 'unavailable'
      ? 'Este navegador no puede dibujar en 3D (WebGL 2 no está disponible): se muestra un esquema.'
      : gl === 'lost'
        ? 'La vista 3D se detuvo (el navegador liberó la placa de video): se muestra un esquema.'
        : gl === 'error'
          ? 'No se pudo iniciar la vista 3D: se muestra un esquema.'
          : '';
  const caption = demo ? 'Composición de demostración' : `Sarta de ${entry.well.name}`;
  const captionDetail = demo
    ? 'Triple combo típica armada con el catálogo · no corresponde a ningún pozo cargado'
    : `${toolCount} ${toolCount === 1 ? 'herramienta' : 'herramientas'} · ${mode === 'planning' ? 'sarta planificada' : 'derivada de las curvas del pozo, como en el configurador'}`;
  const scaleNote =
    gl === 'ok'
      ? `Diámetros a escala real · largos comprimidos ${AXIAL_COMPRESSION}:1`
      : `Esquema 2D · diámetros exagerados ×${SILHOUETTE_RADIAL_EXAGGERATION} · largos comprimidos ${AXIAL_COMPRESSION}:1`;

  const curvesOf = (e: NonNullable<typeof selected>): string[] => {
    if (!entry || !e.curveIds.length) return [];
    const byId = new Map(entry.well.curves.map((c) => [c.id, c]));
    return e.curveIds.map((id) => byId.get(id)?.mnemonic ?? id);
  };

  return (
    <div
      className={['home', `is-${phase}`, via === 'return' && phase === 'open' ? 'is-returning' : '', interacted ? 'is-interacted' : ''].filter(Boolean).join(' ')}
      style={{ ['--home-fade' as string]: `${fadeMs}ms` }}
      role="region"
      aria-label="Inicio"
      data-testid="home"
      data-phase={phase}
      data-entry={entryShown ?? undefined}
    >
      <div className="home__backdrop" aria-hidden="true" />
      <div className="home__floor" aria-hidden="true" />
      {gl === 'ok' ? (
        <div ref={hostRef} className={`home__scene${tip ? ' is-hovering' : ''}`} aria-hidden="true" data-testid="home-scene">
          {tip && (
            <div className="home__tip" style={{ transform: `translate(${tip.x + 14}px, ${tip.y + 12}px)` }}>
              {tip.text}
            </div>
          )}
        </div>
      ) : null}

      <div className="home__layout" onScroll={() => rendererRef.current?.reframe()}>
        <header className="home__top">
          <div className="home__brand">
            <BrandMark size={26} />
            <span>{PRODUCT_NAME}</span>
          </div>
          <ThemeToggle />
        </header>

        <section className="home__copy" aria-labelledby="home-title">
          <p className="home__overline">Interpretación de perfiles · FIUBA</p>
          <h1 id="home-title" className="home__title">
            {PRODUCT_NAME}
          </h1>
          <p className="home__lead">Del perfil medido a la interpretación petrofísica: visor multipista, zonas, cutoffs y sumario, en el navegador y sin conexión.</p>

          {entry ? (
            <dl className="home__well" aria-label="Pozo activo">
              <div className="home__well-head">
                <dt>Pozo activo</dt>
                <dd className="home__well-name">
                  <Icon name="well" size={14} /> {entry.well.name}
                </dd>
              </div>
              <div>
                <dt>Proyecto</dt>
                <dd>{projectName}</dd>
              </div>
              {interval && (
                <div>
                  <dt>Intervalo</dt>
                  <dd className="num">{interval}</dd>
                </div>
              )}
              <div>
                <dt>Curvas medidas</dt>
                <dd className="num">{measuredCount}</dd>
              </div>
            </dl>
          ) : (
            <p className="home__empty">Todavía no hay un pozo cargado. Podés traer un Excel, LAS o CSV, abrir un proyecto guardado o probar con el pozo de demostración.</p>
          )}

          <div className="home__actions">
            {entry ? (
              <Button ref={primaryRef} variant="primary" size="lg" icon="arrow-right" onClick={() => void enter()} disabled={busy} data-testid="home-enter">
                Entrar al pozo
              </Button>
            ) : (
              <Button ref={primaryRef} variant="primary" size="lg" icon="upload" onClick={() => useUi.getState().set({ loadDialog: {} })} disabled={busy} data-testid="home-load">
                Cargar pozo
              </Button>
            )}
            <div className="home__secondary">
              {entry && (
                <Button variant="ghost" icon="upload" onClick={() => useUi.getState().set({ loadDialog: {} })} disabled={busy}>
                  Cargar otro pozo
                </Button>
              )}
              <Button variant="ghost" icon="folder" onClick={pickProjectFile} disabled={busy}>
                Abrir proyecto
              </Button>
              {entry ? (
                <Button variant="ghost" icon="tool-string" onClick={exploreToolString} disabled={busy} data-testid="home-explore">
                  Explorar sarta
                </Button>
              ) : (
                <Button variant="ghost" icon="play" onClick={loadDemoWell} disabled={busy} data-testid="home-demo">
                  Ver demostración
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="home__stage" ref={stageRef} aria-label="Sarta de perfilaje" data-testid="home-stage">
          <div
            ref={frameRef}
            className="home__frame"
            tabIndex={gl === 'ok' ? 0 : -1}
            role="img"
            aria-roledescription={gl === 'ok' ? 'vista 3D' : 'esquema'}
            aria-label={`${caption}: ${toolCount} herramientas. ${gl === 'ok' ? 'Flechas: girar. ' : ''}Para elegir una herramienta usá la lista de abajo.`}
            onKeyDown={onStageKey}
          >
            {gl !== 'ok' && desc && <Silhouette desc={desc} selectedId={selectedId} onSelect={(id) => setTs({ selectedId: id })} />}
          </div>

          {selected && (
            <aside className="home-card" aria-label={`Ficha breve: ${selected.tool.name}`} data-testid="home-card">
              <div className="home-card__head">
                <span className="home-card__swatch" style={{ ['--sw' as string]: familyColor(selected.tool.family, tokens.scene) }} aria-hidden="true" />
                <div className="home-card__titles">
                  <span className="home-card__short">{selected.tool.short}</span>
                  <h2 className="home-card__name">{selected.tool.name}</h2>
                </div>
                <IconButton icon="x" size="sm" label="Cerrar la ficha (Esc)" onClick={() => setTs({ selectedId: null })} />
              </div>
              <p className="home-card__desc">{selected.tool.description}</p>
              <div className="home-card__curves">
                <span className="home-card__label">{entry && selected.curveIds.length ? 'Curvas en este pozo' : 'Curvas que registra'}</span>
                <ul>
                  {(entry && selected.curveIds.length ? curvesOf(selected) : selected.tool.roles).map((c) => (
                    <li key={c} className="num">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              {entry && (
                <button type="button" className="home-card__more" onClick={exploreToolString}>
                  Ficha completa en el configurador <Icon name="arrow-right" size={12} />
                </button>
              )}
            </aside>
          )}

          <div className="home__caption">
            <p className="home__caption-title">
              {demo && <span className="home__badge">Demostración</span>}
              {caption}
            </p>
            <p className="home__caption-detail">{captionDetail}</p>
            <ul className="home__chips" aria-label="Herramientas de la sarta, de arriba hacia abajo">
              {entries.map((e) => (
                <li key={e.tool.id}>
                  <button
                    type="button"
                    className={`home__chip${e.tool.id === selectedId ? ' is-selected' : ''}${e.on ? '' : ' is-off'}`}
                    style={{ ['--chip' as string]: familyColor(e.tool.family, tokens.scene) }}
                    aria-pressed={e.tool.id === selectedId}
                    title={e.on ? e.tool.name : `${e.tool.name} (apagada en la sarta)`}
                    onClick={() => setTs({ selectedId: e.tool.id === selectedId ? null : e.tool.id })}
                    onMouseEnter={() => setHoverId(e.tool.id)}
                    onMouseLeave={() => setHoverId(null)}
                    disabled={busy}
                  >
                    {e.tool.short}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="home__foot">
          <span className="home__hint">
            {glNote ? (
              <>
                <Icon name="info" size={12} /> {glNote}
              </>
            ) : (
              <>
                <Icon name="info" size={12} /> Arrastrá para girar · clic en una herramienta para ver qué mide
              </>
            )}
          </span>
          <span className="home__scale">{scaleNote}</span>
        </footer>
      </div>

      {(phase === 'entering' || phase === 'leaving') && (
        <button type="button" className="home__skip" onClick={skip} data-testid="home-skip" autoFocus>
          Saltar animación <kbd>Esc</kbd>
        </button>
      )}
      <p className="home__entering-note" aria-live="polite">
        {phase === 'entering' ? (column && !demo ? 'Corte conceptual del pozo: capas derivadas de los perfiles' : 'Corte conceptual del pozo') : ''}
      </p>
    </div>
  );
}
