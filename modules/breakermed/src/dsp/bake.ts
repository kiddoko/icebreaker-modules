/**
 * breakerMED — our computed instruments turned into samples, for the files
 * other trackers read (.mod, .med hold samples only):
 *   a synth  → its middle C, held for a while, then released;
 *   a kit    → each drum the song plays becomes an instrument of its own, and
 *              the notes that played it now play that sample at C-3.
 */
import { emptyInstrument, type Instrument, type Song } from "../song";
import { HQ_RATE } from "../sampler";
import { AnalogVoice, C3_RATE } from "./analog";
import { DRUM_NAMES, DrumVoice } from "./drums";
import { FmVoice } from "./fm";
import { ChipVoice } from "./chip";
import type { Voice } from "./voice";
import { Renderer } from "../render";
import { newSong } from "../song";

/** a voice played into a new sample: held `hold` seconds, then let go, until silent (`max` seconds) */
function record(v: Voice, hold: number, max: number): Float32Array {
  const n = Math.round(HQ_RATE * max);
  const l = new Float32Array(n), r = new Float32Array(n);
  const held = Math.min(n, Math.round(HQ_RATE * hold));
  v.render(l, r, 0, held);
  v.stop();
  v.render(l, r, held, n);
  // no offset (DC) in the sample: a ~10 Hz high-pass
  const k = 1 - (2 * Math.PI * 10) / HQ_RATE;
  let x1 = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    const x = l[i];
    y1 = x - x1 + k * y1;
    x1 = x;
    l[i] = y1;
  }
  let end = n;
  while (end > 1 && Math.abs(l[end - 1]) < 1e-4) end--;
  return l.slice(0, Math.max(1, end));
}

/** how loud an instrument is heard in a song: one C-3 on a track, its first `seconds` (RMS) */
function heard(ins: Instrument, seconds: number): number {
  const s = newSong(1);
  s.instruments = [ins];
  s.trackPan = [0];
  const c = s.blocks[0].cells[0][0];
  (c.note = 25), (c.inst = 1);
  const rate = 24000;
  const r = new Renderer(s, rate, false);
  r.limit = false;
  r.play(0, 0);
  const n = Math.round(rate * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  r.render(L, R);
  let sq = 0;
  for (let i = 0; i < n; i++) sq += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(sq / (2 * n));
}

/** the sample made as loud as the synth it comes from (as far as full scale allows) */
function matchLevel(from: Instrument, baked: Instrument, hold: number): Instrument {
  const want = heard(from, hold), got = heard(baked, hold);
  if (!(want > 0 && got > 0)) return baked;
  let k = want / got;
  let peak = 0;
  for (const x of baked.data) peak = Math.max(peak, Math.abs(x));
  if (peak * k > 1) k = 1 / peak; // louder than a sample can hold: as loud as it can
  baked.data = baked.data.map((x) => x * k);
  return baked;
}

const asSample = (from: Instrument, name: string, data: Float32Array): Instrument =>
  Object.assign(emptyInstrument(), { name: name.slice(0, 40), volume: from.volume, gain: from.gain, transpose: 12, kind: "sample", data });

/** The synth's sound at C-3: held `hold` seconds, then its release (2 s at most). */
export function bakeSynth(ins: Instrument, hold = 0.8): Instrument {
  const v = ins.kind === "fm" ? new FmVoice(HQ_RATE) : ins.kind === "chip" ? new ChipVoice(HQ_RATE) : new AnalogVoice(HQ_RATE);
  v.start({ instrument: ins, rate: C3_RATE, offset: 0 });
  v.set(C3_RATE, 1, 0);
  const out = asSample(ins, ins.name, record(v, hold, hold + 2));
  out.transpose = ins.transpose + 12;
  return matchLevel(ins, out, hold);
}

/** One drum of a kit (0 = the kick … 11 = the ride), as a sample. */
export function bakeDrum(ins: Instrument, drum: number): Instrument {
  const v = new DrumVoice(HQ_RATE);
  v.start({ instrument: ins, rate: C3_RATE * 2 ** (drum / 12), offset: 0 });
  v.set(C3_RATE, 1, 0);
  return asSample(ins, `${ins.name || "kit"} ${DRUM_NAMES[drum]}`, record(v, 8, 8));
}

/**
 * The song with every synth and kit as samples (the song itself isn't
 * changed), and how many of each. A kit's drums go to free instrument slots
 * (or after the last); the cells that played them are rewritten.
 */
export function withSynthsBaked(song: Song): { song: Song; baked: number; drums: number; lost: number } {
  let baked = 0, drums = 0, lost = 0;
  const synth = (i: Instrument) => i.kind === "analog" || i.kind === "fm" || i.kind === "chip";
  if (!song.instruments.some((i) => synth(i) || i.kind === "drums")) return { song, baked, drums, lost };
  const instruments = song.instruments.map((i) => (synth(i) ? (baked++, bakeSynth(i)) : i));
  // the kits: (instrument, drum) → the new instrument's number (1-based)
  const slot = new Map<string, number>();
  const kitOf = (n: number) => song.instruments[n - 1]?.kind === "drums";
  const blocks = song.blocks.map((b) => {
    const last: number[] = []; // the instrument each track plays (a note without one keeps it)
    return {
      ...b,
      cells: b.cells.map((row) =>
        row.map((c, t) => {
          if (c.inst) last[t] = c.inst;
          const inst = c.inst || last[t];
          if (!c.note || c.note > 120 || !inst || !kitOf(inst)) return c;
          const ins = song.instruments[inst - 1];
          // the note's place in the octave, as the replayer plays it (the instrument's and song's transposes)
          const drum = (((c.note - 1 + ins.transpose + song.transpose) % 12) + 12) % 12;
          const key = `${inst}:${drum}`;
          let n = slot.get(key);
          if (n === undefined) {
            // a free slot first (a .mod has 31), else after the last
            const free = instruments.findIndex((x) => x.kind === "empty");
            n = (free >= 0 ? free : instruments.length) + 1;
            if (n > 63) return lost++, { ...c, note: 0, inst: 0 };
            instruments[n - 1] = bakeDrum(ins, drum);
            slot.set(key, n);
            drums++;
          }
          // C-3: the sample as it was made (its transpose of 12 and the song's are taken back)
          return { ...c, note: Math.max(1, Math.min(120, 25 - song.transpose)), inst: n };
        }),
      ),
    };
  });
  return { song: { ...song, instruments, blocks }, baked, drums, lost };
}
