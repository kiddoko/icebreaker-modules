/**
 * breakerMED — the analog synth (subtractive, the classic way: Moog, Juno,
 * SH-101). Two oscillators and a sub → a filter (low / high / band-pass, 12 or
 * 24 dB, resonance) → an amplifier; an envelope for each (ADSR), an LFO for the
 * pitch, the filter or the pulse width, glide. Our own code: band-limited
 * oscillators (polyBLEP) and a state-variable filter (TPT), cheap and stable.
 *
 * A note's pitch comes from the tracker like a sample's (a "rate"), so slides,
 * vibrato and arpeggios work the same: C-3 is middle C (261.63 Hz).
 */
import type { NoteStart, Voice } from "./voice";

export type Wave = "saw" | "square" | "triangle" | "sine" | "noise";
export type FilterType = "lp" | "hp" | "bp";

export interface Adsr {
  /** seconds */
  a: number;
  d: number;
  /** level 0–1 */
  s: number;
  r: number;
}

export interface AnalogParams {
  osc1: { wave: Wave; pw: number; level: number };
  osc2: { wave: Wave; pw: number; level: number; semi: number; detune: number };
  /** a square an octave down */
  sub: number;
  filter: { type: FilterType; cutoff: number; reso: number; env: number; keytrack: number; slope: 12 | 24 };
  amp: Adsr;
  fenv: Adsr;
  lfo: { wave: "sine" | "triangle" | "square" | "saw" | "random"; rate: number; pitch: number; cutoff: number; pw: number };
  /** seconds to slide from the previous note */
  glide: number;
}

/** what a rate means for a synth: the tracker's C-3 rate is middle C */
export const C3_RATE = 3546895 / 214;
export const C3_HZ = 261.6256;

export function defaultAnalog(): AnalogParams {
  return {
    osc1: { wave: "saw", pw: 0.5, level: 0.8 },
    osc2: { wave: "saw", pw: 0.5, level: 0, semi: 0, detune: 7 },
    sub: 0,
    filter: { type: "lp", cutoff: 2000, reso: 0.2, env: 2, keytrack: 0.5, slope: 12 },
    amp: { a: 0.005, d: 0.2, s: 0.8, r: 0.2 },
    fenv: { a: 0.005, d: 0.3, s: 0.3, r: 0.2 },
    lfo: { wave: "sine", rate: 5, pitch: 0, cutoff: 0, pw: 0 },
    glide: 0,
  };
}

/** our own starting points */
export const ANALOG_PRESETS: Record<string, (p: AnalogParams) => void> = {
  bass: (p) => Object.assign(p, { osc1: { wave: "saw", pw: 0.5, level: 0.8 }, sub: 0.5, filter: { type: "lp", cutoff: 300, reso: 0.3, env: 3, keytrack: 0.3, slope: 24 }, amp: { a: 0.002, d: 0.3, s: 0.7, r: 0.1 }, fenv: { a: 0.002, d: 0.25, s: 0.1, r: 0.1 } }),
  acid: (p) => Object.assign(p, { osc1: { wave: "saw", pw: 0.5, level: 0.9 }, filter: { type: "lp", cutoff: 350, reso: 0.85, env: 4, keytrack: 0.4, slope: 12 }, amp: { a: 0.002, d: 0.2, s: 0.8, r: 0.05 }, fenv: { a: 0.001, d: 0.18, s: 0, r: 0.05 }, glide: 0.06 }),
  lead: (p) => Object.assign(p, { osc1: { wave: "square", pw: 0.35, level: 0.6 }, osc2: { wave: "saw", pw: 0.5, level: 0.5, semi: 0, detune: 9 }, filter: { type: "lp", cutoff: 2500, reso: 0.25, env: 1.5, keytrack: 0.6, slope: 12 }, lfo: { wave: "sine", rate: 5.5, pitch: 0.15, cutoff: 0, pw: 0.15 }, glide: 0.03 }),
  pad: (p) => Object.assign(p, { osc1: { wave: "saw", pw: 0.5, level: 0.5 }, osc2: { wave: "saw", pw: 0.5, level: 0.5, semi: 0, detune: 14 }, filter: { type: "lp", cutoff: 1200, reso: 0.15, env: 1, keytrack: 0.5, slope: 12 }, amp: { a: 0.6, d: 0.5, s: 0.8, r: 1.2 }, fenv: { a: 0.8, d: 1, s: 0.5, r: 1 }, lfo: { wave: "triangle", rate: 0.4, pitch: 0, cutoff: 0.4, pw: 0 } }),
  pluck: (p) => Object.assign(p, { osc1: { wave: "saw", pw: 0.5, level: 0.8 }, osc2: { wave: "square", pw: 0.5, level: 0.3, semi: 12, detune: 0 }, filter: { type: "lp", cutoff: 500, reso: 0.3, env: 4, keytrack: 0.6, slope: 12 }, amp: { a: 0.001, d: 0.35, s: 0, r: 0.2 }, fenv: { a: 0.001, d: 0.15, s: 0, r: 0.1 } }),
  brass: (p) => Object.assign(p, { osc1: { wave: "saw", pw: 0.5, level: 0.6 }, osc2: { wave: "saw", pw: 0.5, level: 0.5, semi: 0, detune: 6 }, filter: { type: "lp", cutoff: 700, reso: 0.1, env: 2.5, keytrack: 0.5, slope: 12 }, amp: { a: 0.05, d: 0.3, s: 0.8, r: 0.25 }, fenv: { a: 0.08, d: 0.4, s: 0.5, r: 0.2 } }),
  sine: (p) => Object.assign(p, { osc1: { wave: "sine", pw: 0.5, level: 0.9 }, filter: { type: "lp", cutoff: 18000, reso: 0, env: 0, keytrack: 0, slope: 12 }, amp: { a: 0.01, d: 0.1, s: 1, r: 0.3 } }),
};

/** a fresh copy of a preset (or the default) */
export function analogPreset(name?: string): AnalogParams {
  const p = defaultAnalog();
  ANALOG_PRESETS[name ?? ""]?.(p);
  return structuredClone(p);
}

/** a band-limiting correction at a waveform's jump (polyBLEP) */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function osc(wave: Wave, phase: number, dt: number, pw: number, noise: () => number): number {
  switch (wave) {
    case "saw":
      return 2 * phase - 1 - blep(phase, dt);
    case "square": {
      let y = phase < pw ? 1 : -1;
      y += blep(phase, dt);
      y -= blep((phase - pw + 1) % 1, dt);
      return y;
    }
    case "triangle":
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    case "sine":
      return Math.sin(2 * Math.PI * phase);
    case "noise":
      return noise();
  }
}

/** an envelope's level after `t` seconds of the note (`releasedAt`: when the key went up, its level then) */
function adsr(e: Adsr, t: number, released: { at: number; from: number } | null): number {
  if (released) {
    const r = Math.max(0.001, e.r);
    return Math.max(0, released.from * (1 - (t - released.at) / r));
  }
  const a = Math.max(0.0005, e.a);
  if (t < a) return t / a;
  const d = Math.max(0.0005, e.d);
  if (t < a + d) return 1 - (1 - e.s) * ((t - a) / d);
  return e.s;
}

export class AnalogVoice implements Voice {
  on = false;
  readonly rings = true;
  private p: AnalogParams = defaultAnalog();
  private hz = C3_HZ;
  private targetHz = C3_HZ;
  private ph1 = 0;
  private ph2 = 0;
  private phSub = 0;
  private lfoPh = 0;
  private lfoHold = 0;
  private t = 0;
  private released: { at: number; from: number } | null = null;
  private gl = 0;
  private gr = 0;
  private seed = 12345;
  // two state-variable filters (24 dB = both)
  private s1 = [0, 0];
  private s2 = [0, 0];

  constructor(private readonly outRate: number) {}

  private noise = () => ((this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;

  start(n: NoteStart): void {
    const glide = this.on && (n.instrument.synth?.glide ?? 0) > 0;
    this.p = n.instrument.synth ?? defaultAnalog();
    this.targetHz = (n.rate / C3_RATE) * C3_HZ;
    if (!glide) this.hz = this.targetHz;
    this.t = 0;
    this.released = null;
    this.on = true;
  }

  /** the tracker's pitch (slides, vibrato, arpeggio), loudness and place */
  set(rate: number, volume: number, pan: number): void {
    this.targetHz = (Math.max(1, rate) / C3_RATE) * C3_HZ;
    if (!(this.p.glide > 0)) this.hz = this.targetHz;
    const v = Math.max(0, Math.min(1, volume));
    this.gl = v * Math.min(1, 1 - pan);
    this.gr = v * Math.min(1, 1 + pan);
  }

  /** the key goes up: the release phase (the voice ends when it's silent) */
  stop(): void {
    if (!this.on || this.released) return;
    this.released = { at: this.t, from: adsr(this.p.amp, this.t, null) };
  }

  /** right now, no release (a hard cut) */
  kill(): void {
    this.on = false;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (!this.on) return;
    const p = this.p;
    const sr = this.outRate;
    const dtSec = 1 / sr;
    const glideK = p.glide > 0 ? 1 - Math.exp(-dtSec / Math.max(0.001, p.glide / 3)) : 1;
    let g = 0, k = 0, fcut = 0;
    for (let i = from; i < to; i++) {
      this.hz += (this.targetHz - this.hz) * glideK;
      // the LFO
      this.lfoPh = (this.lfoPh + p.lfo.rate * dtSec) % 1;
      let lfo: number;
      switch (p.lfo.wave) {
        case "triangle": lfo = this.lfoPh < 0.5 ? 4 * this.lfoPh - 1 : 3 - 4 * this.lfoPh; break;
        case "square": lfo = this.lfoPh < 0.5 ? 1 : -1; break;
        case "saw": lfo = 2 * this.lfoPh - 1; break;
        case "random": if (this.lfoPh < p.lfo.rate * dtSec) this.lfoHold = this.noise(); lfo = this.lfoHold; break;
        default: lfo = Math.sin(2 * Math.PI * this.lfoPh);
      }
      const hz = this.hz * 2 ** ((lfo * p.lfo.pitch) / 12);
      const dt1 = Math.min(0.49, hz / sr);
      const dt2 = Math.min(0.49, (hz * 2 ** ((p.osc2.semi + p.osc2.detune / 100) / 12)) / sr);
      const pw1 = Math.max(0.05, Math.min(0.95, p.osc1.pw + lfo * p.lfo.pw * 0.45));
      const pw2 = Math.max(0.05, Math.min(0.95, p.osc2.pw + lfo * p.lfo.pw * 0.45));
      let x = p.osc1.level ? osc(p.osc1.wave, this.ph1, dt1, pw1, this.noise) * p.osc1.level : 0;
      if (p.osc2.level) x += osc(p.osc2.wave, this.ph2, dt2, pw2, this.noise) * p.osc2.level;
      if (p.sub) x += osc("square", this.phSub, dt1 / 2, 0.5, this.noise) * p.sub;
      this.ph1 = (this.ph1 + dt1) % 1;
      this.ph2 = (this.ph2 + dt2) % 1;
      this.phSub = (this.phSub + dt1 / 2) % 1;
      // the filter: cutoff × 2^(envelope × env + key tracking + LFO), coefficients every 8 frames
      if ((i - from) % 8 === 0) {
        const env = adsr(p.fenv, this.t, this.released ? { at: this.released.at, from: adsr(p.fenv, this.released.at, null) } : null);
        const key = Math.log2(hz / C3_HZ) * p.filter.keytrack;
        fcut = Math.max(20, Math.min(sr * 0.45, p.filter.cutoff * 2 ** (env * p.filter.env + key + lfo * p.lfo.cutoff)));
        g = Math.tan((Math.PI * fcut) / sr);
        k = 2 - 2 * Math.min(0.98, Math.max(0, p.filter.reso));
      }
      x = this.svf(this.s1, x, g, k, p.filter.type);
      if (p.filter.slope === 24) x = this.svf(this.s2, x, g, k, p.filter.type);
      const amp = adsr(p.amp, this.t, this.released);
      this.t += dtSec;
      if (this.released && amp <= 0) {
        this.on = false;
        return;
      }
      const y = x * amp * 0.5;
      left[i] += y * this.gl;
      right[i] += y * this.gr;
    }
  }

  /** one TPT state-variable filter step (Zavalishin): low, band or high-pass */
  private svf(s: number[], x: number, g: number, k: number, type: FilterType): number {
    const hp = (x - (k + g) * s[0] - s[1]) / (1 + g * (k + g));
    const bp = g * hp + s[0];
    const lp = g * bp + s[1];
    s[0] = g * hp + bp;
    s[1] = g * bp + lp;
    return type === "lp" ? lp : type === "hp" ? hp : bp;
  }
}

// ── the settings, one by one (the commands, the INSTRUMENT screen and .bmed use this list) ──

export interface AnalogParam {
  /** where it lives: "filter.cutoff" */
  key: string;
  /** what the screen shows */
  label: string;
  /** a list of choices, or a range */
  choices?: readonly string[];
  min?: number;
  max?: number;
  /** a step for ←→ (a × step when `log`: frequencies and times) */
  step?: number;
  log?: boolean;
  unit?: string;
}

const WAVES = ["saw", "square", "triangle", "sine", "noise"] as const;
export const ANALOG_PARAMS: readonly AnalogParam[] = [
  { key: "osc1.wave", label: "osc 1 wave", choices: WAVES },
  { key: "osc1.pw", label: "osc 1 width", min: 0.05, max: 0.95, step: 0.05 },
  { key: "osc1.level", label: "osc 1 level", min: 0, max: 1, step: 0.05 },
  { key: "osc2.wave", label: "osc 2 wave", choices: WAVES },
  { key: "osc2.pw", label: "osc 2 width", min: 0.05, max: 0.95, step: 0.05 },
  { key: "osc2.level", label: "osc 2 level", min: 0, max: 1, step: 0.05 },
  { key: "osc2.semi", label: "osc 2 semitones", min: -24, max: 24, step: 1 },
  { key: "osc2.detune", label: "osc 2 detune", min: -50, max: 50, step: 1, unit: "ct" },
  { key: "sub", label: "sub (octave down)", min: 0, max: 1, step: 0.05 },
  { key: "filter.type", label: "filter", choices: ["lp", "hp", "bp"] },
  { key: "filter.slope", label: "filter slope", choices: ["12", "24"], unit: "dB" },
  { key: "filter.cutoff", label: "cutoff", min: 20, max: 20000, step: 1.12, log: true, unit: "Hz" },
  { key: "filter.reso", label: "resonance", min: 0, max: 1, step: 0.05 },
  { key: "filter.env", label: "filter env amount", min: -8, max: 8, step: 0.25, unit: "oct" },
  { key: "filter.keytrack", label: "key tracking", min: 0, max: 1, step: 0.1 },
  { key: "fenv.a", label: "filter attack", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "fenv.d", label: "filter decay", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "fenv.s", label: "filter sustain", min: 0, max: 1, step: 0.05 },
  { key: "fenv.r", label: "filter release", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.a", label: "attack", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.d", label: "decay", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.s", label: "sustain", min: 0, max: 1, step: 0.05 },
  { key: "amp.r", label: "release", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "lfo.wave", label: "lfo wave", choices: ["sine", "triangle", "square", "saw", "random"] },
  { key: "lfo.rate", label: "lfo rate", min: 0.05, max: 40, step: 1.15, log: true, unit: "Hz" },
  { key: "lfo.pitch", label: "lfo → pitch", min: 0, max: 12, step: 0.05, unit: "st" },
  { key: "lfo.cutoff", label: "lfo → cutoff", min: 0, max: 4, step: 0.1, unit: "oct" },
  { key: "lfo.pw", label: "lfo → width", min: 0, max: 1, step: 0.05 },
  { key: "glide", label: "glide", min: 0, max: 2, step: 0.01, unit: "s" },
];

/** a setting by its key, or its label's first word ("cutoff", "reso"…) */
export function findParam(name: string): AnalogParam | undefined {
  const n = name.toLowerCase();
  return ANALOG_PARAMS.find((x) => x.key === n) ?? ANALOG_PARAMS.find((x) => x.key.endsWith("." + n) || x.label === n) ?? ANALOG_PARAMS.find((x) => x.key.split(".").pop()!.startsWith(n) && n.length >= 3);
}

export function getParam(p: AnalogParams, key: string): string | number {
  const [a, b] = key.split(".");
  const v = b ? (p as unknown as Record<string, Record<string, unknown>>)[a][b] : (p as unknown as Record<string, unknown>)[a];
  return key === "filter.slope" ? String(v) : (v as string | number);
}

/** A setting from text ("saw", "800", "1.5k") — checked and clamped. Throws on a bad value. */
export function setParam(p: AnalogParams, key: string, text: string): void {
  const def = ANALOG_PARAMS.find((x) => x.key === key);
  if (!def) throw new Error(`no setting "${key}"`);
  let v: string | number;
  if (def.choices) {
    if (!def.choices.includes(text)) throw new Error(`${def.label}: ${def.choices.join(" | ")}`);
    v = key === "filter.slope" ? +text : text;
  } else {
    const m = /^(-?[\d.]+)(k?)$/i.exec(text.trim());
    const x = m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : NaN;
    if (!Number.isFinite(x)) throw new Error(`${def.label}: a number, ${def.min}…${def.max}`);
    v = Math.max(def.min!, Math.min(def.max!, x));
  }
  const [a, b] = key.split(".");
  if (b) (p as unknown as Record<string, Record<string, unknown>>)[a][b] = v;
  else (p as unknown as Record<string, unknown>)[a] = v;
}

/** One step up or down (←→ on the screen): the next choice, or the next value. */
export function nudgeParam(p: AnalogParams, key: string, dir: 1 | -1, big = false): void {
  const def = ANALOG_PARAMS.find((x) => x.key === key)!;
  const cur = getParam(p, key);
  if (def.choices) {
    const i = def.choices.indexOf(String(cur));
    setParam(p, key, def.choices[(i + dir + def.choices.length) % def.choices.length]);
    return;
  }
  const x = Number(cur);
  const times = big ? 4 : 1;
  let next: number;
  if (def.log) next = (x <= 0 ? (dir > 0 ? 0.001 : 0) : x * def.step! ** (dir * times));
  else next = Math.round((x + dir * def.step! * times) / def.step!) * def.step!;
  if (def.log && next < 0.001 && dir < 0) next = def.min!;
  setParam(p, key, String(+next.toPrecision(4)));
}

/** a setting as the screen shows it */
export function showParam(p: AnalogParams, def: AnalogParam): string {
  const v = getParam(p, def.key);
  if (typeof v === "string") return v + (def.unit ? ` ${def.unit}` : "");
  const text = def.unit === "Hz" && v >= 1000 ? `${+(v / 1000).toFixed(2)}k` : def.unit === "s" && v < 1 ? `${Math.round(v * 1000)} ms` : String(+v.toFixed(2));
  return text + (def.unit && !(def.unit === "s" && v < 1) ? ` ${def.unit}` : "");
}

/** Settings read from a file: every value checked, anything missing or wrong → the default. */
export function sanitizeAnalog(j: unknown): AnalogParams {
  const p = defaultAnalog();
  if (!j || typeof j !== "object") return p;
  for (const def of ANALOG_PARAMS) {
    const [a, b] = def.key.split(".");
    const o = j as Record<string, unknown>;
    const raw = b ? (o[a] as Record<string, unknown> | undefined)?.[b] : o[a];
    if (raw === undefined || raw === null) continue;
    try {
      setParam(p, def.key, String(raw));
    } catch {
      /* keep the default */
    }
  }
  return p;
}
