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
    """Serie por muestra del gráfico de presión capilar: X = Sw mojante (%), Y = Pc (kg/cm²)."""
    root = next(r for r in (ET.fromstring(z.read(c)) for c in charts) if title(r).startswith(PC_TITLE))
    out = {}
    for s in root.iter(f'{{{NS["c"]}}}ser'):
        name = s.findtext('c:tx//c:v', namespaces=NS)
        xv, yv = s.find('c:xVal', NS), s.find('c:yVal', NS)
        if not name or xv is None or yv is None:
            continue
        x, y = cache(xv), cache(yv)
        pts = [(y[i], x[i]) for i in sorted(y) if i in x]
        out[norm(name)] = pts
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
