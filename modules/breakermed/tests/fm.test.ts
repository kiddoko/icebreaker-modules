import { describe, expect, it } from "vitest";
import { C3_RATE } from "../src/dsp/analog";
import { FmVoice, findFm, fmPreset, nudgeFm, sanitizeFm, setFm } from "../src/dsp/fm";
import { bakeSynth } from "../src/dsp/bake";
import { Editor } from "../src/edit";
import { readSong } from "../src/format";
import { readBmed, writeBmed } from "../src/format/bmed";
import { writeMod } from "../src/format/write";
import { Renderer } from "../src/render";
import { emptyCell, emptyInstrument, NOTE_OFF, newSong, type Instrument } from "../src/song";
import { synthOf } from "../src/synths";

const RATE = 48000;
const fm = (preset?: string): Instrument => Object.assign(emptyInstrument(), { kind: "fm" as const, name: "fm", fm: fmPreset(preset) });

function play(ins: Instrument, seconds: number, rate = C3_RATE) {
  const v = new FmVoice(RATE);
  v.start({ instrument: ins, rate, offset: 0 });
  v.set(rate, 1, 0);
  const n = Math.round(seconds * RATE);
  const l = new Float32Array(n), r = new Float32Array(n);
  v.render(l, r, 0, n);
  return { v, l };
}
const crossings = (d: Float32Array) => {
  let n = 0;
  for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) n++;
  return n;
};
const roughness = (d: Float32Array) => {
  let s = 0, e = 0;
  for (let i = 1; i < d.length; i++) (s += (d[i] - d[i - 1]) ** 2), (e += d[i] ** 2);
  return s / Math.max(1e-9, e);
};

describe("BreakerMED: the FM synth", () => {
  it("index 0 is a plain sine at the note (C-3 = 261.6 Hz)", () => {
    const ins = fm("organ");
    ins.fm!.index = 0;
    expect(Math.abs(crossings(play(ins, 1).l) - 262)).toBeLessThanOrEqual(2);
  });

  it("a higher index is brighter; feedback too", () => {
    const soft = fm("organ"), hard = fm("organ"), fb = fm("organ");
    soft.fm!.index = 0.3;
    hard.fm!.index = 6;
    fb.fm!.index = 0.3;
    fb.fm!.feedback = 1;
    expect(roughness(play(hard, 0.3).l)).toBeGreaterThan(roughness(play(soft, 0.3).l) * 4);
    expect(roughness(play(fb, 0.3).l)).toBeGreaterThan(roughness(play(soft, 0.3).l) * 1.5);
  });

  it("a sound with no sustain ends by itself; a held one waits for its release", () => {
    expect(play(fm("pluck"), 1.5).v.on).toBe(false);
    const held = play(fm("organ"), 0.5);
    expect(held.v.on).toBe(true);
    held.v.stop();
    held.v.render(new Float32Array(RATE), new Float32Array(RATE), 0, RATE);
    expect(held.v.on).toBe(false);
  });

  it("settings: found by name, checked; from a file, sanitized", () => {
    const p = fmPreset();
    expect(findFm("index")?.key).toBe("index");
    expect(findFm("mod decay")?.key).toBe("menv.d");
    setFm(p, "ratio", "99");
    expect(p.ratio).toBe(16);
    nudgeFm(p, "ratio", -1);
    expect(p.ratio).toBe(15.75);
    expect(() => setFm(p, "index", "lots")).toThrow();
    const q = sanitizeFm({ ratio: 3, index: "x", menv: { d: -5 } });
    expect([q.ratio, q.index, q.menv.d]).toEqual([3, fmPreset().index, 0]);
    expect(synthOf(fm())?.cmd).toBe("fm");
  });
});

describe("BreakerMED: an FM synth in a song", () => {
  const song = () => {
    const s = newSong(2);
    s.instruments = [fm("epiano")];
    s.blocks[0].cells[0][0] = { ...emptyCell(1), note: 25, inst: 1 };
    s.blocks[0].cells[4][0] = { ...emptyCell(1), note: NOTE_OFF };
    return s;
  };

  it("plays through the renderer", () => {
    const r = new Renderer(song(), RATE);
    r.play(0, 0);
    const l = new Float32Array(RATE / 2), rr = new Float32Array(RATE / 2);
    r.render(l, rr);
    expect(Math.max(...l.map(Math.abs))).toBeGreaterThan(0.05);
  });

  it(".bmed keeps it, .mod bakes it, the editor undoes it", async () => {
    const s = song();
    s.instruments[0].fm!.ratio = 2.5;
    const back = await readBmed(writeBmed(s)[0].data as string, async () => new Uint8Array(0));
    expect([back.instruments[0].kind, back.instruments[0].fm!.ratio]).toEqual(["fm", 2.5]);
    const mod = writeMod(s);
    expect(mod.warnings.some((w) => w.includes("1 synth(s)"))).toBe(true);
    expect(readSong(mod.bytes, "x.mod").instruments[0].data.length).toBeGreaterThan(1000);
    expect(bakeSynth(s.instruments[0]).data.length).toBeGreaterThan(1000);
    const e = new Editor(s);
    e.instrument(0, "index", (i) => setFm(i.fm!, "index", "7"));
    expect(s.instruments[0].kind).toBe("fm");
    e.undo();
    expect(s.instruments[0].fm!.index).toBe(fmPreset("epiano").index);
  });
});
