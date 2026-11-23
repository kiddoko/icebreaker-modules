/**
 * BreakerMED — the FM synth, the basic kind: two sine waves, one (the
 * modulator) bending the other's phase (the carrier), the way the 80s did
 * electric pianos, bells and slap basses. The modulator runs at `ratio` × the
 * note (whole ratios sound in tune, others clang), `index` says how far it bends
 * (the brightness), its own envelope moves that over the note, and it can feed
 * back on itself (from pure to noisy). Our own code.
 *
 * The pitch comes from the tracker like a sample's (a "rate"): C-3 is middle C.
 */
import { PRESET_LEVELS } from "./levels";
import { adsr, C3_HZ, C3_RATE, type Adsr } from "./analog";
import { findIn, nudgeIn, sanitizeWith, setIn, showIn, type Param } from "./params";
import type { NoteStart, Voice } from "./voice";

export interface FmParams {
  /** the sound's loudness, in dB (the presets come matched to each other) */
  level: number;
  /** the modulator's frequency, × the note's */
  ratio: number;
  /** cents added to the modulator (a slow beating) */
  detune: number;
  /** how far the modulator bends the carrier, at its envelope's top */
  index: number;
  /** the modulator bending itself, 0–1 */
  feedback: number;
  /** the modulator's envelope (the brightness over the note) */
  menv: Adsr;
  /** the loudness */
  amp: Adsr;
  /** vibrato */
  lfo: { rate: number; pitch: number };
}

export function defaultFm(): FmParams {
  return {
    level: 0,
    ratio: 1,
    detune: 0,
    index: 2,
    feedback: 0,
    menv: { a: 0.002, d: 0.6, s: 0.3, r: 0.3 },
    amp: { a: 0.003, d: 1, s: 0.6, r: 0.3 },
    lfo: { rate: 5, pitch: 0 },
  };
}

/** our own starting points */
export const FM_PRESETS: Record<string, (p: FmParams) => void> = {
  epiano: (p) => Object.assign(p, { ratio: 1, index: 1.8, detune: 3, menv: { a: 0.001, d: 0.9, s: 0.15, r: 0.3 }, amp: { a: 0.002, d: 1.8, s: 0.35, r: 0.4 } }),
  bell: (p) => Object.assign(p, { ratio: 3.5, index: 3.5, menv: { a: 0.001, d: 2, s: 0.1, r: 1.5 }, amp: { a: 0.001, d: 3, s: 0, r: 2 } }),
  bass: (p) => Object.assign(p, { ratio: 1, index: 3, feedback: 0.25, menv: { a: 0.001, d: 0.18, s: 0.15, r: 0.1 }, amp: { a: 0.002, d: 0.5, s: 0.7, r: 0.08 } }),
  brass: (p) => Object.assign(p, { ratio: 1, index: 2.6, menv: { a: 0.07, d: 0.3, s: 0.65, r: 0.2 }, amp: { a: 0.04, d: 0.2, s: 0.85, r: 0.2 }, lfo: { rate: 5.5, pitch: 0.08 } }),
  organ: (p) => Object.assign(p, { ratio: 2, index: 0.9, menv: { a: 0.005, d: 0.1, s: 1, r: 0.05 }, amp: { a: 0.008, d: 0.1, s: 1, r: 0.06 } }),
  pluck: (p) => Object.assign(p, { ratio: 2, index: 3, menv: { a: 0.001, d: 0.12, s: 0, r: 0.1 }, amp: { a: 0.001, d: 0.6, s: 0, r: 0.2 } }),
  metal: (p) => Object.assign(p, { ratio: 1.41, index: 5, feedback: 0.45, menv: { a: 0.001, d: 1.2, s: 0.3, r: 0.8 }, amp: { a: 0.001, d: 2, s: 0.2, r: 1 } }),
  // the YM2612's sound (Mega Drive-style), as far as two operators go: punchy basses, brass, leads
  "ym-bass": (p) => Object.assign(p, { ratio: 1, index: 4.5, feedback: 0.35, menv: { a: 0.001, d: 0.12, s: 0.25, r: 0.06 }, amp: { a: 0.001, d: 0.4, s: 0.8, r: 0.05 } }),
  "ym-slap": (p) => Object.assign(p, { ratio: 2, index: 6, feedback: 0.2, menv: { a: 0.001, d: 0.06, s: 0.1, r: 0.05 }, amp: { a: 0.001, d: 0.3, s: 0.5, r: 0.05 } }),
  "ym-brass": (p) => Object.assign(p, { ratio: 1, index: 3.4, feedback: 0.3, menv: { a: 0.04, d: 0.25, s: 0.75, r: 0.15 }, amp: { a: 0.02, d: 0.2, s: 0.9, r: 0.15 }, lfo: { rate: 6, pitch: 0.1 } }),
  "ym-lead": (p) => Object.assign(p, { ratio: 1, index: 2.2, feedback: 0.55, menv: { a: 0.005, d: 0.4, s: 0.6, r: 0.2 }, amp: { a: 0.003, d: 0.3, s: 0.85, r: 0.2 }, lfo: { rate: 5.5, pitch: 0.15 } }),
  "ym-epiano": (p) => Object.assign(p, { ratio: 14, index: 1.2, menv: { a: 0.001, d: 0.25, s: 0, r: 0.2 }, amp: { a: 0.001, d: 1.5, s: 0.25, r: 0.4 } }),
  "ym-bell": (p) => Object.assign(p, { ratio: 7, index: 2.8, menv: { a: 0.001, d: 1.5, s: 0.05, r: 1 }, amp: { a: 0.001, d: 2.5, s: 0, r: 1.5 } }),
};

export function fmPreset(name?: string): FmParams {
  const p = defaultFm();
  FM_PRESETS[name ?? ""]?.(p);
  p.level = PRESET_LEVELS[`fm:${name ?? ""}`] ?? 0;
  return structuredClone(p);
}

export const FM_PARAMS: readonly Param[] = [
  { key: "ratio", label: "ratio", min: 0.25, max: 16, step: 0.25 },
  { key: "detune", label: "detune", min: -100, max: 100, step: 1, unit: "ct" },
  { key: "index", label: "index (bright)", min: 0, max: 12, step: 0.1 },
  { key: "feedback", label: "feedback", min: 0, max: 1, step: 0.05 },
  { key: "menv.a", label: "mod attack", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "menv.d", label: "mod decay", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "menv.s", label: "mod sustain", min: 0, max: 1, step: 0.05 },
  { key: "menv.r", label: "mod release", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.a", label: "attack", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.d", label: "decay", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.s", label: "sustain", min: 0, max: 1, step: 0.05 },
  { key: "amp.r", label: "release", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "lfo.rate", label: "lfo rate", min: 0.05, max: 40, step: 1.15, log: true, unit: "Hz" },
  { key: "lfo.pitch", label: "lfo → pitch", min: 0, max: 12, step: 0.05, unit: "st" },
  { key: "level", label: "level", min: -24, max: 12, step: 0.5, unit: "dB" },
];

export const findFm = (name: string) => findIn(FM_PARAMS, name);
export const setFm = (p: FmParams, key: string, text: string) => setIn(FM_PARAMS, p, key, text);
export const nudgeFm = (p: FmParams, key: string, dir: 1 | -1, big = false) => nudgeIn(FM_PARAMS, p, key, dir, big);
export const showFm = (p: FmParams, def: Param) => showIn(p, def);
export const sanitizeFm = (j: unknown) => sanitizeWith(FM_PARAMS, defaultFm(), j);

const TAU = 2 * Math.PI;

export class FmVoice implements Voice {
  on = false;
  readonly rings = true;
  private p: FmParams = defaultFm();
  private hz = C3_HZ;
  private pc = 0;
  private pm = 0;
  private lfoPh = 0;
  /** the modulator's last two outputs (feedback averages them: steadier) */
  private m1 = 0;
  private m2 = 0;
  private t = 0;
  private released: { at: number; amp: number; mod: number } | null = null;
  private gl = 0;
  private gr = 0;

  constructor(private readonly sr: number) {}

  start(n: NoteStart): void {
    this.p = n.instrument.fm ?? defaultFm();
    this.hz = (n.rate / C3_RATE) * C3_HZ;
    this.pc = this.pm = 0;
    this.m1 = this.m2 = 0;
    this.t = 0;
    this.released = null;
    this.on = true;
  }

  set(rate: number, volume: number, pan: number): void {
    this.hz = (Math.max(1, rate) / C3_RATE) * C3_HZ;
    // the sound's own level (dB) after the volume: a preset can be louder than a full-volume note
    const v = Math.max(0, Math.min(1, volume)) * 10 ** ((this.p.level ?? 0) / 20);
    this.gl = v * Math.min(1, 1 - pan);
    this.gr = v * Math.min(1, 1 + pan);
  }

  stop(): void {
    if (!this.on || this.released) return;
    this.released = { at: this.t, amp: adsr(this.p.amp, this.t, null), mod: adsr(this.p.menv, this.t, null) };
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (!this.on) return;
    const p = this.p, sr = this.sr, dt = 1 / sr;
    const modRatio = p.ratio * 2 ** (p.detune / 1200);
    const fb = p.feedback * Math.PI;
    for (let i = from; i < to; i++) {
      this.lfoPh = (this.lfoPh + p.lfo.rate * dt) % 1;
      const hz = p.lfo.pitch ? this.hz * 2 ** ((Math.sin(TAU * this.lfoPh) * p.lfo.pitch) / 12) : this.hz;
      const r = this.released;
      const amp = adsr(p.amp, this.t, r && { at: r.at, from: r.amp });
      const idx = p.index * adsr(p.menv, this.t, r && { at: r.at, from: r.mod });
      const m = Math.sin(TAU * this.pm + fb * (this.m1 + this.m2) * 0.5);
      this.m2 = this.m1;
      this.m1 = m;
      const y = Math.sin(TAU * this.pc + idx * m) * amp;
      this.pc = (this.pc + hz * dt) % 1;
      this.pm = (this.pm + hz * modRatio * dt) % 1;
      this.t += dt;
      // released and silent, or a sound that dies by itself (no sustain) and is over
      if ((r && amp <= 0) || (!r && p.amp.s <= 0 && this.t > p.amp.a + p.amp.d)) {
        this.on = false;
        return;
      }
      left[i] += y * 0.5 * this.gl;
      right[i] += y * 0.5 * this.gr;
    }
  }
}
