#!/usr/bin/env bash
# Genera docs/promo/promo-interpretacion-de-pozo.mp4 de punta a punta.
# Requiere: npm ci, Python 3 con numpy y Pillow, ffmpeg, Playwright con Chromium.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
# 1) Capturas reales de la app (servidor de desarrollo en el puerto 5173)
(cd "$ROOT" && npx vite --port 5173 --strictPort > /dev/null 2>&1 &) ; sleep 4
mkdir -p shots && node capture.mjs
python3 crop.py
# 2) Datos del pozo del TP y banda sonora
python3 prep.py
python3 music.py
# 3) Cuadros (80 s a 60 fps) en tres tramos paralelos y unión con el audio
mkdir -p seg
node render.mjs 0 1600 seg/a.mp4 & node render.mjs 1600 3200 seg/b.mp4 & node render.mjs 3200 4800 seg/c.mp4 & wait
printf "file 'a.mp4'\nfile 'b.mp4'\nfile 'c.mp4'\n" > seg/list.txt
mkdir -p "$ROOT/docs/promo"
# Master de alta calidad (≈ 230 MB) y entrega a ≈ 4,3 Mb/s en dos pasadas (≈ 45 MB)
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i seg/list.txt -i music.wav -map 0:v -map 1:a -c:v copy \
  -c:a aac -b:a 256k -shortest -movflags +faststart seg/master.mp4
ffmpeg -y -hide_banner -loglevel error -i seg/master.mp4 -c:v libx264 -preset slow -b:v 4300k -pass 1 -passlogfile seg/p -an -f null /dev/null
ffmpeg -y -hide_banner -loglevel error -i seg/master.mp4 -c:v libx264 -preset slow -b:v 4300k -maxrate 9000k -bufsize 12000k \
  -pass 2 -passlogfile seg/p -tune film -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 192k -movflags +faststart "$ROOT/docs/promo/promo-interpretacion-de-pozo.mp4"
echo "Listo: docs/promo/promo-interpretacion-de-pozo.mp4"
