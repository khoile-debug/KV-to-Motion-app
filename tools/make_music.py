#!/usr/bin/env python3
"""Tổng hợp thư viện nhạc nền gốc (royalty-free, do chính dự án tạo ra).

Mỗi bài là một vòng lặp nhạc cụ ~24-32s, 44.1kHz stereo, kèm metadata trong
library/music/library.json (mood, bpm, energy, license). Chạy lại:
    python3 tools/make_music.py
"""
import json, os, wave
import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'library', 'music')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

def note_freq(n):  # MIDI -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)

def env(n, a=0.01, d=0.1, s=0.7, r=0.2):
    t = np.arange(n) / SR
    total = n / SR
    e = np.ones(n) * s
    e[t < a] = t[t < a] / a
    m = (t >= a) & (t < a + d)
    e[m] = 1 - (1 - s) * (t[m] - a) / d
    rel = t > total - r
    e[rel] *= np.clip((total - t[rel]) / r, 0, 1)
    return e

def osc(freq, n, kind='sine', detune=0.0):
    t = np.arange(n) / SR
    ph = 2 * np.pi * freq * (1 + detune) * t
    if kind == 'sine':
        return np.sin(ph)
    if kind == 'saw':
        return 2 * ((freq * (1 + detune) * t) % 1) - 1
    if kind == 'square':
        return np.sign(np.sin(ph)) * 0.6
    if kind == 'tri':
        return 2 * np.abs(2 * ((freq * t) % 1) - 1) - 1
    if kind == 'epiano':
        return np.sin(ph + 1.2 * np.sin(2 * ph) * np.exp(-t * 3))
    if kind == 'pluck':
        return np.sin(ph) * np.exp(-t * 6) + 0.3 * np.sin(2 * ph) * np.exp(-t * 9)
    raise ValueError(kind)

def lowpass(x, alpha):
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):  # simple one-pole (only used on short buffers)
        acc += alpha * (x[i] - acc)
        y[i] = acc
    return y

def kick(n):
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)

def snare(n):
    t = np.arange(n) / SR
    return (rng.standard_normal(n) * 0.6 + 0.4 * np.sin(2 * np.pi * 190 * t)) * np.exp(-t * 18)

def hat(n, open_=False):
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))  # crude highpass
    return x * np.exp(-t * (12 if open_ else 60)) * 0.35

def clap(n):
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    e = np.exp(-t * 25) + 0.5 * np.exp(-np.maximum(t - 0.012, 0) * 25) * (t > 0.012)
    return x * e * 0.5

def place(buf, sig, start, gain=1.0, pan=0.0):
    s = int(start * SR)
    e = min(len(buf), s + len(sig))
    if s >= len(buf):
        return
    l = np.sqrt(0.5 * (1 - pan)); r = np.sqrt(0.5 * (1 + pan))
    buf[s:e, 0] += sig[: e - s] * gain * l
    buf[s:e, 1] += sig[: e - s] * gain * r

CHORDS = {  # semitone offsets from root for chord qualities
    'maj': [0, 4, 7], 'min': [0, 3, 7], 'maj7': [0, 4, 7, 11], 'min7': [0, 3, 7, 10],
    'sus2': [0, 2, 7], 'add9': [0, 4, 7, 14],
}

def track(spec):
    bpm = spec['bpm']; beat = 60 / bpm
    bars = spec.get('bars', 8)
    dur = bars * 4 * beat
    n = int(dur * SR) + SR  # 1s tail
    buf = np.zeros((n, 2))
    prog = spec['progression']  # list of (root_midi, quality) per bar
    for b in range(bars):
        root, q = prog[b % len(prog)]
        t0 = b * 4 * beat
        # pad / chords
        if spec.get('pad'):
            kind = spec['pad']
            for k, iv in enumerate(CHORDS[q]):
                f = note_freq(root + 12 + iv)
                ln = int(4 * beat * SR)
                sig = (osc(f, ln, kind, 0.003) + osc(f, ln, kind, -0.003)) * 0.5
                sig *= env(ln, a=0.3, d=0.5, s=0.8, r=0.6)
                place(buf, sig, t0, spec.get('pad_gain', 0.06), pan=(k - 1) * 0.4)
        # rhythmic chord stabs
        if spec.get('stab'):
            for st in spec['stab']:
                for iv in CHORDS[q]:
                    f = note_freq(root + 12 + iv)
                    ln = int(0.45 * beat * SR)
                    sig = osc(f, ln, spec.get('stab_kind', 'epiano')) * env(ln, 0.005, 0.1, 0.5, 0.1)
                    place(buf, sig, t0 + st * beat, spec.get('stab_gain', 0.05))
        # bass
        if spec.get('bass'):
            for st in spec['bass']:
                f = note_freq(root - 12)
                ln = int(0.9 * beat * SR)
                sig = osc(f, ln, spec.get('bass_kind', 'tri')) * env(ln, 0.005, 0.2, 0.6, 0.1)
                place(buf, sig, t0 + st * beat, spec.get('bass_gain', 0.22))
        # arpeggio
        if spec.get('arp'):
            step = spec['arp']  # in beats
            notes = CHORDS[q] + [12]
            k = 0
            t = 0.0
            while t < 4 - 1e-6:
                iv = notes[k % len(notes)]
                f = note_freq(root + 24 + iv + spec.get('arp_oct', 0))
                ln = int(step * beat * SR * 1.6)
                sig = osc(f, ln, spec.get('arp_kind', 'pluck')) * env(ln, 0.003, 0.08, 0.3, 0.1)
                place(buf, sig, t0 + t * beat, spec.get('arp_gain', 0.05), pan=0.3 * np.sin(k))
                k += 1; t += step
        # melody (pentatonic hook) — deterministic pattern
        if spec.get('melody'):
            scale = spec['melody']
            pattern = spec.get('mel_pattern', [0, 2, 4, 2, 3, 1, 0, -1])
            for i, deg in enumerate(pattern):
                if deg < 0:
                    continue
                f = note_freq(root + 24 + scale[deg % len(scale)])
                ln = int(0.5 * beat * SR * 1.5)
                sig = osc(f, ln, spec.get('mel_kind', 'pluck')) * env(ln, 0.005, 0.1, 0.4, 0.15)
                place(buf, sig, t0 + i * 0.5 * beat, spec.get('mel_gain', 0.06))
        # drums
        dr = spec.get('drums')
        if dr:
            for s16 in range(16):
                t = t0 + s16 * beat / 4
                if s16 in dr.get('kick', []):
                    place(buf, kick(int(0.4 * SR)), t, dr.get('kg', 0.55))
                if s16 in dr.get('snare', []):
                    place(buf, snare(int(0.25 * SR)), t, dr.get('sg', 0.22))
                if s16 in dr.get('clap', []):
                    place(buf, clap(int(0.25 * SR)), t, dr.get('cg', 0.25))
                if s16 in dr.get('hat', []):
                    place(buf, hat(int(0.08 * SR)), t, dr.get('hg', 0.5), pan=0.2)
                if s16 in dr.get('ohat', []):
                    place(buf, hat(int(0.3 * SR), True), t, dr.get('hg', 0.5), pan=-0.2)
    # simple stereo "room": short delays
    out = buf.copy()
    for d, g in ((0.031, 0.18), (0.047, 0.12), (0.093, 0.08)):
        k = int(d * SR)
        out[k:, 0] += buf[:-k, 1] * g
        out[k:, 1] += buf[:-k, 0] * g
    out = out[: int(dur * SR)]
    # soft clip + normalize to -1 dBFS
    out = np.tanh(out * 1.2)
    out /= max(1e-9, np.abs(out).max()) / 0.89
    return out, dur

FOUR = [0, 4, 8, 12]
SPECS = [
    dict(id='upbeat-pop', title='Sunny Market', mood=['energetic', 'playful', 'sale', 'fmcg', 'fashion'],
         energy=0.8, bpm=118, progression=[(60, 'maj'), (67, 'maj'), (69, 'min'), (65, 'maj')],
         pad='saw', pad_gain=0.025, stab=[0.5, 1.5, 2.5, 3.5], stab_kind='epiano', stab_gain=0.05,
         bass=[0, 1, 2, 3], bass_kind='tri', melody=[0, 2, 4, 7, 9], mel_pattern=[0, 2, 4, 4, 3, -1, 2, 1],
         drums=dict(kick=FOUR, clap=[4, 12], hat=[2, 6, 10, 14], kg=0.5)),
    dict(id='calm-ambient', title='Soft Morning', mood=['calm', 'beauty', 'spa', 'healthcare', 'minimal'],
         energy=0.25, bpm=80, progression=[(62, 'maj7'), (67, 'maj7'), (64, 'min7'), (69, 'sus2')],
         pad='sine', pad_gain=0.09, arp=0.5, arp_kind='sine', arp_gain=0.035, bass=[0], bass_kind='sine',
         bass_gain=0.15),
    dict(id='luxury-lounge', title='Velvet Night', mood=['luxury', 'elegant', 'premium', 'cosmetics', 'real-estate'],
         energy=0.45, bpm=92, progression=[(57, 'min7'), (62, 'min7'), (55, 'maj7'), (60, 'maj7')],
         pad='tri', pad_gain=0.05, stab=[1, 2.5], stab_kind='epiano', stab_gain=0.06, bass=[0, 2.5],
         bass_kind='sine', bass_gain=0.25,
         drums=dict(kick=[0, 10], snare=[4, 12], hat=[0, 2, 4, 6, 8, 10, 12, 14], kg=0.45, sg=0.12, hg=0.3)),
    dict(id='edm-drive', title='Flash Deal', mood=['energetic', 'sale', 'tech', 'gaming', 'sport', 'bold'],
         energy=0.95, bpm=128, progression=[(57, 'min'), (53, 'maj'), (60, 'maj'), (55, 'maj')],
         pad='saw', pad_gain=0.03, arp=0.25, arp_kind='saw', arp_gain=0.03, bass=[0.5, 1.5, 2.5, 3.5],
         bass_kind='saw', bass_gain=0.16,
         drums=dict(kick=FOUR, clap=[4, 12], ohat=[2, 6, 10, 14], hat=[1, 3, 5, 7, 9, 11, 13, 15], kg=0.6)),
    dict(id='corporate-bright', title='Clear Path', mood=['corporate', 'tech', 'finance', 'trust', 'education'],
         energy=0.55, bpm=104, progression=[(60, 'add9'), (65, 'add9'), (69, 'min7'), (67, 'sus2')],
         pad='tri', pad_gain=0.04, arp=0.5, arp_kind='pluck', arp_gain=0.06, bass=[0, 2], bass_kind='tri',
         drums=dict(kick=[0, 8], snare=[4, 12], hat=[2, 6, 10, 14], kg=0.4, sg=0.1, hg=0.35)),
    dict(id='festive-tet', title='Spring Lantern', mood=['festive', 'tet', 'family', 'food', 'warm', 'playful'],
         energy=0.7, bpm=112, progression=[(62, 'maj'), (67, 'maj'), (69, 'maj'), (62, 'maj')],
         pad='tri', pad_gain=0.03, bass=[0, 2, 3], bass_kind='tri',
         melody=[0, 2, 4, 7, 9, 12], mel_pattern=[4, 3, 2, 0, 2, 4, 5, -1], mel_kind='pluck', mel_gain=0.08,
         drums=dict(kick=[0, 6, 8], snare=[4, 12], hat=[2, 10], kg=0.45, sg=0.15)),
    dict(id='warm-acoustic', title='Home Kitchen', mood=['warm', 'food', 'family', 'lifestyle', 'calm'],
         energy=0.4, bpm=96, progression=[(60, 'maj'), (64, 'min'), (65, 'maj'), (67, 'maj')],
         arp=0.5, arp_kind='pluck', arp_gain=0.08, arp_oct=-12, bass=[0, 2], bass_kind='sine', bass_gain=0.2,
         drums=dict(kick=[0, 8], hat=[4, 12], kg=0.3, hg=0.25)),
]

def write_wav(path, data):
    pcm = (np.clip(data, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())

lib = []
for spec in SPECS:
    data, dur = track(spec)
    fn = f"{spec['id']}.wav"
    write_wav(os.path.join(OUT, fn), data)
    lib.append(dict(id=spec['id'], title=spec['title'], file=fn, bpm=spec['bpm'], energy=spec['energy'],
                    mood=spec['mood'], duration=round(dur, 3), loopable=True,
                    license='Original synthesized by kv-motion (CC0 / owned). Free for commercial use.'))
    print('wrote', fn, round(dur, 2), 's')

with open(os.path.join(OUT, 'library.json'), 'w', encoding='utf-8') as f:
    json.dump({'tracks': lib}, f, ensure_ascii=False, indent=2)
