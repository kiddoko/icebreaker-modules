import { describe, expect, it } from "vitest";
import { Renderer } from "../src/render";
import { bakeSynth } from "../src/dsp/bake";
import { templateSong } from "../src/template";
import { SYNTHS } from "../src/synths";
import { emptyInstrument, newSong, type Instrument } from "../src/song";

/** one C-3 held on track 1 with `ins`, rendered 1.2 s: RMS (dB) and the mean (DC) */
function play(ins: Instrument) {
  const s = newSong(4);
  s.instruments = [ins];
  s.trackPan = [0, 0, 0, 0];
  const c = s.blocks[0].cells[0][0];
  (c.note = 25), (c.inst = 1);
  const r = new Renderer(s, 48000, false);
  r.play(0, 0);
  const n = 48000;
  const L = new Float32Array(n), R = new Float32Array(n);
  r.render(L, R);
  let sq = 0, sum = 0;
  for (let i = 0; i < n; i++) sq += L[i] * L[i];
  // the offset: over the held part, past the attack (0.2–0.8 s)
  let peak = 0;
  for (let i = 9600; i < 38400; i++) (sum += L[i]), (peak = Math.max(peak, Math.abs(L[i])));
  // as a share of the peak (it was 15–31 % on lead, epiano, ym-lead before 0.12)
  return { db: 10 * Math.log10(sq / n + 1e-12), mean: Math.abs(sum / 28800) / (peak || 1) };
}

const synth = (kind: "analog" | "fm" | "chip", preset: string): Instrument => {
  const sk = SYNTHS.find((x) => x.kind === kind)!;
  const i = { ...emptyInstrument(), kind, name: preset } as Instrument;
  (i as unknown as Record<string, object>)[sk.field] = sk.preset(preset);
  return i;
};

describe("0.12 B10, B9: a synth saved as a sample (.mod, .med) sounds as loud, with no offset", () => {
  for (const [kind, preset] of [["analog", "lead"], ["fm", "epiano"], ["fm", "ym-lead"], ["analog", "bass"]] as const) {
    it(`${kind} ${preset}`, () => {
      const live = play(synth(kind, preset));
      const baked = play(bakeSynth(synth(kind, preset)));
      expect(Math.abs(baked.db - live.db)).toBeLessThan(1);
      expect(live.mean).toBeLessThan(0.005);
      expect(baked.mean).toBeLessThan(0.005);
    });
  }
  it("the template still plays", () => expect(templateSong().instruments.length).toBe(5));
});
