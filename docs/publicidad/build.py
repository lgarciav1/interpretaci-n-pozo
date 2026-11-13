#!/usr/bin/env python3
"""
Arma el film publicitario de fiubaLog («7.633 metros») a partir de `film.src.html`.

Embebe en un único HTML:
- las curvas medidas del pozo del TP (`datos/pozo_tp_perfiles.csv`),
- las presiones MDT y los plugs de corona reales del TP (`src/modules/{mdt,core}/tpData.ts`),
- cuatro capturas reales de la app (`docs/capturas/`), convertidas a WebP.

Salidas:
- `docs/publicidad/fiubalog-film.html`: autocontenido, se abre con doble clic (las fuentes web son opcionales).
- con `--artifact RUTA`: la misma página sin el esqueleto <html>, para publicarla como Artifact.

Uso: python3 docs/publicidad/build.py [--artifact /ruta/film.html]
"""
import base64
import csv
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def well_data() -> dict:
    rows = list(csv.DictReader(open(ROOT / "datos" / "pozo_tp_perfiles.csv", encoding="utf-8")))
    num = lambda s: float(s) if s != "" else None

    def packed(col: str, scale: int, lo: float, hi: float) -> list:
        out, last = [], None
        for r in rows:
            v = num(r[col])
            if v is None or v < lo or v > hi:  # sin dato o lectura imposible: se mantiene la última válida
                v = last
            last = v if v is not None else last
            out.append(v)
        first = next(v for v in out if v is not None)
        return [round((first if v is None else v) * scale) for v in out]

    zones, start = [], 0
    for i in range(1, len(rows) + 1):
        if i == len(rows) or rows[i]["ZONA"] != rows[start]["ZONA"]:
            zones.append([rows[start]["ZONA"], start, i - 1])
            start = i
    depth = [num(r["DEPTH"]) for r in rows]
    mdt = json.loads(re.search(r"TP_MDT_POINTS[^=]*= (\[.*?\]);", (ROOT / "src/modules/mdt/tpData.ts").read_text(encoding="utf-8"), re.S).group(1))
    core = json.loads(re.search(r"TP_CORE_PLUGS[^=]*= (\[.*?\]);", (ROOT / "src/modules/core/tpData.ts").read_text(encoding="utf-8"), re.S).group(1))
    return {
        "n": len(rows),
        "z0": depth[0],
        "step": round((depth[-1] - depth[0]) / (len(rows) - 1), 6),
        "zones": zones,
        "gr": packed("GR", 10, 0, 400),
        "rhob": packed("ZDEN", 1000, 1.5, 3.2),
        "nphi": packed("NPHI", 1000, -0.15, 0.6),  # los picos de hasta 3,3 v/v son imposibles (datos/README.md)
        "rt": packed("AT90", 1000, 0.05, 2000),
        "rs": packed("AT10", 1000, 0.05, 30),  # picos aislados de hasta 110 ohm·m
        "mdt": [[m["depthM"], m["pressurePsi"], m["zone"]] for m in mdt],
        "core": [[c["depthM"], round(c["depthFt"] * 0.3048, 3), c["phi"], c["kMd"], c["run"]] for c in core],
    }


def webp(path: str, width: int, crop=None, quality: int = 80) -> str:
    im = Image.open(ROOT / path).convert("RGB")
    if crop:
        im = im.crop(crop)
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    src = (HERE / "film.src.html").read_text(encoding="utf-8")
    images = {
        "hero": webp("docs/capturas/revision-ux/despues-1920-oscuro.png", 1600),
        "pickett": webp("docs/capturas/8b-pickett-por-zona-oscuro.png", 1400),
        "mdt": webp("docs/capturas/mdt-scal-tp/mdt-tp-dark.png", 1014, quality=84),
        "home": webp("docs/capturas/marca/despues-inicio-dark.jpg", 1400),
    }
    page = src.replace("/*@@DATA@@*/null", json.dumps(well_data(), separators=(",", ":"))).replace("/*@@IMG@@*/null", json.dumps(images))
    assert "@@" not in page, "quedó un marcador sin reemplazar"
    standalone = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + page + "\n</body>\n</html>\n"
    out = HERE / "fiubalog-film.html"
    out.write_text(standalone, encoding="utf-8")
    print(f"{out.relative_to(ROOT)}: {out.stat().st_size / 1024:.0f} kB")
    if "--artifact" in sys.argv:
        target = Path(sys.argv[sys.argv.index("--artifact") + 1])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page, encoding="utf-8")
        print(f"{target}: {target.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
