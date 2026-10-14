"""Recorta las capturas de `shots/` (3200×2000, a 2×) en los encuadres que usa la promo (`assets/`)."""
import os
from PIL import Image

os.makedirs('assets', exist_ok=True)
CROPS = {
    'crossplot': ('crossplot', (120, 728, 2560, 2000)),
    'histogram': ('histogram', (640, 728, 3080, 2000)),
    'corona': ('corona', (1120, 816, 3080, 1800)),
    'sarta': ('sarta', (688, 380, 2344, 1968)),
    'viewer': ('viewer_well', (120, 264, 3080, 2000)),
}
for name, (shot, box) in CROPS.items():
    Image.open(f'shots/{shot}.png').convert('RGB').crop(box).save(f'assets/{name}.png')
for name in ('hero', 'hero_light'):
    Image.open(f'shots/{name}.png').convert('RGB').save(f'assets/{name}.png')
print('recortes listos')
