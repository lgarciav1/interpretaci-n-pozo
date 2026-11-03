"""Builds timeline60.json (the first 60 s) from the segment marks. Times in seconds; bar = 2.4 s (100 BPM)."""
import json, os, sys
D = sys.argv[1]
BAR = 2.4
FPS = 30
def marks(seg):
    m = json.load(open(os.path.join(D, seg, 'marks.json')))
    return {k: v for k, v in m['marks']}, m['frames']
m1, n1 = marks('seg1')
m2, n2 = marks('seg2')
F = lambda s: int(round(s * FPS))

clips, titles, cards, bigs, fades, flashes = [], [], [], [], [], []

# 1) Apertura: 0 → 8 compases
clips.append(dict(dir='opening/frames', ext='png', srcFrom=0, srcTo=575, start=0, end=8 * BAR))

# 2) Inicio + herramientas: seg1 [inicio → carga] ajustado a 4 compases (19.2 → 28.8)
a, b = m1['inicio'], m1['carga']
t0, t1 = 8 * BAR, 12 * BAR
clips.append(dict(dir='seg1', srcFrom=F(a), srcTo=F(b), start=t0, end=t1, speed=(b - a) / (t1 - t0), trans='cut',
                  cam=[dict(t=0, x=960, y=540, z=1.0), dict(t=t1 - t0, x=990, y=530, z=1.05)]))
flashes.append(dict(t=t0, amount=0.7))
titles.append(dict(t0=t0 + 0.6, t1=t1 - 0.3, kicker='Inicio', title='La sarta, herramienta por herramienta',
                   sub='Tocá cada herramienta: qué mide y qué curvas registra.'))

# 3) Carga y control de calidad: seg1 [carga → CUT] hasta 15.5 compases (37.2)
a, b = m1['carga'], m1['CUT']
t0, t1 = t1, 15.5 * BAR
clips.append(dict(dir='seg1', srcFrom=F(a), srcTo=F(b) - 1, start=t0, end=t1, speed=(b - a) / (t1 - t0), tin=0.35, trans='zoom',
                  cam=[dict(t=0, x=960, y=540, z=1.0), dict(t=(t1 - t0) * 0.45, x=960, y=520, z=1.06), dict(t=t1 - t0, x=990, y=560, z=1.12)]))
titles.append(dict(t0=t0 + 0.9, t1=t1 - 0.3, kicker='Carga', title='Cargá tu pozo',
                   sub='Excel, LAS o CSV: reconoce las curvas, convierte unidades y revisa la calidad.'))

# 4) Pozo cargado → entrada al pozo → visor: el clic cae justo antes de la caída (compás 17 = 40.8)
a = m1['con-pozo']
click_raw = m1['entrar'] + 0.9 + 0.12          # mover 0.9 s + pausa 0.12 s hasta el clic
t0 = t1
drop = 17 * BAR
# el clic debe caer ~0.25 s antes de la caída: empezar el clip de modo que (click_raw - a) + t0 = drop - 0.25
lead = (drop - 0.25) - t0
src_start = max(a, click_raw - lead)
end_raw = m1['visor'] + 1.4
t1 = t0 + (end_raw - src_start)
clips.append(dict(dir='seg1', srcFrom=F(src_start), srcTo=n1 - 1, start=t0, end=t1, speed=1, tin=0.5, trans='fade',
                  cam=[dict(t=0, x=960, y=540, z=1.08), dict(t=t1 - t0, x=960, y=540, z=1.0)]))
titles.append(dict(t0=t0 + 0.5, t1=drop - 0.15, kicker='Tu pozo', title='Su sarta, armada desde sus curvas', sub=''))

# 5) Visor: seg2 hasta el final del corte (compás 23 = 55.2)
t0 = t1
t1 = 23 * BAR
a, b = 0.0, m2['snapshot']
clips.append(dict(dir='seg2', srcFrom=0, srcTo=n2 - 1, start=t0, end=t1 + 4.8, speed=(b - a) / (t1 - t0), tin=0.4, trans='fade',
                  cam=[dict(t=0, x=960, y=540, z=1.0), dict(t=(t1 - t0) * 0.35, x=1010, y=520, z=1.14), dict(t=t1 - t0, x=1040, y=500, z=1.24),
                       dict(t=t1 - t0 + 4.8, x=1040, y=500, z=1.32)]))
titles.append(dict(t0=t0 + 0.6, t1=t1 - 0.2, kicker='Visor', title='Visor multipista',
                   sub='Miles de muestras, colores y escalas de la industria, navegación fluida.'))

# 6) Cierre
bigs.append(dict(t0=23 * BAR, t1=60.0, title='Del perfil medido a la interpretación.', sub='Presiones MDT · crossplots · corona · digitalizador · y mucho más — muy pronto.', dim=0.78))
fades.append(dict(t0=58.6, t1=60.0, dir='out'))

tl = dict(duration=60.0, clips=clips, titles=titles, cards=cards, bigs=bigs, fades=fades, flashes=flashes)
json.dump(tl, open(os.path.join(D, 'timeline60.json'), 'w'), indent=1)
for c in clips: print(f"{c['dir']:15s} {c['start']:6.2f}–{c['end']:6.2f}  src {c['srcFrom']}–{c['srcTo']}  x{c.get('speed', 1):.2f}")
