/**
 * Canvas que se redibuja solo: escala por devicePixelRatio, observa su tamaño y vuelve a dibujar al cambiar el
 * tema (o el tema del sistema) o el tamaño de interfaz. Patrón base para el visor (fase 4) y los gráficos (fase 7).
 *
 *     const ref = useCanvas((ctx, { width, height }, theme, ui) => {
 *       ctx.fillStyle = theme.viewer.trackBg; ...
 *       ctx.font = canvasFont(BASE_TOKENS.text.xs, 400, ui); // rótulos que siguen al tamaño de interfaz
 *     }, [datos]);
 *     return <canvas ref={ref} style={{ width: '100%', height: 240 }} />;
 */
import { useEffect, useLayoutEffect, useRef, type DependencyList } from 'react';
import { getResolvedTheme, subscribeTheme, type ThemeName } from './theme';
import { THEMES, type ThemeTokens } from './tokens';
import { getUiScaleFactor, subscribeUiScale } from './uiScale';

/**
 * `uiScale`: factor del tamaño de interfaz (1 = Compacto). Multiplica rótulos, márgenes de texto y tolerancias de
 * puntero; nunca los datos. Lo que se exporta como figura dibuja con 1.
 */
export type DrawFn = (ctx: CanvasRenderingContext2D, size: { width: number; height: number }, theme: ThemeTokens, uiScale: number) => void;

export function useCanvas(draw: DrawFn, deps: DependencyList, fixedTheme?: ThemeName) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const paint = useRef(() => {});
  paint.current = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawRef.current(ctx, { width, height }, THEMES[fixedTheme ?? getResolvedTheme()], getUiScaleFactor());
  };

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint.current());
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    const unsubscribe = fixedTheme ? () => {} : subscribeTheme(schedule);
    const unsubscribeScale = subscribeUiScale(schedule);
    paint.current();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      unsubscribe();
      unsubscribeScale();
    };
  }, [fixedTheme]);

  // Redibujar cuando cambian los datos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => paint.current(), deps);
  return ref;
}
