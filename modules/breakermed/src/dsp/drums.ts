/**
 * breakerMED — the drum machine: a kit of twelve drums computed on the fly,
 * one a note of the octave (whatever the octave):
 *
 *   C kick   C# rim    D snare   D# clap    E closed hat   F low tom
 *   F# open hat   G mid tom   G# cowbell   A high tom   A# crash   B ride
 *
 * The classic analog recipes, our own code: a kick is a sine whose pitch falls,
 * a snare two tones and filtered noise, a hat six square waves out of tune with
 * each other through a high-pass, and so on. Each drum has a tune, a decay, a
 * level and a tone; the kit can be crushed to fewer bits and a lower rate (the
 * sampler's grit, live). A closed hat chokes an open one, like on the machines.
 */
import type { NoteStart, Voice } from "./voice";

export const DRUM_NAMES = ["kick", "rim", "snare", "clap", "closed hat", "low tom", "open hat", "mid tom", "cowbell", "high tom", "crash", "ride"] as const;
export const DRUM_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export interface DrumParams {
  /** semitones */
  tune: number;
  /** × the drum's own length (0.1–4) */
  decay: number;
  /** 0–1 */
  level: number;
  /** 0–1: the kick's click, the snare's snap, the hats' brightness… */
  tone: number;
}

export interface DrumKit {
  drums: DrumParams[];
  /** 16 = clean; fewer = the grit */
  bits: number;
  /** keep each value this many frames (1 = the full rate) */
  hold: number;
}

export const DRUM_SETTINGS = [
  { key: "tune", min: -24, max: 24, step: 1, unit: "st" },
  { key: "decay", min: 0.1, max: 4, step: 0.1, unit: "×" },
  { key: "level", min: 0, max: 1, step: 0.05, unit: "" },
  { key: "tone", min: 0, max: 1, step: 0.05, unit: "" },
] as const;
export type DrumSetting = (typeof DRUM_SETTINGS)[number]["key"];

const flat = (): DrumParams[] => DRUM_NAMES.map(() => ({ tune: 0, decay: 1, level: 0.8, tone: 0.5 }));

/** our own kits */
export const DRUM_KITS: Record<string, (k: DrumKit) => void> = {
  /** long, round, a deep kick (the 808's way) */
  classic: (k) => {
    k.drums[0] = { tune: 0, decay: 1.4, level: 1, tone: 0.2 };
    k.drums[2] = { tune: 0, decay: 1, level: 0.75, tone: 0.45 };
  },
  /** short, hard, a kick with a click (the 909's way) */
  punch: (k) => {
    k.drums[0] = { tune: 3, decay: 0.7, level: 1, tone: 0.8 };
    k.drums[2] = { tune: 2, decay: 0.8, level: 0.85, tone: 0.75 };
    k.drums[3] = { tune: 0, decay: 0.8, level: 0.8, tone: 0.6 };
    k.drums[4] = { tune: 0, decay: 0.6, level: 0.6, tone: 0.8 };
  },
  /** everything short and tight */
  tight: (k) => {
    for (const d of k.drums) d.decay = 0.5;
    k.drums[0].tone = 0.6;
  },
  /** crushed: 6 bits, a third of the rate (an old sampler's drums) */
  lofi: (k) => {
    k.bits = 6;
    k.hold = 3;
    k.drums[0] = { tune: -2, decay: 1, level: 1, tone: 0.4 };
  },
};

export function drumKit(name?: string): DrumKit {
  const k: DrumKit = { drums: flat(), bits: 16, hold: 1 };
  DRUM_KITS[name ?? "classic"]?.(k);
  return structuredClone(k);
}

/** Settings read from a file: every value checked, anything wrong → the default. */
export function sanitizeKit(j: unknown): DrumKit {
  const k = drumKit();
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const list = Array.isArray(o.drums) ? o.drums : [];
  k.drums = k.drums.map((d, i) => {
    const x = (list[i] && typeof list[i] === "object" ? list[i] : {}) as Record<string, unknown>;
    return { tune: num(x.tune, d.tune, -24, 24), decay: num(x.decay, d.decay, 0.1, 4), level: num(x.level, d.level, 0, 1), tone: num(x.tone, d.tone, 0, 1) };
  });
  k.bits = Math.round(num(o.bits, 16, 1, 16));
  k.hold = Math.round(num(o.hold, 1, 1, 16));
  return k;
}

/** A drum by its name, its note ("D#") or its number (1–12). */
export function findDrum(name: string): number {
  const n = name.toLowerCase();
  const i = DRUM_NAMES.findIndex((d) => d === n || d.replace(" ", "") === n || d.split(" ")[0] === n);
  if (i >= 0) return i;
  const j = DRUM_NOTES.findIndex((x) => x.toLowerCase() === n);
  if (j >= 0) return j;
  const k = parseInt(n, 10);
  return k >= 1 && k <= 12 ? k - 1 : -1;
}

export function setDrum(kit: DrumKit, drum: number, key: DrumSetting, value: number): void {
  const def = DRUM_SETTINGS.find((s) => s.key === key)!;
  if (!Number.isFinite(value)) throw new Error(`${key}: a number, ${def.min}…${def.max}`);
  kit.drums[drum][key] = Math.max(def.min, Math.min(def.max, +value.toFixed(3)));
}

export function nudgeDrum(kit: DrumKit, drum: number, key: DrumSetting, dir: 1 | -1, big = false): void {
  const def = DRUM_SETTINGS.find((s) => s.key === key)!;
  const step = def.step * (big ? 4 : 1);
  setDrum(kit, drum, key, Math.round((kit.drums[drum][key] + dir * step) / def.step) * def.step);
}

/** which drum a rate plays: its note's place in the octave (C-3, C-4… are all the kick) */
export function drumOf(rate: number, c3Rate: number): number {
  const semis = Math.round(12 * Math.log2(Math.max(1, rate) / c3Rate));
  return ((semis % 12) + 12) % 12;
}

const C3_RATE = 3546895 / 214;
/** the six out-of-tune squares of a metal sound (the classic ratios) */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

/** a small state-variable filter (Zavalishin's TPT): one call a frame */
class Svf {
  private s1 = 0;
  private s2 = 0;
  private g = 0;
  private k = 0;
  set(hz: number, sr: number, q = 0.7) {
    this.g = Math.tan((Math.PI * Math.min(hz, sr * 0.45)) / sr);
    this.k = 1 / q;
  }
  run(x: number): { lp: number; bp: number; hp: number } {
    const hp = (x - (this.k + this.g) * this.s1 - this.s2) / (1 + this.g * (this.k + this.g));
    const bp = this.g * hp + this.s1;
    const lp = this.g * bp + this.s2;
    this.s1 = this.g * hp + bp;
    this.s2 = this.g * bp + lp;
    return { lp, bp, hp };
  }
}

export class DrumVoice implements Voice {
  on = false;
  /** a drum rings on when the track plays the next note */
  readonly rings = true;
  drum = 0;
  private p: DrumParams = flat()[0];
  private kit: DrumKit = drumKit();
  private t = 0;
  private ph = [0, 0, 0, 0, 0, 0];
  private seed = 22222;
  private f1 = new Svf();
  private f2 = new Svf();
  private gl = 0;
  private gr = 0;
  /** a note off: a short fade (20 ms) */
  private fade = 1;
  private fading = false;
  private held = 0;
  private holdLeft = 0;

  constructor(private readonly sr: number) {}

  private noise() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x3fffffff - 1;
  }

  start(n: NoteStart): void {
    this.kit = n.instrument.drums ?? drumKit();
    this.drum = drumOf(n.rate, C3_RATE);
    this.p = this.kit.drums[this.drum] ?? flat()[0];
    this.t = 0;
    this.ph.fill(0);
    this.fade = 1;
    this.fading = false;
    this.holdLeft = 0;
    this.f1 = new Svf();
    this.f2 = new Svf();
    const tune = 2 ** (this.p.tune / 12);
    const tone = this.p.tone;
    switch (this.drum) {
      case 2: this.f1.set(1800 + tone * 5000, this.sr, 0.8); break; // snare: the snap's band
      case 3: this.f1.set(1100 * tune, this.sr, 2.5); break; // clap
      case 4: case 6: this.f1.set((6000 + tone * 4000) * tune, this.sr, 0.8); this.f2.set(10000, this.sr, 0.6); break; // hats
      case 8: this.f1.set(800 * tune, this.sr, 3); break; // cowbell
      case 10: case 11: this.f1.set((4000 + tone * 4000) * tune, this.sr, 0.7); this.f2.set(12000, this.sr, 0.6); break; // cymbals
      default: this.f1.set(3000, this.sr);
    }
    this.on = true;
  }

  /** the volume and the place; a drum keeps its pitch (its note chose it) */
  set(_rate: number, volume: number, pan: number): void {
    const v = Math.max(0, Math.min(1, volume));
    this.gl = v * Math.min(1, 1 - pan);
    this.gr = v * Math.min(1, 1 + pan);
  }

  stop(): void {
    this.fading = true;
  }

  /** a closed hat (or a pedal) cuts an open one ringing on the same track */
  chokedBy(drum: number): boolean {
    return this.drum === 6 && drum === 4;
  }

  kill(): void {
    this.on = false;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (!this.on) return;
    const sr = this.sr, dt = 1 / sr;
    const { tune: semis, decay, level, tone } = this.p;
    const tune = 2 ** (semis / 12);
    const bits = this.kit.bits, hold = Math.max(1, this.kit.hold);
    const steps = bits < 16 ? 2 ** (bits - 1) : 0;
    for (let i = from; i < to; i++) {
      const t = this.t;
      let y = 0;
      let alive = true;
      switch (this.drum) {
        case 0: { // kick: a sine falling from high to its note, and a click
          const len = 0.45 * decay;
          const f = 48 * tune * (1 + 3.5 * Math.exp(-t / 0.025));
          this.ph[0] = (this.ph[0] + f * dt) % 1;
          y = Math.sin(2 * Math.PI * this.ph[0]) * Math.exp(-t / (len / 3));
          y += this.noise() * Math.exp(-t / 0.0025) * tone * 0.6;
          y = Math.tanh(y * 1.6);
          alive = t < len * 1.6;
          break;
        }
        case 1: { // rim: two short tones
          this.ph[0] = (this.ph[0] + 1700 * tune * dt) % 1;
          this.ph[1] = (this.ph[1] + 480 * tune * dt) % 1;
          y = (Math.sin(2 * Math.PI * this.ph[0]) * 0.6 + (this.ph[1] < 0.5 ? 0.4 : -0.4)) * Math.exp(-t / (0.012 * decay));
          alive = t < 0.08 * decay;
          break;
        }
        case 2: { // snare: two tones and the snap (filtered noise)
          this.ph[0] = (this.ph[0] + 185 * tune * dt) % 1;
          this.ph[1] = (this.ph[1] + 330 * tune * dt) % 1;
          const body = (Math.sin(2 * Math.PI * this.ph[0]) + Math.sin(2 * Math.PI * this.ph[1]) * 0.6) * Math.exp(-t / (0.05 * decay)) * (1 - tone * 0.6);
          const snap = this.f1.run(this.noise()).bp * 1.8 * Math.exp(-t / (0.09 * decay)) * (0.3 + tone);
          y = body * 0.6 + snap;
          alive = t < 0.5 * decay;
          break;
        }
        case 3: { // clap: three quick bursts of noise, then its tail
          const burst = t < 0.03 ? Math.exp(-((t % 0.01) / 0.003)) : Math.exp(-(t - 0.03) / (0.12 * decay));
          y = this.f1.run(this.noise()).bp * burst * 2.2;
          alive = t < 0.03 + 0.7 * decay;
          break;
        }
        case 4: case 6: case 10: case 11: { // metal: six squares, high-passed (hats, cymbals)
          let m = 0;
          for (let k = 0; k < 6; k++) {
            this.ph[k] = (this.ph[k] + METAL[k] * 2.4 * tune * dt) % 1;
            m += this.ph[k] < 0.5 ? 1 : -1;
          }
          m = m / 6 + (this.drum === 10 ? this.noise() * 0.5 : this.drum === 11 ? this.noise() * 0.1 : 0);
          const len = this.drum === 4 ? 0.045 : this.drum === 6 ? 0.35 : this.drum === 10 ? 1.1 : 1.6;
          const f = this.f1.run(m);
          y = (this.drum === 11 ? f.bp : this.f2.run(f.hp).lp) * Math.exp(-t / (len * decay / 3)) * (this.drum === 11 ? 1.4 : this.drum === 10 ? 2.4 : 4.5);
          alive = t < len * decay * 1.3;
          break;
        }
        case 5: case 7: case 9: { // toms: a sine falling a little, a breath of noise
          const base = (this.drum === 5 ? 95 : this.drum === 7 ? 140 : 200) * tune;
          const f = base * (1 + 0.6 * Math.exp(-t / 0.04));
          this.ph[0] = (this.ph[0] + f * dt) % 1;
          y = (Math.sin(2 * Math.PI * this.ph[0]) + this.noise() * Math.exp(-t / 0.01) * tone * 0.5) * Math.exp(-t / (0.12 * decay));
          alive = t < 0.6 * decay;
          break;
        }
        case 8: { // cowbell: two squares through a band-pass
          this.ph[0] = (this.ph[0] + 540 * tune * dt) % 1;
          this.ph[1] = (this.ph[1] + 800 * tune * dt) % 1;
          const x = (this.ph[0] < 0.5 ? 0.5 : -0.5) + (this.ph[1] < 0.5 ? 0.5 : -0.5);
          y = this.f1.run(x).bp * 0.35 * (t < 0.01 ? 1 : Math.exp(-(t - 0.01) / (0.09 * decay)));
          alive = t < 0.4 * decay;
          break;
        }
      }
      this.t += dt;
      if (this.fading) {
        this.fade -= dt / 0.02;
        if (this.fade <= 0) alive = false;
      }
      if (!alive) {
        this.on = false;
        return;
      }
      y *= level * this.fade;
      // the kit's grit: fewer bits, and each value kept `hold` frames
      if (hold > 1) {
        if (this.holdLeft-- <= 0) (this.held = y), (this.holdLeft = hold - 1);
        y = this.held;
      }
      if (steps) y = Math.round(y * steps) / steps;
      left[i] += y * 0.5 * this.gl;
      right[i] += y * 0.5 * this.gr;
    }
  }
}
