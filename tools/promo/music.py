"""Banda sonora original para la promo (80 s, 96 BPM). Síntesis aditiva + reverb por convolución."""
import numpy as np, wave

SR = 48000
DUR = 80.0
N = int(SR * DUR)
t = np.arange(N) / SR
BEAT = 60 / 96
rng = np.random.default_rng(7)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def env_adsr(n, a, r, sr=SR):
    e = np.ones(n)
    na, nr = int(a * sr), int(r * sr)
    if na: e[:na] = np.linspace(0, 1, na) ** 2
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e
def smooth(x, w):
    k = np.ones(w) / w
    return np.convolve(x, k, mode='same')
def interp(points):
    xs, ys = zip(*points)
    return np.interp(t, xs, ys)

# Brillo del pad según la energía del video
bright = interp([(0, 0.05), (7, 0.15), (14.5, 0.35), (15, 0.75), (20, 0.6), (27.5, 0.8), (63, 0.85), (68.75, 0.55), (72.5, 0.9), (80, 0.3)])

CHORDS = {
    'Bm': [47, 54, 57, 61, 62, 66],
    'G':  [43, 50, 54, 57, 59, 66],
    'A':  [45, 52, 57, 59, 61, 64],
    'D':  [50, 57, 61, 64, 66, 69],
}
SEQ = ['Bm', 'G', 'A', 'D']
def chord_at(i, start):
    if start >= 72.5 - 1e-6: return 'D'
    return SEQ[i % 4]

# segmentos de acordes (el final es D desde 72,5)
segs = []
s = 0.0; i = 0
while s < 72.5 - 1e-6:
    e = min(s + 5.0, 72.5)
    segs.append((s, e, SEQ[i % 4])); s = e; i += 1
segs.append((72.5, DUR, 'D'))

L = np.zeros(N); R = np.zeros(N)

# ── Pad ──
pad_L = np.zeros(N); pad_R = np.zeros(N)
for (s0, s1, name) in segs:
    a0 = max(0, int((s0 - 0.6) * SR)); a1 = min(N, int((s1 + 2.2) * SR))
    n = a1 - a0
    tt = t[a0:a1]
    e = env_adsr(n, 1.4 if s0 > 0 else 3.5, 2.6)
    b = bright[a0:a1]
    for m in CHORDS[name]:
        f0 = mtof(m)
        for v, det in enumerate([-0.07, 0.0, 0.07]):
            f = f0 * 2 ** (det / 12)
            ph = rng.uniform(0, 2 * np.pi)
            sig = np.zeros(n)
            for k in range(1, 9):
                if f * k > 6000: break
                amp = (1 / k ** 1.25) * np.exp(-(k - 1) / (0.6 + 5.5 * b))
                sig += amp * np.sin(2 * np.pi * f * k * tt + ph * k)
            pan = [-0.6, 0.0, 0.6][v]
            g = 0.018 * (1.0 if m > 48 else 0.8)
            pad_L[a0:a1] += sig * e * g * (1 - pan) / 2 * 2
            pad_R[a0:a1] += sig * e * g * (1 + pan) / 2 * 2
# leve trémolo lento
trem = 1 + 0.06 * np.sin(2 * np.pi * 0.11 * t)
pad_L *= trem; pad_R *= trem[::-1] if False else trem
pad_gain = interp([(0, 0.85), (7.5, 0.9), (15, 1.0), (68.75, 1.0), (72.5, 1.1), (80, 0.9)])
pad_L *= pad_gain; pad_R *= pad_gain

# ── Bajo con bombeo ──
bass = np.zeros(N)
for (s0, s1, name) in segs:
    if s1 <= 15: continue
    a0 = int(max(s0, 15) * SR); a1 = min(N, int(s1 * SR) + int(0.05 * SR))
    tt = t[a0:a1]
    f = mtof(CHORDS[name][0] - 12)
    sig = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt)
    bass[a0:a1] += sig * env_adsr(a1 - a0, 0.08, 0.15)
phase = (t % BEAT) / BEAT
pump = 0.35 + 0.65 * np.clip(phase / 0.45, 0, 1) ** 0.7
bass_gain = interp([(0, 0), (15, 0), (15.2, 0.11), (68.75, 0.11), (70, 0.05), (72.5, 0.12), (78, 0.08), (80, 0)])
bass *= pump * bass_gain

# ── Arpegio (pluck) ──
arp_L = np.zeros(N); arp_R = np.zeros(N)
EIGHTH = BEAT / 2
pattern = [3, 4, 5, 4, 2, 4, 5, 3]
def pluck(f, n):
    tt = np.arange(n) / SR
    e = np.exp(-tt / 0.22) * np.minimum(1, tt / 0.003)
    return e * (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt / 0.08) + 0.12 * np.sin(2 * np.pi * 3 * f * tt) * np.exp(-tt / 0.05))
arp_on = lambda x: (20.0 <= x < 68.75)
step = 0
x = 20.0
while x < 68.75:
    ci = [c for c in segs if c[0] <= x < c[1]][0][2]
    m = CHORDS[ci][pattern[step % 8]] + 12
    n = int(0.9 * SR)
    a0 = int(x * SR)
    sig = pluck(mtof(m), min(n, N - a0))
    vel = 0.8 + 0.2 * ((step % 4) == 0)
    g = 0.05 * vel * (0.6 if x < 27.5 else 1.0)
    pan = 0.35 * np.sin(step * 0.9)
    arp_L[a0:a0 + len(sig)] += sig * g * (1 - pan)
    arp_R[a0:a0 + len(sig)] += sig * g * (1 + pan)
    x += EIGHTH; step += 1
# delay ping-pong de corchea con puntillo
d = int(BEAT * 0.75 * SR)
dl, dr = np.zeros(N), np.zeros(N)
fb = 0.38
srcL, srcR = arp_L.copy(), arp_R.copy()
for k in range(1, 6):
    sh = d * k
    if sh >= N: break
    g = fb ** k
    if k % 2:
        dr[sh:] += srcL[:-sh] * g; dl[sh:] += srcR[:-sh] * g
    else:
        dl[sh:] += srcL[:-sh] * g; dr[sh:] += srcR[:-sh] * g
arp_L += smooth(dl, 6) * 0.7; arp_R += smooth(dr, 6) * 0.7

# ── Percusión suave ──
drums = np.zeros(N)
def kick(n):
    tt = np.arange(n) / SR
    f = 42 + 70 * np.exp(-tt / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt / 0.32)
def tick(n):
    tt = np.arange(n) / SR
    nz = rng.standard_normal(n)
    nz = nz - smooth(nz, 3)  # paso alto simple
    return nz * np.exp(-tt / 0.025)
kk = kick(int(0.6 * SR)); tk = tick(int(0.12 * SR))
x = 27.5
while x < 68.6:
    a0 = int(x * SR)
    drums[a0:a0 + len(kk)] += kk * 0.16
    x += BEAT
x = 37.5 + EIGHTH
while x < 68.6:
    a0 = int(x * SR)
    drums[a0:a0 + len(tk)] += tk * 0.022
    x += BEAT
drums_L = drums.copy(); drums_R = drums.copy()

# ── Impactos, subidas y transiciones ──
fx_L = np.zeros(N); fx_R = np.zeros(N)
def boom(at, gain):
    n = int(3.5 * SR); a0 = int(at * SR); n = min(n, N - a0)
    tt = np.arange(n) / SR
    f = 34 + 60 * np.exp(-tt / 0.12)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-tt / 1.1)
    nz = smooth(rng.standard_normal(n), 30) * np.exp(-tt / 0.5) * 0.6
    fx_L[a0:a0 + n] += (s + nz) * gain; fx_R[a0:a0 + n] += (s + nz * 0.9) * gain
def riser(end, length, gain):
    n = int(length * SR); a0 = int(end * SR) - n
    tt = np.arange(n) / n
    nz = rng.standard_normal(n)
    # filtro que se abre: mezcla de ruido suavizado a muy suavizado
    lo = smooth(nz, 40); hi = smooth(nz, 4)
    s = (lo * (1 - tt) + hi * tt) * tt ** 2.2
    fx_L[a0:a0 + n] += s * gain; fx_R[a0:a0 + n] += np.roll(s, 200) * gain
def whoosh(at, gain):
    n = int(1.0 * SR); a0 = int((at - 0.45) * SR)
    tt = np.arange(n) / n
    nz = smooth(smooth(rng.standard_normal(n), 24), 12)
    e = np.sin(np.pi * tt) ** 2
    fx_L[a0:a0 + n] += nz * e * gain * (1 - tt); fx_R[a0:a0 + n] += nz * e * gain * tt
def bell(at, m, gain):
    n = int(4 * SR); a0 = int(at * SR)
    tt = np.arange(n) / SR
    f = mtof(m)
    s = (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.6) + 0.2 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt / 0.25))
    s *= np.exp(-tt / 1.4) * np.minimum(1, tt / 0.004)
    fx_L[a0:a0 + n] += s * gain; fx_R[a0:a0 + n] += s * gain * 0.85

bell(0.45, 81, 0.05); bell(2.6, 78, 0.045); bell(4.4, 74, 0.04); bell(6.2, 76, 0.035)
riser(15.0, 3.0, 0.07); boom(15.0, 0.42); bell(15.0, 86, 0.05)
riser(72.5, 3.2, 0.07); boom(72.5, 0.42); bell(72.5, 86, 0.05); bell(73.2, 81, 0.035)
for at in [7.5, 20.0, 27.5, 32.5, 37.5, 41.25, 45.0, 48.75, 53.75, 58.75, 63.75, 68.75]:
    whoosh(at, 0.06)
boom(20.0, 0.14); boom(37.5, 0.12); boom(63.75, 0.12)

# ── Reverb por convolución ──
def reverb(x, secs=3.2, seed=1):
    r = np.random.default_rng(seed)
    n = int(secs * SR)
    tt = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-tt / (secs / 6.5))
    ir = smooth(ir, 8)
    ir[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    ir /= np.sqrt(np.sum(ir ** 2))
    m = len(x) + n
    nfft = 1 << (m - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
    return y
send_L = pad_L * 0.5 + arp_L * 0.6 + fx_L * 0.5
send_R = pad_R * 0.5 + arp_R * 0.6 + fx_R * 0.5
rv_L = reverb(send_L, seed=1); rv_R = reverb(send_R, seed=2)

L = pad_L + bass + arp_L + drums_L + fx_L + rv_L * 0.55
R = pad_R + bass + arp_R + drums_R + fx_R + rv_R * 0.55

master = interp([(0, 0), (0.6, 1), (77.5, 1), (80, 0)])
L *= master; R *= master
peak = max(np.abs(L).max(), np.abs(R).max())
L = np.tanh(L / peak * 1.25) / np.tanh(1.25) * 0.89
R = np.tanh(R / peak * 1.25) / np.tanh(1.25) * 0.89
out = (np.stack([L, R], 1) * 32767).astype(np.int16)
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('ok', peak)
