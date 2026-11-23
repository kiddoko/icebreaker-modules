/**
 * BreakerMED — a voice: one sound playing on a track (or one note of a
 * chord). Every kind of instrument has its own (a sample, an analog synth, an
 * FM synth, a drum): the renderer only knows this shape, so a new kind of
 * instrument plugs in without touching the rest.
 */
import { PAULA_CLOCK, type Instrument } from "../song";
import { VintageVoice } from "./vintage";

/** a sample's frames a second at C-3 when it has no rate of its own (the Amiga's: period 214) */
const C3 = PAULA_CLOCK / 214;
import { AnalogVoice } from "./analog";
import { DrumVoice } from "./drums";
import { ChipVoice } from "./chip";
import { FmVoice } from "./fm";

export interface NoteStart {
  instrument: Instrument;
  /** how fast to read a sample, in its frames a second (a synth: the note's frequency × its base) */
  rate: number;
  /** start this many frames in (a sample's 19xx offset) */
  offset: number;
}

export interface Voice {
  readonly on: boolean;
  start(n: NoteStart): void;
  /** the pitch (rate), the loudness 0…1, the place -1…1 */
  set(rate: number, volume: number, pan: number): void;
  stop(): void;
  /** it rings on when its track plays the next note (a synth's release, a drum's tail), instead of being cut */
  readonly rings?: boolean;
  /** add this voice into left / right, frames [from, to) */
  render(left: Float32Array, right: Float32Array, from: number, to: number): void;
}

/**
 * A sample: read at `rate` frames a second, looped (ping-pong too), stepped
 * like the Amiga's Paula (nearest frame, its grit) or smooth (linear).
 */
export class SampleVoice implements Voice {
  on = false;
  paula = true;
  private data: Float32Array = new Float32Array(0);
  private loopStart = 0;
  private loopEnd = 0;
  private pingPong = false;
  private pos = 0;
  private dir = 1;
  private step = 1;
  private gl = 0;
  private gr = 0;
  /** its own rate against the Amiga's (a sound kept at 48 kHz: 48 000 / 16 574) */
  private k = 1;

  constructor(private readonly outRate: number) {}

  start(n: NoteStart): void {
    const i = n.instrument;
    this.data = i.data;
    this.loopStart = i.loopLength > 2 ? i.loopStart : 0;
    this.loopEnd = i.loopLength > 2 ? Math.min(i.data.length, i.loopStart + i.loopLength) : 0;
    this.pingPong = i.pingPong && this.loopEnd > 0;
    this.pos = Math.max(0, n.offset);
    this.dir = 1;
    this.k = i.rate ? i.rate / C3 : 1;
    this.step = (Math.max(0, n.rate) * this.k) / this.outRate;
    this.on = this.pos < this.data.length;
  }

  set(rate: number, volume: number, pan: number): void {
    this.step = (Math.max(0, rate) * this.k) / this.outRate;
    const v = Math.max(0, Math.min(1, volume));
    // linear pan: the middle is full on both sides (an Amiga voice is hard left or right)
    this.gl = v * Math.min(1, 1 - pan);
    this.gr = v * Math.min(1, 1 + pan);
  }

  stop(): void {
    this.on = false;
  }

  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (!this.on) return;
    const d = this.data;
    const loops = this.loopEnd > this.loopStart;
    const end = loops ? this.loopEnd : d.length;
    const loopLen = this.loopEnd - this.loopStart;
    let pos = this.pos;
    for (let i = from; i < to; i++) {
      if (this.dir > 0 && pos >= end) {
        if (!loops) return void (this.on = false);
        if (this.pingPong) (this.dir = -1), (pos = end - 1 - (pos - end));
        else pos = this.loopStart + ((pos - this.loopStart) % loopLen);
      } else if (this.dir < 0 && pos < this.loopStart) (this.dir = 1), (pos = this.loopStart + (this.loopStart - pos));
      const k = pos | 0;
      let x = d[k] ?? 0;
      if (!this.paula) {
        const k1 = k + this.dir;
        const y = k1 >= end ? (loops ? d[this.loopStart] : x) : k1 < 0 ? x : d[k1];
        x += ((y ?? x) - x) * Math.abs(pos - k);
      }
      left[i] += x * this.gl;
      right[i] += x * this.gr;
      pos += this.step * this.dir;
    }
    this.pos = pos;
  }
}

/** The voice an instrument plays with: a sample's, or a synth's (it releases its notes instead of cutting them). */
export function voiceFor(instrument: Instrument, outRate: number, paula: boolean): Voice {
  const v = plainVoice(instrument, outRate, paula);
  // the vintage mode: the voice through an old machine's converter (vintage.ts)
  if (instrument.vintage) {
    // Paula reads a sample frame by frame: never smoothed in front of it
    if (v instanceof SampleVoice && instrument.vintage.kind === "amiga") v.paula = true;
    return new VintageVoice(v, outRate, instrument.vintage);
  }
  return v;
}

function plainVoice(instrument: Instrument, outRate: number, paula: boolean): Voice {
  if (instrument.kind === "analog") return new AnalogVoice(outRate);
  if (instrument.kind === "fm") return new FmVoice(outRate);
  if (instrument.kind === "drums") return new DrumVoice(outRate);
  if (instrument.kind === "chip") return new ChipVoice(outRate);
  const v = new SampleVoice(outRate);
  v.paula = paula;
  return v;
}
