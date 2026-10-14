"""Pasa las capturas de build/raw (PNG a 2×) a WebP livianos en build/shots."""
import os, sys
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
raw, out = os.path.join(here, 'build/raw'), os.path.join(here, 'build/shots')
os.makedirs(out, exist_ok=True)
MAX_W = 1840
# Recortes en fracciones (izquierda, arriba, derecha, abajo) para capturas demasiado altas.
CROPS = {'all-modules': (0, 0, 1, 0.55)}
only = set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None
total = 0
for f in sorted(os.listdir(raw)):
    if not f.endswith('.png'): continue
    name = f[:-4]
    if only and name not in only: continue
    im = Image.open(os.path.join(raw, f)).convert('RGB')
    if name in CROPS:
        l, tp, r, b = CROPS[name]
        im = im.crop((round(l * im.width), round(tp * im.height), round(r * im.width), round(b * im.height)))
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    dst = os.path.join(out, name + '.webp')
    im.save(dst, 'WEBP', quality=80, method=6)
    im.save(os.path.join(out, name + '.jpg'), 'JPEG', quality=82, optimize=True, progressive=True)
    total += os.path.getsize(dst)
print(f'{len([f for f in os.listdir(out) if f.endswith(".webp")])} capturas, {total / 1e6:.1f} MB')
