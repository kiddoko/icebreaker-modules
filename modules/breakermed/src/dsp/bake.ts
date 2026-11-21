/**
 * breakerMED — a synth turned into a sample, for the files other trackers read
 * (.mod, .med hold samples only): middle C held for a while, then released.
 */
import { emptyInstrument, type Instrument, type Song } from "../song";
import { HQ_RATE } from "../sampler";
import { AnalogVoice, C3_RATE } from "./analog";

/** The synth's sound at C-3: held `hold` seconds, then its release (2 s at most). */
export function bakeSynth(ins: Instrument, hold = 0.8): Instrument {
  const v = new AnalogVoice(HQ_RATE);
  v.start({ instrument: ins, rate: C3_RATE, offset: 0 });
  v.set(C3_RATE, 1, 0);
  const max = Math.round(HQ_RATE * (hold + 2));
  const l = new Float32Array(max), r = new Float32Array(max);
  const held = Math.round(HQ_RATE * hold);
  v.render(l, r, 0, held);
  v.stop();
  v.render(l, r, held, max);
  let end = max;
  while (end > held && Math.abs(l[end - 1]) < 1e-4) end--;
  const out = emptyInstrument();
  Object.assign(out, { name: ins.name, volume: ins.volume, gain: ins.gain, finetune: 0, transpose: ins.transpose + 12, kind: "sample" });
  // a voice plays at half loudness: twice, so the sample is as loud as the synth
  out.data = l.slice(0, end).map((x) => Math.max(-1, Math.min(1, x * 2)));
  return out;
}

/** The song with every synth as a sample (the song itself isn't changed), and how many there were. */
export function withSynthsBaked(song: Song): { song: Song; baked: number } {
  let baked = 0;
  const instruments = song.instruments.map((i) => (i.kind === "analog" ? (baked++, bakeSynth(i)) : i));
  return { song: baked ? { ...song, instruments } : song, baked };
}
