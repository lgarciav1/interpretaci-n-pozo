/**
 * Perfil de muestra dibujado en canvas con la paleta del sistema de diseño (solo para la página de muestra):
 * correlación (GR con relleno, CALI, BS), resistividades en log y densidad–neutrón con relleno de cruce.
 * Sirve para revisar convenciones y contraste en ambos temas, y como referencia del patrón de dibujo del visor.
 */
import { defaultRoleCatalog } from '../../core/roles';
import { useCanvas } from '../canvas';
import { withAlpha } from '../color';
import { curveStyle, fillColor } from '../curves';
import type { ThemeName } from '../theme';
import { BASE_TOKENS, type ThemeTokens } from '../tokens';

const N = 260;

/** Serie sintética: arenas (s≈1) y arcillas (s≈0), con una arena con gas arriba. Determinística. */
function synthetic() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const sand = (i: number) => {
    const z = i / N;
    const beds = [
      [0.1, 0.24],
      [0.38, 0.5],
      [0.62, 0.7],
      [0.82, 0.93],
    ];
    let s = 0;
    for (const [a, b] of beds) s = Math.max(s, 1 / (1 + Math.exp(-(z - a!) * 140)) - 1 / (1 + Math.exp(-(z - b!) * 140)));
    return s;
  };
  const rows = [];
  for (let i = 0; i < N; i++) {
    const s = sand(i);
    const gas = i / N < 0.25 ? s : 0;
    const oil = i / N > 0.37 && i / N < 0.5 ? s : 0;
    rows.push({
      GR: 28 + 92 * (1 - s) + rnd() * 6,
      CALI: 8.6 + (1 - s) * 0.9 + (i > 150 && i < 160 ? 3.5 : 0) + rnd() * 0.08,
      BS: 8.5,
      RT: Math.exp(Math.log(2.2) * (1 - s) + s * Math.log(1.1) + (gas + oil) * 3.6 + rnd() * 0.08),
      RM: Math.exp(Math.log(2.0) * (1 - s) + s * Math.log(1.4) + (gas + oil) * 2.4 + rnd() * 0.08),
      RS: Math.exp(Math.log(1.8) * (1 - s) + s * Math.log(1.9) + (gas + oil) * 1.2 + rnd() * 0.08),
      RHOB: 2.52 - s * 0.27 - gas * 0.1 + rnd() * 0.015,
      NPHI: 0.34 - s * 0.14 - gas * 0.1 + rnd() * 0.012,
    });
  }
  return rows;
}

const DATA = synthetic();

function drawTracks(ctx: CanvasRenderingContext2D, { width, height }: { width: number; height: number }, t: ThemeTokens, ui: number) {
  const theme = t.name;
  const v = t.viewer;
  const depthW = 34;
  const trackW = (width - depthW) / 3;
  const x0 = [0, trackW + depthW, 2 * trackW + depthW];
  const y = (i: number) => (i / (N - 1)) * height;

  ctx.fillStyle = v.trackBg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = v.trackBgAlt;
  ctx.fillRect(trackW, 0, depthW, height);

  // Grilla
  ctx.lineWidth = 1;
  for (let k = 0; k <= 10; k++) {
    const yy = Math.round((k / 10) * height) + 0.5;
    ctx.strokeStyle = k % 5 === 0 ? v.gridMajor : v.gridMinor;
    ctx.beginPath();
    for (const x of x0) {
      ctx.moveTo(x, yy);
      ctx.lineTo(x + trackW, yy);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = v.gridMinor;
  ctx.beginPath();
  for (const x of [x0[0]!, x0[2]!]) {
    for (let k = 1; k < 4; k++) {
      const xx = Math.round(x + (k / 4) * trackW) + 0.5;
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, height);
    }
  }
  ctx.stroke();
  // Resistividad: grilla log (décadas 0,2–2000)
  const [lo, hi] = [Math.log10(0.2), Math.log10(2000)];
  for (let dec = 0; dec <= 3; dec++) {
    for (let m = 1; m < 10; m++) {
      const val = 2 * 10 ** (dec - 1) * m;
      if (val > 2000) break;
      const xx = Math.round(x0[1]! + ((Math.log10(val) - lo) / (hi - lo)) * trackW) + 0.5;
      ctx.strokeStyle = m === 1 ? v.gridMajor : v.gridMinor;
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, height);
      ctx.stroke();
    }
  }

  // Bordes de pista
  ctx.strokeStyle = v.trackBorder;
  ctx.beginPath();
  for (const x of [trackW, trackW + depthW, 2 * trackW + depthW]) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  ctx.stroke();

  // Profundidad
  ctx.fillStyle = v.axisText;
  ctx.font = `${Math.round(10 * ui)}px ${BASE_TOKENS.font.sans}`;
  ctx.textAlign = 'center';
  for (let k = 1; k < 10; k += 2) ctx.fillText(String(2400 + k * 10), trackW + depthW / 2, (k / 10) * height + 3);

  const xOf = (role: string, val: number, x: number) => {
    const s = curveStyle(role, theme, defaultRoleCatalog);
    const [mn, mx] = [s.min ?? 0, s.max ?? 1];
    let f = s.scale === 'log' ? (Math.log10(val) - Math.log10(mn)) / (Math.log10(mx) - Math.log10(mn)) : (val - mn) / (mx - mn);
    if (s.reversed) f = 1 - f;
    return x + Math.min(1, Math.max(0, f)) * trackW;
  };

  // Relleno de GR: arena (izquierda) y arcilla (derecha) de la curva
  const sand = fillColor('sand', theme);
  const shale = fillColor('shale', theme);
  for (let i = 0; i < N - 1; i++) {
    const gx = xOf('GR', DATA[i]!.GR, x0[0]!);
    ctx.fillStyle = withAlpha(sand.color, sand.alpha * 0.55);
    ctx.fillRect(x0[0]!, y(i), gx - x0[0]!, y(i + 1) - y(i) + 0.5);
    ctx.fillStyle = withAlpha(shale.color, shale.alpha * 0.45);
    ctx.fillRect(gx, y(i), x0[0]! + trackW - gx, y(i + 1) - y(i) + 0.5);
  }

  // Cruce densidad–neutrón (escalas compatibles: RHOB 1,95–2,95 y NPHI 0,45–(−0,15))
  const gas = fillColor('gasCrossover', theme);
  const sep = fillColor('shaleCrossover', theme);
  for (let i = 0; i < N - 1; i++) {
    const a = xOf('RHOB', DATA[i]!.RHOB, x0[2]!);
    const b = xOf('NPHI', DATA[i]!.NPHI, x0[2]!);
    ctx.fillStyle = a < b ? withAlpha(gas.color, gas.alpha) : withAlpha(sep.color, sep.alpha * 0.6);
    ctx.fillRect(Math.min(a, b), y(i), Math.abs(a - b), y(i + 1) - y(i) + 0.5);
  }

  const line = (role: string, key: keyof (typeof DATA)[number], x: number) => {
    const s = curveStyle(role, theme, defaultRoleCatalog);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.setLineDash(s.dash);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const xx = xOf(role, DATA[i]![key], x);
      if (i === 0) ctx.moveTo(xx, y(i));
      else ctx.lineTo(xx, y(i));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line('BS', 'BS', x0[0]!);
  line('CALI', 'CALI', x0[0]!);
  line('GR', 'GR', x0[0]!);
  line('RS', 'RS', x0[1]!);
  line('RM', 'RM', x0[1]!);
  line('RT', 'RT', x0[1]!);
  line('NPHI', 'NPHI', x0[2]!);
  line('RHOB', 'RHOB', x0[2]!);
}

export function SampleLog({ theme, height = 300 }: { theme?: ThemeName; height?: number }) {
  const ref = useCanvas(drawTracks, [], theme);
  return <canvas ref={ref} className="showcase-log" style={{ width: '100%', height }} role="img" aria-label="Perfil de muestra con la paleta de curvas" />;
}
