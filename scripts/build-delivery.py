"""Empaqueta artefactos locales con hashes; ZIP reproducible para los mismos archivos de entrada."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--projects', required=True, type=Path, help='Directorio generado con scripts/qa/delivery-seed.mjs')
parser.add_argument('--output', type=Path, default=Path('dist/entrega-p8.zip'))
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
files = {
    'Interpretacion.html': (root/'dist/index.html').read_bytes(),
    'Manual.html': (root/'docs/manual-entrega.html').read_bytes(),
    'datos/pozo_tp_perfiles.csv': (root/'datos/pozo_tp_perfiles.csv').read_bytes(),
    'proyectos/TP-base.pozo.json': (args.projects/'TP-base.pozo.json').read_bytes(),
    'proyectos/Ejemplo-sintetico.pozo.json': (args.projects/'Ejemplo-sintetico.pozo.json').read_bytes(),
}
files['LEEME.txt'] = '''Interpretación de perfiles · entrega P8

1. Extraé todos los archivos. Abrí Interpretacion.html en un navegador actual.
2. Leé Manual.html. Cargá proyectos/TP-base.pozo.json o el CSV del TP para empezar.
3. TP-base conserva datos originales y valores iniciales: no es una interpretación académica final.
4. Ejemplo-sintetico es exclusivamente QA: 18 muestras DRX, GR 25/135 gAPI y cutoff 0,5 conocidos.
5. Guardá tu trabajo con Proyecto > Guardar proyecto. El HTML de aplicación no contiene tu interpretación.
6. En Exportar > Informe descargás una copia HTML imprimible y el manual integrado.

Alcance: datos disponibles del TP. Condiciones inaccesibles permanecen desconocidas;
no se aplican correcciones sin su contrato. MGT es opcional.
Los JSON de diagnóstico y acompañantes de exportación se conservan junto al proyecto.

El navegador administrado de la validación bloqueó file:// antes de cargar el HTML.
Se verificó offline por HTTP local y con Worker/SubtleCrypto deshabilitados.
La apertura por doble clic en el navegador de destino queda pendiente de verificación.
Si existe una política institucional para archivos locales, usá un servidor HTTP local.

manifest.json lista tamaños y SHA-256 para comprobar integridad. No es una firma digital.
'''.encode('utf-8')
for name in ('proyectos/TP-base.pozo.json','proyectos/Ejemplo-sintetico.pozo.json'):
    if json.loads(files[name])['format'] != 'pozo-proyecto':
        raise ValueError(f'Proyecto inválido: {name}')
head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
dirty = bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip())
manifest = {'version':1,'sourceCommit':head,'sourceWorkingTreeDirty':dirty,
    'scope':'Software P8 con datos disponibles; TP base y ejemplo sintético claramente separados.',
    'validation':'Ver docs/validacion/2026-11-01-entrega-p8.md; apertura file:// bloqueada en entorno administrado.',
    'files':[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in sorted(files.items())]}
files['manifest.json'] = json.dumps(manifest,indent=2,ensure_ascii=False).encode('utf-8')
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for name,data in sorted(files.items()):
        entry = zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry,data,compresslevel=9)
print(json.dumps({'path':str(args.output),'bytes':args.output.stat().st_size,
    'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'files':len(files),'sourceCommit':head,'dirty':dirty}))
