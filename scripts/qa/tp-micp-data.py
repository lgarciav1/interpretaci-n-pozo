"""Genera src/modules/rock-typing/tpMicp.ts con las curvas de inyección de mercurio (MICP) del TP.

Uso: python3 scripts/qa/tp-micp-data.py TP_interpretacion_de_Pozo.xlsx

Las curvas no están en las celdas de la hoja SCAL: los gráficos «Presiones Capilares - Método de inyección de mercurio»
y siguientes toman los datos de un libro externo del laboratorio (Jorge-Pcapilar OCS-G-169.xls), pero Excel guarda
una copia de cada punto dentro del gráfico (caché `c:numCache`). Este script lee esa copia del XML del .xlsx (openpyxl
no lee los gráficos) y la une con la tabla «diámetro de garganta poral» de la hoja SCAL (k de gas y φ) por nombre de
muestra. Cada muestra se ubica en profundidad con el plug de corona del mismo número (1-32 → C1-32; las «L» y «CK»
son subplugs del mismo nivel): profundidad APROXIMADA, ver docs/decisiones/0087-micp-del-tp.md.
"""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET
import openpyxl

NS = {
    'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}
PC_TITLE = 'Presiones Capilares'
THROAT_TITLE = 'DISTRIBUTION OF PORE THROAT DIAMETER'


def norm(name):
    """'2-6-L' (gráficos) y '2-6L' (tabla) son la misma muestra."""
    return re.sub(r'-(L|CK)$', r'\1', name.strip())


def rels(z, path):
    folder, base = path.rsplit('/', 1)
    out = {}
    for r in ET.fromstring(z.read(f'{folder}/_rels/{base}.rels')):
        tgt = r.get('Target')
        out[r.get('Id')] = tgt if tgt.startswith('/') else re.sub(r'[^/]+/\.\./', '', f'{folder}/{tgt}')
    return out


def sheet_charts(z, sheet_name):
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rid = next(s.get(f'{{{NS["r"]}}}id') for s in wb.iter(f'{{{NS["m"]}}}sheet') if s.get('name') == sheet_name)
    sheet = rels(z, 'xl/workbook.xml')[rid]
    drawing = next(t for t in rels(z, sheet).values() if '/drawings/' in t)
    return [t for t in rels(z, drawing).values() if '/charts/chart' in t]


def cache(el):
    return {int(p.get('idx')): float(p.findtext('c:v', namespaces=NS)) for p in el.iter(f'{{{NS["c"]}}}pt')}


def title(root):
    t = root.find('.//c:chart/c:title', NS)
    return ''.join(x.text or '' for x in t.iter(f'{{{NS["a"]}}}t')) if t is not None else ''


def pc_curves(z, charts):
    """Serie por muestra del gráfico de presión capilar: X = Sw mojante (%), Y = Pc (kg/cm²).

    Si alguna muestra quedó truncada en el gráfico de Pc (como 2-15, cuyo rango en el Excel corta en la fila 28),
    completa los escalones faltantes desde la serie acumulada del gráfico «DISTRIBUTION OF PORE THROAT DIAMETER»,
    que comparte la misma grilla de 37 presiones/diámetros.
    """
    roots = [ET.fromstring(z.read(c)) for c in charts]
    root = next(r for r in roots if title(r).startswith(PC_TITLE))
    out = {}
    for s in root.iter(f'{{{NS["c"]}}}ser'):
        name = s.findtext('c:tx//c:v', namespaces=NS)
        xv, yv = s.find('c:xVal', NS), s.find('c:yVal', NS)
        if not name or xv is None or yv is None:
            continue
        x, y = cache(xv), cache(yv)
        pts = [(y[i], x[i]) for i in sorted(y) if i in x]
        out[norm(name)] = pts

    full_pc = max((p for p in out.values()), key=len)
    pc_grid = [p for p, _ in full_pc]
    throat_sw = {}
    for r in roots:
        if not title(r).upper().startswith(THROAT_TITLE):
            continue
        for s in r.iter(f'{{{NS["c"]}}}ser'):
            name = s.findtext('c:tx//c:v', namespaces=NS)
            xv, yv = s.find('c:xVal', NS), s.find('c:yVal', NS)
            if not name or xv is None or yv is None:
                continue
            x, y = cache(xv), cache(yv)
            # La acumulada empieza en Sw = 100 %; la incremental empieza en 0 %.
            if len(x) == len(pc_grid) and x.get(0, 0) > 50:
                throat_sw[norm(name)] = [x[i] for i in sorted(x)]

    for name, pts in list(out.items()):
        if len(pts) < len(pc_grid) and name in throat_sw:
            sw_full = throat_sw[name]
            assert all(abs(pts[i][0] - pc_grid[i]) < 1e-6 and abs(pts[i][1] - sw_full[i]) < 1e-4 for i in range(len(pts))), name
            out[name] = list(zip(pc_grid, sw_full))
    return out


def main(path):
    z = zipfile.ZipFile(path)
    curves = pc_curves(z, sheet_charts(z, 'SCAL'))
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    thr = {norm(str(r[4])): (r[5], r[6]) for r in wb['SCAL'].iter_rows(min_row=92, max_row=99, values_only=True) if r[4]}
    core = open('src/modules/core/tpData.ts', encoding='utf8').read()
    plugs = {p['id']: p for p in json.loads(re.search(r'TP_CORE_PLUGS: readonly TpCorePlug\[\] = (\[.*?\]);', core, re.S).group(1))}
    samples = []
    for name in thr:  # orden de la tabla de garganta poral
        pts = curves[name]
        pc = [round(p, 6) for p, _ in pts]
        sw = [round(s, 4) for _, s in pts]
        assert all(pc[i] < pc[i + 1] for i in range(len(pc) - 1)), name
        assert all(sw[i] >= sw[i + 1] for i in range(len(sw) - 1)), name
        run, num = re.match(r'(\d)-(\d+)', name).groups()
        plug = plugs[f'C{run}-{int(num):02d}']
        k, phi = thr[name]
        samples.append(dict(sample=name, plugId=plug['id'], depthM=plug['depthM'], kGasMd=round(k, 4), phiPct=round(phi, 4), pcKgCm2=pc, swPct=sw))
    js = json.dumps(samples, ensure_ascii=False, separators=(',', ':'))
    open('src/modules/rock-typing/tpMicp.ts', 'w', encoding='utf8').write(f'''/**
 * Curvas de inyección de mercurio (MICP) del TP. GENERADO por scripts/qa/tp-micp-data.py: no editar a mano.
 *
 * {len(samples)} muestras de la hoja SCAL del Excel de la cátedra. Los puntos salen de la copia que guarda el gráfico
 * «Presiones Capilares - Método de inyección de mercurio» (el libro del laboratorio no viene con el Excel); k de gas (mD)
 * y φ (%) de la tabla «diámetro de garganta poral» de la misma hoja.
 * - `pcKgCm2`: presión de inyección mercurio–aire (kg/cm²), creciente.
 * - `swPct`: saturación de la fase mojante (100 − SHg, % del volumen poral), no creciente.
 * - `plugId` y `depthM`: el plug de corona del mismo número (profundidad corregida de la hoja PB). Es una asignación
 *   por nombre: aproximada (docs/decisiones/0087-micp-del-tp.md).
 */
export interface TpMicpSample {{
  sample: string;
  plugId: string;
  depthM: number;
  kGasMd: number;
  phiPct: number;
  pcKgCm2: readonly number[];
  swPct: readonly number[];
}}
export const TP_MICP_SAMPLES: readonly TpMicpSample[] = {js};
''')
    print(len(samples), [(s['sample'], len(s['pcKgCm2'])) for s in samples])


if __name__ == '__main__':
    main(sys.argv[1])
