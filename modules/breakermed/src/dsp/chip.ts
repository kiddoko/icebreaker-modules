/**
 * BreakerMED — CHIP: the sound chips of old consoles and home computers, for
 * chiptune. One instrument, a mode per chip; everything is computed here from
 * how the chips worked (their clocks, period registers, DACs, noise shift
 * registers) — no sample or ROM taken from any machine. Our own code.
 *
 *   2a03   (NES-style)            pulse 12.5 / 25 / 50 / 75 %, a 4-bit stepped triangle,
 *                                 noise from a 15-bit LFSR, long or short (metallic)
 *   dmg    (Game Boy-style)       pulse, a 32-step 4-bit wave channel, 15/7-bit noise
 *   sid    (C64-style)            saw, triangle, pulse of any width (and its sweep),
 *                                 ring mod and hard sync, a LP / BP / HP filter
 *   ay     (ZX / MSX / ST-style)  square, noise, and the envelope "buzzer"
 *   psg    (SN76489, Master System-style)  square, white or periodic noise
 *   pce    (PC Engine-style)      a 32-step 5-bit wavetable
 *
 * What makes them sound like chips: the pitch snaps to each chip's period grid
 * (high notes go a little out of tune, like on the real thing), the volume moves
 * in 16 steps (SID: 256), the waves come out of a few-bit DAC. Plus what chiptune
 * musicians did by hand: an automatic vibrato (after a delay), a pitch sweep
 * (kicks, lasers), a pulse-width sweep, and chords played as a fast arpeggio.
 *
 * The pitch comes from the tracker like a sample's (a "rate"): C-3 is middle C.
 */
import { PRESET_LEVELS } from "./levels";

/** how much lower the chip presets sit than the other synths (dB) */
export const CHIP_TRIM_DB = 3;
import { adsr, C3_HZ, C3_RATE, type Adsr } from "./analog";
import { findIn, nudgeIn, sanitizeWith, setIn, showIn, type Param } from "./params";
import type { NoteStart, Voice } from "./voice";

export const CHIPS = ["2a03", "dmg", "sid", "ay", "psg", "pce"] as const;
export type ChipModel = (typeof CHIPS)[number];
export const CHIP_WAVES = ["pulse", "triangle", "saw", "noise", "wave", "buzz-saw", "buzz-tri", "tone+noise"] as const;
export type ChipWave = (typeof CHIP_WAVES)[number];
/** the wavetables (for "wave"): ours, 32 steps; "custom" is the instrument's own */
export const TABLE_NAMES = ["sine", "saw", "square", "organ", "bass", "pluck", "vox", "custom"] as const;

/** what each chip is called in the help (the console it's like) */
export const CHIP_LIKE: Record<ChipModel, string> = {
  "2a03": "NES-style",
  dmg: "Game Boy-style",
  sid: "C64-style",
  ay: "ZX Spectrum / MSX / Atari ST-style",
  psg: "SN76489, Master System-style",
  pce: "PC Engine-style",
};

export interface ChipParams {
  /** the sound's loudness, in dB (the presets come matched to each other) */
  level: number;
  chip: ChipModel;
  wave: ChipWave;
  /** the pulse's width, 0–1 (2a03 / dmg snap it to 12.5, 25, 50, 75 %) */
  duty: number;
  /** "short": the noise's metallic mode (2a03, dmg: 93 / 127 steps; psg: periodic) */
  noise: "long" | "short";
  table: (typeof TABLE_NAMES)[number];
  amp: Adsr;
  /** automatic vibrato: semitones, Hz, and how long the note waits before it starts */
  vib: { depth: number; rate: number; delay: number };
  /** pitch sweep in semitones a second (negative: down; a kick is -300) */
  sweep: number;
  /** a chord played as an arpeggio, notes a second (0: the chord's notes together) */
  arp: number;
  /** the pulse width swept by an LFO (SID): how far, how fast */
  pwm: { depth: number; rate: number };
  /** SID: ring mod / hard sync with an inner oscillator at this ratio of the note (0: off) */
  ring: number;
  sync: number;
  filter: { type: "off" | "lp" | "bp" | "hp"; cutoff: number; reso: number };
  /** the instrument's own 32-step wave (0–31), for table "custom" */
  custom?: number[];
}

export function defaultChip(): ChipParams {
  return {
    level: 0,
    chip: "2a03",
    wave: "pulse",
    duty: 0.5,
    noise: "long",
    table: "sine",
    amp: { a: 0, d: 0.3, s: 0.8, r: 0.08 },
    vib: { depth: 0, rate: 6, delay: 0.2 },
    sweep: 0,
    arp: 0,
    pwm: { depth: 0, rate: 1 },
    ring: 0,
    sync: 0,
    filter: { type: "off", cutoff: 2000, reso: 0.3 },
  };
}

type P = Partial<Omit<ChipParams, "amp" | "vib" | "pwm" | "filter">> & { amp?: Partial<Adsr>; vib?: Partial<ChipParams["vib"]>; pwm?: Partial<ChipParams["pwm"]>; filter?: Partial<ChipParams["filter"]> };
const pre = (o: P) => (p: ChipParams) => {
  const { amp, vib, pwm, filter, ...rest } = o;
  Object.assign(p, rest);
  if (amp) Object.assign(p.amp, amp);
  if (vib) Object.assign(p.vib, vib);
  if (pwm) Object.assign(p.pwm, pwm);
  if (filter) Object.assign(p.filter, filter);
};

/** our own presets, named by the chip (the console it's like is in the help) */
export const CHIP_PRESETS: Record<string, (p: ChipParams) => void> = {
  // 2A03
  "2a03-lead": pre({ chip: "2a03", wave: "pulse", duty: 0.25, amp: { d: 0.5, s: 0.7 }, vib: { depth: 0.25, rate: 6, delay: 0.25 } }),
  "2a03-lead12": pre({ chip: "2a03", wave: "pulse", duty: 0.125, amp: { d: 0.4, s: 0.6 }, vib: { depth: 0.2, rate: 6, delay: 0.3 } }),
  "2a03-square": pre({ chip: "2a03", wave: "pulse", duty: 0.5, amp: { d: 0.2, s: 0.75 } }),
  "2a03-bass": pre({ chip: "2a03", wave: "triangle", amp: { d: 0.1, s: 1, r: 0.02 } }),
  "2a03-arp": pre({ chip: "2a03", wave: "pulse", duty: 0.125, arp: 50, amp: { d: 0.3, s: 0.6 } }),
  "2a03-pluck": pre({ chip: "2a03", wave: "pulse", duty: 0.25, amp: { d: 0.18, s: 0, r: 0.05 } }),
  "2a03-kick": pre({ chip: "2a03", wave: "triangle", sweep: -260, amp: { d: 0.18, s: 0, r: 0.02 } }),
  "2a03-snare": pre({ chip: "2a03", wave: "noise", amp: { d: 0.16, s: 0, r: 0.04 } }),
  "2a03-hat": pre({ chip: "2a03", wave: "noise", noise: "short", amp: { d: 0.05, s: 0, r: 0.02 } }),
  // DMG
  "dmg-lead": pre({ chip: "dmg", wave: "pulse", duty: 0.5, amp: { d: 0.6, s: 0.6 }, vib: { depth: 0.3, rate: 5.5, delay: 0.3 } }),
  "dmg-lead25": pre({ chip: "dmg", wave: "pulse", duty: 0.25, amp: { d: 0.4, s: 0.5 } }),
  "dmg-sweep": pre({ chip: "dmg", wave: "pulse", duty: 0.5, sweep: 30, amp: { d: 0.35, s: 0, r: 0.05 } }),
  "dmg-wave-bass": pre({ chip: "dmg", wave: "wave", table: "bass", amp: { a: 0, d: 0.1, s: 1, r: 0.03 } }),
  "dmg-wave-pad": pre({ chip: "dmg", wave: "wave", table: "organ", amp: { a: 0.08, d: 0.3, s: 0.8, r: 0.25 }, vib: { depth: 0.15, rate: 5, delay: 0.4 } }),
  "dmg-arp": pre({ chip: "dmg", wave: "pulse", duty: 0.25, arp: 60, amp: { d: 0.3, s: 0.5 } }),
  "dmg-snare": pre({ chip: "dmg", wave: "noise", amp: { d: 0.14, s: 0, r: 0.03 } }),
  "dmg-hat": pre({ chip: "dmg", wave: "noise", noise: "short", amp: { d: 0.04, s: 0, r: 0.02 } }),
  // SID
  "sid-pwm-lead": pre({ chip: "sid", wave: "pulse", duty: 0.4, pwm: { depth: 0.3, rate: 1.2 }, amp: { a: 0.005, d: 0.4, s: 0.7, r: 0.2 }, vib: { depth: 0.25, rate: 6, delay: 0.3 } }),
  "sid-pwm-bass": pre({ chip: "sid", wave: "pulse", duty: 0.3, pwm: { depth: 0.2, rate: 0.7 }, filter: { type: "lp", cutoff: 900, reso: 0.5 }, amp: { d: 0.25, s: 0.6, r: 0.06 } }),
  "sid-saw-bass": pre({ chip: "sid", wave: "saw", filter: { type: "lp", cutoff: 600, reso: 0.7 }, amp: { d: 0.2, s: 0.5, r: 0.05 } }),
  "sid-sync-lead": pre({ chip: "sid", wave: "saw", sync: 2.5, amp: { a: 0.003, d: 0.5, s: 0.7, r: 0.15 }, vib: { depth: 0.2, rate: 6, delay: 0.25 } }),
  "sid-ring-bell": pre({ chip: "sid", wave: "triangle", ring: 3.5, amp: { a: 0, d: 0.9, s: 0, r: 0.6 } }),
  "sid-arp": pre({ chip: "sid", wave: "pulse", duty: 0.25, arp: 50, pwm: { depth: 0.15, rate: 2 }, amp: { d: 0.4, s: 0.6 } }),
  "sid-kick": pre({ chip: "sid", wave: "triangle", sweep: -320, amp: { d: 0.2, s: 0, r: 0.02 } }),
  "sid-snare": pre({ chip: "sid", wave: "noise", filter: { type: "hp", cutoff: 1200, reso: 0.2 }, amp: { d: 0.18, s: 0, r: 0.05 } }),
  // AY
  "ay-square": pre({ chip: "ay", wave: "pulse", duty: 0.5, amp: { d: 0.3, s: 0.8 } }),
  "ay-buzz-saw": pre({ chip: "ay", wave: "buzz-saw", amp: { d: 0.2, s: 0.9, r: 0.05 } }),
  "ay-buzz-tri": pre({ chip: "ay", wave: "buzz-tri", amp: { d: 0.2, s: 0.9, r: 0.05 } }),
  "ay-arp": pre({ chip: "ay", wave: "pulse", arp: 50, amp: { d: 0.3, s: 0.7 } }),
  "ay-kick": pre({ chip: "ay", wave: "tone+noise", sweep: -280, amp: { d: 0.16, s: 0, r: 0.02 } }),
  "ay-snare": pre({ chip: "ay", wave: "noise", amp: { d: 0.15, s: 0, r: 0.04 } }),
  "ay-hat": pre({ chip: "ay", wave: "noise", amp: { d: 0.045, s: 0, r: 0.02 } }),
  // SN76489
  "psg-square": pre({ chip: "psg", wave: "pulse", amp: { d: 0.3, s: 0.8 } }),
  "psg-bass": pre({ chip: "psg", wave: "noise", noise: "short", amp: { d: 0.2, s: 0.9, r: 0.03 } }),
  "psg-arp": pre({ chip: "psg", wave: "pulse", arp: 50, amp: { d: 0.3, s: 0.7 } }),
  "psg-pluck": pre({ chip: "psg", wave: "pulse", amp: { d: 0.2, s: 0, r: 0.05 } }),
  "psg-snare": pre({ chip: "psg", wave: "noise", amp: { d: 0.14, s: 0, r: 0.04 } }),
  "psg-hat": pre({ chip: "psg", wave: "noise", amp: { d: 0.04, s: 0, r: 0.02 } }),
  // PC Engine
  "pce-wave-lead": pre({ chip: "pce", wave: "wave", table: "vox", amp: { a: 0.01, d: 0.4, s: 0.7, r: 0.15 }, vib: { depth: 0.2, rate: 6, delay: 0.3 } }),
  "pce-wave-bass": pre({ chip: "pce", wave: "wave", table: "bass", amp: { d: 0.15, s: 0.9, r: 0.04 } }),
  "pce-organ": pre({ chip: "pce", wave: "wave", table: "organ", amp: { a: 0.01, d: 0.2, s: 0.9, r: 0.1 } }),
  "pce-pluck": pre({ chip: "pce", wave: "wave", table: "pluck", amp: { d: 0.25, s: 0, r: 0.08 } }),
  "pce-arp": pre({ chip: "pce", wave: "wave", table: "saw", arp: 50, amp: { d: 0.3, s: 0.6 } }),
};

export function chipPreset(name?: string): ChipParams {
  const p = defaultChip();
  CHIP_PRESETS[name ?? ""]?.(p);
  // 3 dB under the other synths: a chip voice is all peak (one alone kept the limiter working)
  p.level = (PRESET_LEVELS[`chip:${name ?? ""}`] ?? 0) - CHIP_TRIM_DB;
  return structuredClone(p);
}

/** the presets of one chip (the INSTRUMENT screen shows those) */
export const chipPresetsFor = (chip: string) => Object.keys(CHIP_PRESETS).filter((n) => n.startsWith(chip + "-"));

export const CHIP_PARAMS: readonly Param[] = [
  { key: "chip", label: "chip", choices: CHIPS },
  { key: "wave", label: "wave", choices: CHIP_WAVES },
  { key: "duty", label: "pulse width", min: 0.0625, max: 0.9375, step: 0.0625 },
  { key: "noise", label: "noise", choices: ["long", "short"] },
  { key: "table", label: "wavetable", choices: TABLE_NAMES },
  { key: "amp.a", label: "attack", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.d", label: "decay", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "amp.s", label: "sustain", min: 0, max: 1, step: 0.0625 },
  { key: "amp.r", label: "release", min: 0, max: 10, step: 1.25, log: true, unit: "s" },
  { key: "vib.depth", label: "vibrato", min: 0, max: 2, step: 0.05, unit: "st" },
  { key: "vib.rate", label: "vibrato rate", min: 0.5, max: 20, step: 0.5, unit: "Hz" },
  { key: "vib.delay", label: "vibrato delay", min: 0, max: 2, step: 0.05, unit: "s" },
  { key: "sweep", label: "pitch sweep", min: -600, max: 600, step: 10, unit: "st/s" },
  { key: "arp", label: "chord arpeggio", min: 0, max: 100, step: 5, unit: "/s" },
  { key: "pwm.depth", label: "pwm depth", min: 0, max: 0.45, step: 0.025 },
  { key: "pwm.rate", label: "pwm rate", min: 0.05, max: 20, step: 1.25, log: true, unit: "Hz" },
  { key: "ring", label: "ring mod", min: 0, max: 8, step: 0.25 },
  { key: "sync", label: "hard sync", min: 0, max: 8, step: 0.25 },
  { key: "filter.type", label: "filter", choices: ["off", "lp", "bp", "hp"] },
  { key: "filter.cutoff", label: "cutoff", min: 30, max: 18000, step: 1.12, log: true, unit: "Hz" },
  { key: "filter.reso", label: "resonance", min: 0, max: 0.95, step: 0.05 },
  { key: "level", label: "level", min: -24, max: 12, step: 0.5, unit: "dB" },
];

export const findChip = (name: string) => findIn(CHIP_PARAMS, name);
export const setChip = (p: ChipParams, key: string, text: string) => setIn(CHIP_PARAMS, p, key, text);
export const nudgeChip = (p: ChipParams, key: string, dir: 1 | -1, big = false) => nudgeIn(CHIP_PARAMS, p, key, dir, big);
export const showChip = (p: ChipParams, def: Param) => showIn(p, def);
export function sanitizeChip(j: unknown): ChipParams {
  const p = sanitizeWith(CHIP_PARAMS, defaultChip(), j);
  const c = (j as { custom?: unknown } | null)?.custom;
  if (Array.isArray(c) && c.length === 32 && c.every((x) => Number.isInteger(x) && x >= 0 && x <= 31)) p.custom = [...c];
  return p;
}

/** "0123…" (32 hex digits, 0–F, or 0–V for 5 bits) → a custom wave; null if it isn't one */
export function parseTable(text: string): number[] | null {
  const t = text.replace(/\s+/g, "").toLowerCase();
  if (t.length !== 32) return null;
  const v = [...t].map((ch) => parseInt(ch, 32));
  if (v.some((x) => !(x >= 0 && x <= 31))) return null;
  // given in hex (0–F, 4 bits): spread to 0–31 like the 5-bit tables
  return v.every((x) => x <= 15) ? v.map((x) => x * 2 + (x > 7 ? 1 : 0)) : v;
}

/** our wavetables, 32 steps from 0 to 31 */
const TABLES: Record<string, number[]> = (() => {
  const make = (f: (x: number) => number) => Array.from({ length: 32 }, (_, i) => Math.max(0, Math.min(31, Math.round(15.5 + 15.5 * f(i / 32)))));
  const s = (x: number) => Math.sin(2 * Math.PI * x);
  return {
    sine: make(s),
    saw: make((x) => 1 - 2 * x),
    square: make((x) => (x < 0.5 ? 1 : -1)),
    organ: make((x) => (s(x) + 0.5 * s(2 * x) + 0.33 * s(4 * x)) / 1.5),
    bass: make((x) => (x < 0.25 ? 1 : x < 0.5 ? 0.2 : x < 0.75 ? -0.6 : -1)),
    pluck: make((x) => s(x) * 0.6 + s(3 * x) * 0.4),
    vox: make((x) => (s(x) + 0.6 * s(3 * x) + 0.3 * s(5 * x)) / 1.6),
  };
})();
export const tableOf = (p: ChipParams): number[] => (p.table === "custom" && p.custom ? p.custom : TABLES[p.table] ?? TABLES.sine);

// ── each chip's grid: the frequency it can really make, nearest to the one asked ──

const NES = 1789773, SID = 985248, AY = 1773400, PSG = 3579545;
const NES_NOISE = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];

/** a period register: f = clock / (k × n), n whole, from lo to hi */
const grid = (hz: number, clock: number, k: number, lo: number, hi: number) => clock / (k * Math.max(lo, Math.min(hi, Math.round(clock / (k * hz)))));

/** the tone's frequency on this chip */
export function chipHz(chip: ChipModel, wave: ChipWave, hz: number): number {
  if (hz <= 0) return 0;
  switch (chip) {
    case "2a03":
      return wave === "triangle" ? grid(hz, NES, 32, 1, 2048) : grid(hz, NES, 16, 1, 2048);
    case "dmg": {
      // pulse: 131072 / (2048 - x); wave: 65536 / (2048 - x), x 0–2047
      const base = wave === "wave" ? 65536 : 131072;
      return base / Math.max(1, Math.min(2048, Math.round(base / hz)));
    }
    case "sid":
      return (Math.max(1, Math.min(65535, Math.round((hz * 16777216) / SID))) * SID) / 16777216;
    case "ay":
      return wave === "buzz-saw" ? grid(hz, AY, 256, 1, 65535) : wave === "buzz-tri" ? grid(hz, AY, 512, 1, 65535) : grid(hz, AY, 16, 1, 4095);
    case "psg":
      return grid(hz, PSG, 32, 1, 1023);
    case "pce":
      return grid(hz, PSG, 32, 1, 4095);
  }
}

/** the noise's shift rate on this chip, for a note (higher notes, brighter noise) */
export function noiseHz(chip: ChipModel, hz: number): number {
  const want = hz * 16;
  switch (chip) {
    case "2a03": {
      let best = NES / NES_NOISE[0];
      for (const n of NES_NOISE) if (Math.abs(NES / n - want) < Math.abs(best - want)) best = NES / n;
      return best;
    }
    case "dmg": {
      // 524288 / r / 2^(s+1), r 0.5 or 1–7, s 0–13
      let best = 0;
      for (const r of [0.5, 1, 2, 3, 4, 5, 6, 7]) for (let s = 0; s < 14; s++) {
        const f = 524288 / r / 2 ** (s + 1);
        if (Math.abs(f - want) < Math.abs(best - want)) best = f;
      }
      return best;
    }
    case "ay":
      return grid(want, AY, 16, 1, 31);
    case "psg":
      return grid(want, PSG, 32, 1, 1023);
    default:
      return Math.min(want, 40000);
  }
}

/** how many volume steps the chip has (2a03, dmg, ay, psg, pce: 16; SID: 256) */
const VOLUME_STEPS = (chip: ChipModel) => (chip === "sid" ? 255 : 15);
/** an envelope's level as the chip can set it */
export const chipVolume = (chip: ChipModel, env: number) => Math.round(Math.max(0, Math.min(1, env)) * VOLUME_STEPS(chip)) / VOLUME_STEPS(chip);

/** the four pulse widths of the 2A03 and the Game Boy */
const DUTIES = [0.125, 0.25, 0.5, 0.75];
export const snapDuty = (chip: ChipModel, d: number) => (chip === "2a03" || chip === "dmg" ? DUTIES.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a)) : Math.max(0.02, Math.min(0.98, d)));

const TAU = 2 * Math.PI;
/** sub-steps a frame: the waves are computed 4× faster and averaged (less aliasing, still sharp) */
const OVER = 4;
/** frames between two pitch updates (~1.5 kHz: smooth enough for vibrato and sweeps) */
const CONTROL = 32;

/** a state-variable filter (TPT), for the SID's */
class Svf {
  private s1 = 0;
  private s2 = 0;
  private g = 0;
  private k = 1;
  set(hz: number, sr: number, reso: number) {
    this.g = Math.tan((Math.PI * Math.min(hz, sr * 0.45)) / sr);
    this.k = 2 - 1.9 * reso;
  }
  run(x: number, type: "lp" | "bp" | "hp"): number {
    const hp = (x - (this.k + this.g) * this.s1 - this.s2) / (1 + this.g * (this.k + this.g));
    const bp = this.g * hp + this.s1;
    const lp = this.g * bp + this.s2;
    this.s1 = this.g * hp + bp;
    this.s2 = this.g * bp + lp;
    return type === "lp" ? lp : type === "bp" ? bp : hp;
  }
}

export class ChipVoice implements Voice {
  on = false;
  readonly rings = true;
  private p: ChipParams = defaultChip();
  private table: number[] = TABLES.sine;
  /** the note's frequency (from the tracker, slides and vibrato included) */
  private hz = C3_HZ;
  private ph = 0;
  private inner = 0;
  private ringPh = 0;
  private noisePh = 0;
  /** the pitch, the noise rate and the width, worked out every CONTROL frames (the grid search isn't free) */
  private ctl = 0;
  private cur = { hz: 0, nhz: 0, duty: 0.5 };
  private lfsr = 0x7fff;
  private bit = 1;
  private t = 0;
  private released: { at: number; amp: number } | null = null;
  private gl = 0;
  private gr = 0;
  /** the chord, as semitones over the note, when it's played as an arpeggio */
  private arpSteps: number[] = [];
  private filt = new Svf();
  /** a DC blocker (the chips' outputs went through a capacitor) */
  private dcx = 0;
  private dcy = 0;

  constructor(private readonly sr: number) {}

  start(n: NoteStart): void {
    this.p = n.instrument.chip ?? defaultChip();
    this.table = tableOf(this.p);
    this.hz = (n.rate / C3_RATE) * C3_HZ;
    this.ph = this.inner = this.ringPh = this.noisePh = 0;
    this.ctl = 0;
    this.lfsr = 0x7fff;
    this.t = 0;
    this.released = null;
    this.arpSteps = [];
    this.on = true;
  }

  /** play the chord's notes one after the other (the renderer calls it when the instrument's arp is on) */
  arpeggio(steps: number[]): void {
    this.arpSteps = steps;
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
    this.released = { at: this.t, amp: adsr(this.p.amp, this.t, null) };
  }

  /** one noise step: the chip's shift register */
  private shift(): void {
    const p = this.p;
    const s = this.lfsr;
    let fb: number;
    switch (p.chip) {
      case "ay":
        fb = (s ^ (s >> 3)) & 1; // 17 bits
        this.lfsr = ((s >> 1) | (fb << 16)) & 0x1ffff;
        break;
      case "psg":
        if (p.noise === "short") this.lfsr = ((s >> 1) | ((s & 1) << 15)) & 0xffff || 0x8000; // periodic: a single bit going round
        else (fb = (s ^ (s >> 3)) & 1), (this.lfsr = ((s >> 1) | (fb << 15)) & 0xffff);
        break;
      default:
        // 2a03 / dmg / sid / pce: 15 bits, the short mode taps bit 6 (2a03) or narrows to 7 bits (dmg)
        fb = (s ^ (s >> (p.noise === "short" && p.chip === "2a03" ? 6 : 1))) & 1;
        this.lfsr = (s >> 1) | (fb << 14);
        if (p.noise === "short" && p.chip === "dmg") this.lfsr = (this.lfsr & ~0x40) | (fb << 6);
    }
    this.bit = this.lfsr & 1;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (!this.on) return;
    const p = this.p, sr = this.sr, dt = 1 / sr, sub = dt / OVER;
    const filterOn = p.chip === "sid" && p.filter.type !== "off";
    if (filterOn) this.filt.set(p.filter.cutoff, sr, p.filter.reso);
    const tri4 = p.chip !== "sid"; // the triangle on 4 bits (the SID's is smooth)
    for (let i = from; i < to; i++) {
      const r = this.released;
      const env = adsr(p.amp, this.t, r && { at: r.at, from: r.amp });
      if ((r && env <= 0) || (!r && p.amp.s <= 0 && this.t > p.amp.a + p.amp.d)) {
        this.on = false;
        return;
      }
      const vol = chipVolume(p.chip, env); // the chip's volume steps
      const noisy = p.wave === "noise" || p.wave === "tone+noise";
      if (this.ctl-- <= 0) {
        this.ctl = CONTROL;
        // the pitch: the note, its arpeggio, the sweep, the vibrato — then the chip's grid
        let semis = 0;
        if (this.arpSteps.length && p.arp > 0) {
          const all = [0, ...this.arpSteps];
          semis += all[Math.floor(this.t * p.arp) % all.length];
        }
        if (p.sweep) semis += Math.max(-72, Math.min(72, p.sweep * this.t));
        if (p.vib.depth && this.t > p.vib.delay) semis += Math.sin(TAU * p.vib.rate * (this.t - p.vib.delay)) * p.vib.depth;
        const want = this.hz * 2 ** (semis / 12);
        this.cur.hz = want < 8 ? 0 : chipHz(p.chip, p.wave, want);
        this.cur.nhz = noisy ? noiseHz(p.chip, want) : 0;
        this.cur.duty = snapDuty(p.chip, p.duty + (p.pwm.depth ? Math.sin(TAU * p.pwm.rate * this.t) * p.pwm.depth : 0));
      }
      const { hz, nhz, duty } = this.cur;
      let acc = 0;
      for (let k = 0; k < OVER; k++) {
        // hard sync: an inner oscillator at the note restarts ours, which runs `sync` × faster
        let ph = this.ph;
        if (p.sync > 0) {
          this.inner += hz * sub;
          if (this.inner >= 1) (this.inner -= 1), (this.ph = 0);
          this.ph = (this.ph + hz * p.sync * sub) % 1;
          ph = this.ph;
        } else {
          this.ph = (this.ph + hz * sub) % 1;
          ph = this.ph;
        }
        if (noisy) {
          this.noisePh += nhz * sub;
          while (this.noisePh >= 1) this.noisePh -= 1, this.shift();
        }
        let y: number;
        switch (p.wave) {
          case "pulse":
            y = ph < duty ? 1 : -1;
            break;
          case "triangle": {
            const x = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
            y = tri4 ? Math.round((x + 1) * 7.5) / 7.5 - 1 : x;
            break;
          }
          case "saw":
            y = 1 - 2 * ph;
            if (p.chip !== "sid") y = Math.round((y + 1) * 7.5) / 7.5 - 1;
            break;
          case "noise":
            y = this.bit ? 1 : -1;
            break;
          case "tone+noise":
            // the AY mixes them as a logic AND
            y = (ph < 0.5 ? 1 : 0) & this.bit ? 1 : -1;
            break;
          case "wave": {
            const bits = p.chip === "dmg" ? 15 : 31;
            const v = this.table[Math.floor(ph * 32) & 31];
            y = (bits === 15 ? v >> 1 : v) / (bits / 2) - 1;
            break;
          }
          case "buzz-saw":
            // the AY's envelope, repeated at the note: 16 steps down
            y = (15 - Math.floor(ph * 16)) / 7.5 - 1;
            break;
          case "buzz-tri": {
            const s = Math.floor(ph * 32);
            y = (s < 16 ? 15 - s : s - 16) / 7.5 - 1;
            break;
          }
        }
        // SID ring mod: the wave flipped by an inner square at `ring` × the note
        if (p.ring > 0 && (this.ringPh = (this.ringPh + hz * p.ring * sub) % 1) >= 0.5) y = -y;
        acc += y;
      }
      let y = (acc / OVER) * vol;
      if (filterOn) y = this.filt.run(y, p.filter.type as "lp" | "bp" | "hp");
      // the output capacitor: no DC (a pulse at 12.5 % would sit off-centre)
      const out = y - this.dcx + 0.995 * this.dcy;
      this.dcx = y;
      this.dcy = out;
      this.t += dt;
      left[i] += out * 0.35 * this.gl;
      right[i] += out * 0.35 * this.gr;
    }
  }
}
