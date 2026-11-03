#!/usr/bin/env python3
"""
Genera un registro escaneado sintético con VERDAD CONOCIDA para probar el Log Digitizer en el navegador
(scripts/qa/log-digitizer-perspectiva-sesion.cjs). Independiente del motor: usa solo numpy y Pillow.

Uso: python3 scripts/qa/make-digitizer-scan.py <carpeta de salida>

Escribe en la carpeta:
  scan-frontal.png      pista de GR (verde, 0–150 gAPI) vista de frente, con grilla y marco
  scan-perspectiva.png  la misma imagen fotografiada en ángulo (homografía conocida)
  meta.json             la verdad: profundidad y GR muestreados, geometría de la pista y las 4 esquinas del marco

Convenciones (coordenadas de la imagen frontal, en píxeles):
  fila de la profundidad d:  y = TOP + (d - D0) / DZ        (DZ en m por píxel)
  columna del valor v:       x = L + v / 150 * (R - L)
El «marco» es el rectángulo con un margen M alrededor de la pista: sus 4 esquinas son lo que marca quien digitaliza
para rectificar la perspectiva (arriba izquierda, arriba derecha, abajo derecha, abajo izquierda).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

W, H = 900, 2700            # imagen frontal
L, R = 150, 750             # bordes izquierdo y derecho de la pista (GR 0 → 150)
TOP, BOT = 120, 2580        # filas del tope y de la base de la pista
M = 14                      # margen del marco alrededor de la pista
D0, DZ = 7800.0, 0.05       # profundidad del tope (m, dentro del pozo del TP: 7.633–8.518 m) y m por píxel
STEP = 0.25                 # muestreo de la verdad (m)
SS = 2                      # supersampling para el borde suave del trazo
PAPER = (244, 241, 232)


def truth(rng):
    """GR verdadero: ondulaciones de varias longitudes de onda (sin tramos casi horizontales, que son un límite
    declarado del motor) con algo de textura. Va de ~15 a ~125 gAPI."""
    depth = np.arange(D0, D0 + (BOT - TOP) * DZ + 1e-9, STEP)
    z = depth - D0
    ph = rng.uniform(0, 2 * np.pi, 3)
    gr = 70 + 38 * np.sin(2 * np.pi * z / 50 + ph[0]) + 12 * np.sin(2 * np.pi * z / 19 + ph[1]) + 5 * np.sin(2 * np.pi * z / 7 + ph[2])
    k = np.ones(3) / 3
    gr += np.convolve(np.pad(rng.normal(0, 2.0, len(z)), 1, mode="edge"), k, mode="valid")
    return depth, np.clip(gr, 8, 142)


def frontal(depth, gr):
    img = Image.new("RGB", (W * SS, H * SS), PAPER)
    dr = ImageDraw.Draw(img)
    s = SS
    # grilla fina: vertical cada 60 px (10 divisiones), horizontal cada 100 px; más marcada cada 500 px
    for i in range(1, 10):
        x = (L + i * (R - L) / 10) * s
        dr.line([(x, TOP * s), (x, BOT * s)], fill=(214, 214, 210), width=2 * s // 2 or 1)
    k = 0
    for y in range(TOP, BOT + 1, 100):
        strong = (k % 5 == 0)
        dr.line([(L * s, y * s), (R * s, y * s)], fill=(168, 168, 164) if strong else (214, 214, 210), width=s * (2 if strong else 1))
        k += 1
    # marco de la pista (negro) y rótulo de escala
    dr.rectangle([L * s, TOP * s, R * s, BOT * s], outline=(20, 20, 20), width=3 * s)
    # trazo del GR (verde), grosor 3 px
    pts = [((L + v / 150.0 * (R - L)) * s, (TOP + (d - D0) / DZ) * s) for d, v in zip(depth, gr)]
    dr.line(pts, fill=(28, 150, 60), width=3 * s, joint="curve")
    img = img.resize((W, H), Image.LANCZOS)
    a = np.asarray(img).astype(np.float64)
    rng = np.random.default_rng(7)
    a += rng.normal(0, 3.0, a.shape)                                         # ruido de escáner
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def homography(src, dst):
    """Homografía 3×3 que lleva los 4 puntos src a los 4 dst (mínimos cuadrados exactos con 4 puntos)."""
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b += [u, v]
    h = np.linalg.solve(np.array(A, float), np.array(b, float))
    return np.append(h, 1.0).reshape(3, 3)


def main(out):
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(2026)
    depth, gr = truth(rng)
    img = frontal(depth, gr)
    img.save(os.path.join(out, "scan-frontal.png"))

    # Perspectiva: el marco (con margen M) cae en un trapecio algo girado dentro de un lienzo mayor.
    frame = [(L - M, TOP - M), (R + M, TOP - M), (R + M, BOT + M), (L - M, BOT + M)]
    quad = [(205, 232), (868, 165), (902, 2688), (176, 2602)]
    W2, H2 = 1060, 2850
    Hm = homography(frame, quad)                       # frontal → fotografía
    Hi = np.linalg.inv(Hm)                             # fotografía → frontal (lo que pide PIL)
    Hi /= Hi[2, 2]
    coeffs = (Hi[0, 0], Hi[0, 1], Hi[0, 2], Hi[1, 0], Hi[1, 1], Hi[1, 2], Hi[2, 0], Hi[2, 1])
    photo = img.transform((W2, H2), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(228, 226, 220))
    photo.save(os.path.join(out, "scan-perspectiva.png"))

    meta = {
        "W": W, "H": H, "W2": W2, "H2": H2, "L": L, "R": R, "TOP": TOP, "BOT": BOT, "M": M,
        "D0": D0, "DZ": DZ, "grMin": 0, "grMax": 150,
        "depth": [round(float(x), 4) for x in depth],
        "gr": [round(float(x), 4) for x in gr],
        "frame": frame, "quad": quad,
        "homography": Hm.tolist(),
    }
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(meta, f)
    print(f"ok: {len(depth)} muestras · frontal {W}x{H} · perspectiva {W2}x{H2} → {out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
