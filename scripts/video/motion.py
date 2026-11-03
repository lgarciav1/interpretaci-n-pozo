"""Diferencia media entre cuadros consecutivos (JPG/PNG) de una carpeta: lista los saltos."""
import sys, glob
from PIL import Image, ImageChops, ImageStat
fs = sorted(glob.glob(sys.argv[1] + '/f*.*'))
thr = float(sys.argv[2]) if len(sys.argv) > 2 else 6
prev = None; out = []
for i, f in enumerate(fs):
    im = Image.open(f).convert('L').resize((480, 270))
    if prev is not None:
        v = ImageStat.Stat(ImageChops.difference(im, prev)).mean[0]
        if v > thr: out.append((round(i / 30, 2), round(v, 1)))
    prev = im
print(len(fs), 'cuadros; saltos >', thr, ':', out)
