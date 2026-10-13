/** Dibujo de wiggles y área variable. Los huecos separan los trazados: nunca se unen a través de NaN. */
export interface WiggleViewport { x: number; width: number; top: number; base: number; height: number; yOf(depth: number): number }

export function drawWiggle(ctx: CanvasRenderingContext2D, depth: ArrayLike<number>, amplitude: ArrayLike<number>, view: WiggleViewport, color: string): void {
  const count = Math.min(depth.length, amplitude.length);
  let peak = 0;
  for (let index = 0; index < count; index++) if (Number.isFinite(amplitude[index])) peak = Math.max(peak, Math.abs(amplitude[index]));
  let first = 0, last = count;
  while (first + 1 < count && depth[first + 1] < view.top) first++;
  while (last > first + 1 && depth[last - 2] > view.base) last--;
  const scale = peak > 0 ? view.width / 4 * 0.42 / peak : 0;
  ctx.save(); ctx.beginPath(); ctx.rect(view.x, 0, view.width, view.height); ctx.clip();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
  for (let repeat = 0; repeat < 4; repeat++) {
    const baseline = view.x + view.width / 4 * (repeat + 0.5);
    ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.moveTo(baseline, 0); ctx.lineTo(baseline, view.height); ctx.stroke();
    ctx.globalAlpha = 0.65;
    // Área por segmentos: el cruce por cero se interpola, los lóbulos negativos quedan sin relleno.
    for (let index = Math.max(1, first); index < last; index++) {
      const a = amplitude[index - 1], b = amplitude[index];
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(depth[index - 1]) || !Number.isFinite(depth[index])) continue;
      if (depth[index] < view.top || depth[index - 1] > view.base || a <= 0 && b <= 0) continue;
      let y0 = view.yOf(depth[index - 1]), y1 = view.yOf(depth[index]);
      let x0 = Math.max(0, a) * scale, x1 = Math.max(0, b) * scale;
      if (a < 0) y0 += (y1 - y0) * -a / (b - a);
      if (b < 0) y1 = y0 + (y1 - y0) * a / (a - b);
      ctx.beginPath(); ctx.moveTo(baseline, y0); ctx.lineTo(baseline + x0, y0); ctx.lineTo(baseline + x1, y1); ctx.lineTo(baseline, y1); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.beginPath();
    let pen = false;
    for (let index = first; index < last; index++) {
      const value = amplitude[index], z = depth[index];
      if (!Number.isFinite(value) || !Number.isFinite(z)) { pen = false; continue; }
      const x = baseline + value * scale, y = view.yOf(z);
      if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.restore();
}
