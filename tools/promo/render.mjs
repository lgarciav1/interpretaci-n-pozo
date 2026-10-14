const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { spawn } from 'node:child_process';
const [f0, f1, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const FPS = 60;
const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('file://' + process.cwd() + '/promo.html');
await p.evaluate(() => window.ready);
const cdp = await p.context().newCDPSession(p);
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-vf', 'noise=alls=3:allf=t,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-tune', 'film',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let f = f0; f < f1; f++) {
  await p.evaluate((t) => window.render(t), f / FPS);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  if ((f - f0) % 300 === 0) console.log(out, f, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await b.close();
console.log('done', out, ((Date.now() - t0) / 1000).toFixed(0) + 's');
