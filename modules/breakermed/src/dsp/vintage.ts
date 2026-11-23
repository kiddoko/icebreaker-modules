/**
 * BreakerMED — the vintage mode: an instrument heard through an old machine's
 * converters, whatever it is (a sample, a synth, a kit). Per instrument
 * (`med vintage <n> amiga|akai|off`, alt R), kept in the song.
 *
 *   amiga  the A500's Paula: 8 bits, each value held for the note's own period
 *          (the rate goes up and down with the pitch, ≤ 28 867 Hz), no
 *          smoothing before it (the aliasing), then the output's 2-pole
 *          low-pass (~4.4 kHz, the "LED filter" warmth)
 *   akai   an S900 / S950-style sampler: 12 bits at a fixed, lower rate
 *          (22 050 Hz by default, `med vintage <n> akai <rate>`), no
 *          anti-alias filter in front (the grit), a gentle 2-pole after it
 *
 * Only the sound changes: the notes, the instrument's data, the song stay as
 * they are (off: exactly the sound before). A wrapper around any voice: it
 * plays the voice at full level in the middle, then does the machine, then the
 * volume and the place.
 */
import type { NoteStart, Voice } from "./voice";

export type VintageKind = "amiga" | "akai";
export const VINTAGE_KINDS: VintageKind[] = ["amiga", "akai"];

export interface VintageSettings {
  kind: VintageKind;
  /** akai: its rate (7 500–40 000 Hz) */
  rate?: number;
}

/** what each one is, said in a line (the screen, med vintage) */
export const VINTAGE_SAID: Record<VintageKind, string> = {
  amiga: "Amiga: 8 bits, the note's own rate, the A500's filter",
  akai: "Akai S900 / S950-style: 12 bits, a lower rate, aliasing",
};

/** Paula's fastest rate (period 124 on a PAL machine) */
export const PAULA_MAX_RATE = 3546895 / 124;
export const AKAI_RATE = 22050;
export const AKAI_RATES = [7500, 40000] as const;

/** a 2-pole (12 dB/octave) Butterworth low-pass, one channel */
class LowPass {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  constructor(rate: number, hz: number) {
    const f = Math.min(hz, rate * 0.45);
    const w = (2 * Math.PI * f) / rate;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return Math.abs(y) < 1e-20 ? 0 : y;
  }
}

/** an old machine's converter: hold a value `rate` times a second, at `bits` bits */
class Converter {
  private phase = 1;
  private held = 0;
  constructor(private readonly bits: number) {}
  run(x: number, step: number): number {
    this.phase += step;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      const q = 2 ** (this.bits - 1);
      this.held = Math.max(-q, Math.min(q - 1, Math.round(Math.max(-1, Math.min(1, x)) * q))) / q;
    }
    return this.held;
  }
}

export class VintageVoice implements Voice {
  private l: Float32Array = new Float32Array(0);
  private r: Float32Array = new Float32Array(0);
  private gl = 0;
  private gr = 0;
  /** the note's rate, frames a second (Paula's hold follows it) */
  private rate = 8363;
  private readonly cl: Converter;
  private readonly cr: Converter;
  private readonly fl: LowPass;
  private readonly fr: LowPass;
  /** after the last sound, how long the filter still rings (frames) */
  private tail = 0;

  constructor(
    readonly inner: Voice,
    private readonly outRate: number,
    readonly settings: VintageSettings,
  ) {
    const bits = settings.kind === "amiga" ? 8 : 12;
    this.cl = new Converter(bits);
    this.cr = new Converter(bits);
    const cut = settings.kind === "amiga" ? 4400 : Math.min(12000, this.akaiRate * 0.42);
    this.fl = new LowPass(outRate, cut);
    this.fr = new LowPass(outRate, cut);
  }

  private get akaiRate(): number {
    const r = this.settings.rate ?? AKAI_RATE;
    return Math.max(AKAI_RATES[0], Math.min(AKAI_RATES[1], r));
  }

  get on(): boolean {
    return this.inner.on || this.tail > 0;
  }
  get rings(): boolean | undefined {
    return this.inner.rings;
  }
  start(n: NoteStart): void {
    this.rate = n.rate;
    this.inner.start(n);
    this.inner.set(n.rate, 1, 0);
  }
  set(rate: number, volume: number, pan: number): void {
    this.rate = rate;
    // the voice plays at full level in the middle: the machine sees the whole signal (its bits), then volume and pan
    this.inner.set(rate, 1, 0);
    const v = Math.max(0, Math.min(1, volume));
    this.gl = v * Math.min(1, 1 - pan);
    this.gr = v * Math.min(1, 1 + pan);
  }
  stop(): void {
    this.inner.stop();
  }
  /** cut at once (a drum choked by another) */
  kill(): void {
    (this.inner as Voice & { kill?: () => void }).kill?.();
    this.tail = 0;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const n = to - from;
    if (n <= 0) return;
    if (this.l.length < n) (this.l = new Float32Array(n)), (this.r = new Float32Array(n));
    const L = this.l, R = this.r;
    L.fill(0, 0, n);
    R.fill(0, 0, n);
    const was = this.inner.on;
    if (was) this.inner.render(L, R, 0, n);
    const hold = this.settings.kind === "amiga" ? Math.min(PAULA_MAX_RATE, Math.max(50, this.rate)) : this.akaiRate;
    const step = hold / this.outRate;
    let loud = 0;
    for (let i = 0; i < n; i++) {
      const a = this.fl.run(this.cl.run(L[i], step));
      const b = this.fr.run(this.cr.run(R[i], step));
      left[from + i] += a * this.gl;
      right[from + i] += b * this.gr;
      loud = Math.max(loud, Math.abs(a), Math.abs(b));
    }
    // the voice ended: a few ms more for the filter and the held value to die away
    if (was && !this.inner.on) this.tail = Math.round(this.outRate * 0.01);
    else if (!this.inner.on) this.tail = loud < 1e-5 ? 0 : Math.max(0, this.tail - n);
  }
}

/** an instrument's vintage setting, read from a song file (anything else: none) */
export function cleanVintage(v: unknown): VintageSettings | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!VINTAGE_KINDS.includes(o.kind as VintageKind)) return undefined;
  const out: VintageSettings = { kind: o.kind as VintageKind };
  if (out.kind === "akai" && typeof o.rate === "number" && o.rate >= AKAI_RATES[0] && o.rate <= AKAI_RATES[1]) out.rate = Math.round(o.rate);
  return out;
}
