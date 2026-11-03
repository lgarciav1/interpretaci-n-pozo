"""Pista original para el video de fiubaLog, sintetizada con numpy (sin samples externos).
Uso: python3 music.py salida.wav [duración_s]"""
import sys, wave
import numpy as np

SR = 44100
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 224.0
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
N = int(SR * (DUR + 4))
rng = np.random.default_rng(7)

L = np.zeros(N); R = np.zeros(N)
def add(sig, t, gain=1.0, pan=0.0, buf=None):
    i = int(t * SR)
    if i >= N: return
    sig = sig[: N - i]
    l, r = (buf if buf else (L, R))
    l[i:i + len(sig)] += sig * gain * (1 - pan) / 1.0
    r[i:i + len(sig)] += sig * gain * (1 + pan) / 1.0

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def env_adsr(n, a, d, s, rl, total):
    t = np.arange(n) / SR
    e = np.where(t < a, t / a, np.where(t < a + d, 1 - (1 - s) * (t - a) / d, s))
    rel_start = total - rl
    e = np.where(t > rel_start, e * np.clip(1 - (t - rel_start) / rl, 0, 1), e)
    return e

# Progresión (C mayor): Am – F – C – G, y en el puente Dm – F – Am – G
PROG_A = [[57, 60, 64], [53, 57, 60], [48, 55, 60, 64], [55, 59, 62]]
PROG_B = [[50, 57, 62, 65], [53, 57, 60, 65], [57, 60, 64, 69], [55, 59, 62, 67]]
ROOTS_A = [45, 41, 48, 43]
ROOTS_B = [38, 41, 45, 43]
nbars = int(np.ceil(DUR / BAR)) + 1
END_BAR = 23          # cierre: paran los tambores y suena el acorde final
DROP_BAR = 17         # entrada al pozo: entra el beat completo
TITLE_BAR = 7         # título fiubaLog
GROOVE_BAR = 8        # Inicio: groove liviano
BREAK = (15, 16)      # respiro antes de la entrada

def chord_for(bar):
    blk = DROP_BAR <= bar < END_BAR and bar % 8 >= 4
    i = bar % 4
    return (PROG_B[i], ROOTS_B[i]) if blk else (PROG_A[i], ROOTS_A[i])

def breakdown(bar):  # sin bombo: el título y el respiro antes de la entrada
    return bar == TITLE_BAR or bar in BREAK

# ── Pad (osciladores desafinados, armónicos suaves) ────────────────────────────────────────
PL = np.zeros(N); PR = np.zeros(N)
def pad_note(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for det, ph in ((-0.12, 0.0), (0.0, 1.3), (0.11, 2.1)):
        ff = f * 2 ** (det / 12)
        for h in range(1, 7):
            s += np.sin(2 * np.pi * ff * h * t + ph * h) / h ** 1.6
    return s * env_adsr(n, 0.9, 0.8, 0.8, 1.0, dur) * 0.05
for bar in range(nbars):
    if bar > END_BAR: break
    notes, _ = chord_for(bar)
    dur = BAR + 1.0
    if bar == END_BAR:
        notes, dur = [45, 52, 57, 60, 64, 72], 7.0  # La menor abierto, para cerrar
        notes = [48, 55, 60, 64, 67, 72]           # Do mayor: resolución luminosa
    for k, n in enumerate(notes):
        add(pad_note(midi(n), dur), bar * BAR, 1.0, (-0.35 if k % 2 else 0.35), (PL, PR))

# ── Bajo ───────────────────────────────────────────────────────────────────────────────────
def bass_note(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return s * env_adsr(n, 0.008, 0.15, 0.6, 0.06, dur) * 0.22
for bar in range(GROOVE_BAR - 1, END_BAR):
    _, root = chord_for(bar)
    pattern = [0, 1.5, 2, 3, 3.5] if bar >= DROP_BAR else [0, 2]
    for b in pattern:
        if breakdown(bar) and b > 0: continue
        add(bass_note(midi(root), BEAT * (0.45 if b % 1 else 0.9)), bar * BAR + b * BEAT)

# ── Arpegio con eco ────────────────────────────────────────────────────────────────────────
AL = np.zeros(N); AR = np.zeros(N)
def pluck(f, dur=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t + 0.5) + 0.1 * np.sin(6 * np.pi * f * t)
    return s * np.exp(-t * 7) * np.minimum(1, t / 0.004) * 0.075
for bar in range(2, END_BAR):
    notes, _ = chord_for(bar)
    up = sorted(notes)[:3]
    seq = [up[0] + 12, up[1] + 12, up[2] + 12, up[1] + 24, up[2] + 12, up[1] + 12, up[0] + 24, up[2] + 12]
    step = BEAT / 2
    for k, n in enumerate(seq):
        g = 0.75 if k % 2 else 1.0
        if bar >= DROP_BAR and k % 4 == 3: g *= 1.15
        add(pluck(midi(n)), bar * BAR + k * step, g, (0.25 if k % 2 else -0.25), (AL, AR))
# eco ping-pong de 3/8
d = int(BEAT * 0.75 * SR)
for rep in range(1, 4):
    g = 0.38 ** rep
    src_l, src_r = (AR, AL) if rep % 2 else (AL, AR)
    L[d * rep:] += src_l[:-d * rep] * g; R[d * rep:] += src_r[:-d * rep] * g
L += AL; R += AR

# ── Batería ────────────────────────────────────────────────────────────────────────────────
def kick():
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) * 0.55
def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n); x = np.diff(np.concatenate([[0], np.diff(np.concatenate([[0], x]))]))
    return x * np.exp(-t * (18 if open_ else 70)) * 0.035
def clap():
    n = int(0.3 * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n); x = x - np.convolve(x, np.ones(9) / 9, 'same')
    e = np.exp(-t * 16) + 0.6 * np.exp(-np.maximum(t - 0.012, 0) * 40) * (t > 0.012)
    return x * e * 0.13
K = kick(); duck = np.ones(N)
for bar in range(4, END_BAR):
    t0 = bar * BAR
    if bar < GROOVE_BAR or breakdown(bar):
        if bar not in BREAK:
            for b in range(4): add(hat(), t0 + (b + 0.5) * BEAT, 0.6, 0.3)
        continue
    full = bar >= DROP_BAR
    for b in range(4):
        add(K, t0 + b * BEAT, 1.0 if full else 0.8)
        i = int((t0 + b * BEAT) * SR); m = int(0.28 * SR)
        if i + m < N: duck[i:i + m] = np.minimum(duck[i:i + m], 0.55 + 0.45 * np.linspace(0, 1, m) ** 0.7)
    if full or bar >= 10:
        add(clap(), t0 + BEAT, 1.0 if full else 0.75, -0.1); add(clap(), t0 + 3 * BEAT, 1.0 if full else 0.75, -0.1)
    for b in range(8):
        add(hat(open_=(b == 7)), t0 + b * BEAT / 2, 1.0 if b % 2 else 0.55, 0.3)
    if full and bar % 4 == 3:
        for k in range(4): add(hat(), t0 + 3 * BEAT + k * BEAT / 4, 0.8, -0.3)

# Riser (ruido filtrado que sube) antes de la entrada al pozo y un golpe de platillo suave en la caída
def riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n); y = 0.0
    a = 0.02 + 0.5 * (t / dur) ** 2
    for i in range(0, n, 64):  # paso bajo de un polo con corte creciente
        for j in range(i, min(i + 64, n)):
            y += a[j] * (x[j] - y); out[j] = y
    return out * (t / dur) ** 1.5 * 0.25
add(riser(2 * BAR), (TITLE_BAR - 2) * BAR, 0.8)
add(riser(2 * BAR), (DROP_BAR - 2) * BAR, 1.0)
def crash():
    n = int(2.5 * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n); x = x - np.convolve(x, np.ones(5) / 5, 'same')
    return x * np.exp(-t * 2.2) * 0.07
add(crash(), TITLE_BAR * BAR, 0.9, -0.2); add(crash(), GROOVE_BAR * BAR, 0.5, 0.2); add(crash(), DROP_BAR * BAR, 1.0, 0.2); add(crash(), END_BAR * BAR, 0.8, -0.2)
# golpe grave en el título y en la entrada
for tb in (TITLE_BAR, DROP_BAR):
    nb = int(1.6 * SR); tt = np.arange(nb) / SR
    add(np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-tt * 9)) / SR) * np.exp(-tt * 2.2) * 0.5, tb * BAR)

# ── Mezcla: pad con compresión lateral, reverb por convolución ─────────────────────────────
L += PL * duck; R += PR * duck

def fftconv(x, ir):
    out = np.zeros(len(x) + len(ir) - 1); B = 1 << 18
    nfft = 1 << int(np.ceil(np.log2(B + len(ir))))
    H = np.fft.rfft(ir, nfft)
    for i in range(0, len(x), B):
        seg = x[i:i + B]
        y = np.fft.irfft(np.fft.rfft(seg, nfft) * H, nfft)[: len(seg) + len(ir) - 1]
        out[i:i + len(y)] += y
    return out[: len(x)]
irn = int(2.2 * SR); ti = np.arange(irn) / SR
irL = rng.standard_normal(irn) * np.exp(-ti * 2.6); irR = rng.standard_normal(irn) * np.exp(-ti * 2.6)
irL /= np.sqrt((irL ** 2).sum()); irR /= np.sqrt((irR ** 2).sum())
wet = 0.22
L2 = L + wet * fftconv(L, irL); R2 = R + wet * fftconv(R, irR)

# Fundidos y normalización con saturación suave
t = np.arange(N) / SR
fade = np.clip(t / 2.0, 0, 1) * np.clip((DUR - t) / 3.0, 0, 1)
mix = np.stack([L2, R2], 1) * fade[:, None]
mix = mix[: int(DUR * SR)]
mix /= np.abs(mix).max()
mix = np.tanh(mix * 1.4) / np.tanh(1.4) * 0.89
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', mix.shape[0] / SR, 's')
