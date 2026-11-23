/**
 * BreakerMED — the sound pack's placeholders: until a musician records a sound of
 * the pack (SOUND_DESIGN.md), `med pack load` and the sampler give a computed
 * stand-in, made from our own synths and drum machine, so the pack is never empty.
 * Each is named "… (placeholder)"; the real recording, once in songs/sound-pack/,
 * takes its place.
 */
import { bakeDrum, bakeSynth } from "./dsp/bake";
import { drumKit } from "./dsp/drums";
import { HQ_RATE } from "./sampler";
import { SYNTHS } from "./synths";
import { emptyInstrument, type Instrument } from "./song";
import type { PackSound } from "./pack";

/** a kit's drum: [kit, drum number (0 kick … 11 ride)] */
const DRUM: Record<string, [string, number]> = {
  "kick-acoustic": ["punch", 0],
  "snare-acoustic": ["punch", 2],
  "hat-closed": ["tight", 4],
  "hat-open": ["classic", 6],
  ride: ["classic", 11],
  crash: ["classic", 10],
  "tom-low": ["boom", 5],
  "tom-high": ["boom", 9],
  clap: ["house", 3],
  shaker: ["minimal", 4],
  tambourine: ["tribal", 6],
  impact: ["boom", 10],
};
/** a synth's preset: [kind, preset, octave down?] */
const SYNTH: Record<string, ["analog" | "fm", string, boolean?]> = {
  "piano-c3": ["fm", "epiano"],
  "epiano-c3": ["fm", "ym-epiano"],
  "organ-c3": ["fm", "organ"],
  "bass-electric-c2": ["analog", "bass", true],
  "bass-upright-c2": ["fm", "bass", true],
  "guitar-clean-c3": ["analog", "pluck"],
  "guitar-muted-c3": ["fm", "pluck"],
  "strings-c3": ["analog", "pad"],
  "vox-ah-c3": ["analog", "brass"],
  "vox-oh-c3": ["analog", "sine"],
  "vox-hey": ["fm", "brass"],
};

const nameOf = (p: PackSound) => p.file.split("/").pop()!.replace(/\.wav$/, "");

/** a little noise generator, the same every time (no Math.random: a placeholder is the same sound each load) */
function noise(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), ((x >>> 0) / 4294967296) * 2 - 1);
}

/** the sounds no synth makes: crackle, a riser */
function texture(kind: "crackle" | "riser"): Float32Array {
  const rnd = noise(kind === "crackle" ? 7 : 11);
  const n = Math.round(HQ_RATE * (kind === "crackle" ? 2 : 3));
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if (kind === "crackle") {
      // a soft hiss and, now and then, a click
      lp += (rnd() - lp) * 0.05;
      out[i] = lp * 0.15 + (rnd() > 0.9993 ? rnd() * 0.8 : 0);
    } else {
      // noise through a filter that opens, louder as it rises, then cut
      const k = 0.005 + t * t * 0.5;
      lp += (rnd() - lp) * k;
      out[i] = lp * Math.min(1, t * 1.4) * 0.9 * (t > 0.97 ? (1 - t) / 0.03 : 1);
    }
  }
  return out;
}

/** a sample for a sound of the pack nobody has recorded yet */
export function placeholderFor(p: PackSound): Instrument {
  const id = nameOf(p);
  let ins: Instrument;
  if (DRUM[id]) {
    const [kit, drum] = DRUM[id];
    ins = bakeDrum({ ...emptyInstrument(), kind: "drums", name: kit, drums: drumKit(kit) }, drum);
  } else if (SYNTH[id]) {
    const [kind, preset, low] = SYNTH[id];
    const sk = SYNTHS.find((s) => s.kind === kind)!;
    const src: Instrument = { ...emptyInstrument(), kind, name: preset, transpose: low ? -12 : 0 };
    (src as unknown as Record<string, object>)[sk.field] = sk.preset(preset);
    ins = bakeSynth(src, p.loop ? 1.6 : id === "vox-hey" ? 0.25 : 0.8);
  } else ins = { ...emptyInstrument(), kind: "sample", data: texture(id.includes("crackle") ? "crackle" : "riser"), transpose: 12 };
  // full scale, minus a little: a placeholder is about as loud as a recorded sound would be
  let peak = 0;
  for (const x of ins.data) peak = Math.max(peak, Math.abs(x));
  if (peak > 0) ins.data = ins.data.map((x) => (x / peak) * 0.89);
  if (p.loop) {
    // a held sound: loop the middle of what's held (after the attack, before the release)
    const a = Math.round(HQ_RATE * 0.5), b = Math.round(HQ_RATE * 1.4);
    if (ins.data.length > b) (ins.loopStart = a), (ins.loopLength = b - a);
    else (ins.loopStart = 0), (ins.loopLength = ins.data.length);
  }
  ins.kind = "sample";
  ins.name = `${id} (placeholder)`;
  return ins;
}
