import { describe, expect, it } from "vitest";
import { AnalogVoice, analogPreset, C3_RATE, findParam, getParam, nudgeParam, sanitizeAnalog, setParam } from "../src/dsp/analog";
import { bakeSynth } from "../src/dsp/bake";
import { Editor } from "../src/edit";
import { readSong } from "../src/format";
import { readBmed, writeBmed } from "../src/format/bmed";
import { writeMod } from "../src/format/write";
import { Renderer } from "../src/render";
import { emptyCell, emptyInstrument, NOTE_OFF, newSong, type Instrument } from "../src/song";

const RATE = 48000;
const synth = (preset?: string): Instrument => Object.assign(emptyInstrument(), { kind: "analog" as const, name: "syn", synth: analogPreset(preset) });

function voice(ins: Instrument, seconds: number, rate = C3_RATE) {
  const v = new AnalogVoice(RATE);
  v.start({ instrument: ins, rate, offset: 0 });
  v.set(rate, 1, 0);
  const n = Math.round(seconds * RATE);
  const l = new Float32Array(n), r = new Float32Array(n);
  v.render(l, r, 0, n);
  return { v, l, r };
}

const crossings = (d: Float32Array) => {
  let n = 0;
  for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) n++;
  return n;
};

/** how much the sound moves from one frame to the next (its top end) */
const roughness = (d: Float32Array) => {
  let s = 0, e = 0;
  for (let i = 1; i < d.length; i++) (s += (d[i] - d[i - 1]) ** 2), (e += d[i] ** 2);
  return s / Math.max(1e-9, e);
};

describe("BreakerMED: the analog synth", () => {
  it("C-3 is middle C (261.6 Hz); an octave up is twice that", () => {
    const one = voice(synth("sine"), 1).l;
    expect(Math.abs(crossings(one) - 262)).toBeLessThanOrEqual(2);
    const up = voice(synth("sine"), 1, C3_RATE * 2).l;
    expect(Math.abs(crossings(up) - 523)).toBeLessThanOrEqual(3);
  });

  it("the filter: a low cutoff takes the top off a saw", () => {
    const open = synth(), shut = synth();
    open.synth!.filter = { ...open.synth!.filter, cutoff: 12000, env: 0 };
    shut.synth!.filter = { ...shut.synth!.filter, cutoff: 300, env: 0 };
    expect(roughness(voice(shut, 0.3).l)).toBeLessThan(roughness(voice(open, 0.3).l) * 0.2);
  });

  it("the key up starts the release; the voice ends when silent", () => {
    const ins = synth();
    ins.synth!.amp = { a: 0.001, d: 0.05, s: 0.8, r: 0.1 };
    const { v } = voice(ins, 0.2);
    expect(v.on).toBe(true);
    v.stop();
    const l = new Float32Array(RATE * 0.05), r = new Float32Array(RATE * 0.05);
    v.render(l, r, 0, l.length);
    expect(v.on).toBe(true); // still releasing
    expect(Math.max(...l.map(Math.abs))).toBeGreaterThan(0.01);
    v.render(new Float32Array(RATE * 0.1), new Float32Array(RATE * 0.1), 0, RATE * 0.1);
    expect(v.on).toBe(false);
  });

  it("settings: by name, checked, clamped, stepped", () => {
    const p = analogPreset();
    expect(findParam("cutoff")?.key).toBe("filter.cutoff");
    expect(findParam("reso")?.key).toBe("filter.reso");
    setParam(p, "filter.cutoff", "1.5k");
    expect(p.filter.cutoff).toBe(1500);
    setParam(p, "filter.cutoff", "99999");
    expect(p.filter.cutoff).toBe(20000);
    expect(() => setParam(p, "osc1.wave", "banana")).toThrow();
    setParam(p, "filter.slope", "24");
    expect(p.filter.slope).toBe(24);
    nudgeParam(p, "osc1.wave", 1);
    expect(getParam(p, "osc1.wave")).toBe("square");
    nudgeParam(p, "amp.s", -1);
    expect(p.amp.s).toBeCloseTo(0.75);
    // from a file: nonsense becomes the default, the rest is kept
    const q = sanitizeAnalog({ filter: { cutoff: 900, reso: "loud" }, osc1: { wave: "evil" }, glide: 1e9 });
    expect([q.filter.cutoff, q.filter.reso, q.osc1.wave, q.glide]).toEqual([900, analogPreset().filter.reso, "saw", 2]);
  });
});

describe("BreakerMED: a synth in a song", () => {
  const song = () => {
    const s = newSong(2);
    s.instruments = [synth("pad")];
    const cells = s.blocks[0].cells;
    cells[0][0] = { ...emptyCell(1), note: 25, inst: 1 };
    cells[2][0] = { ...emptyCell(1), note: NOTE_OFF };
    return s;
  };

  it("plays, and rings on after the note off (its release)", () => {
    const s = song();
    const r = new Renderer(s, RATE);
    r.play(0, 0);
    const l = new Float32Array(RATE), rr = new Float32Array(RATE);
    r.render(l, rr);
    expect(Math.max(...l.map(Math.abs))).toBeGreaterThan(0.05);
  });

  it("a new note releases the old one instead of cutting it", () => {
    const s = song();
    s.blocks[0].cells[2][0] = { ...emptyCell(1), note: 32, inst: 1 };
    const r = new Renderer(s, RATE);
    r.play(0, 0);
    r.render(new Float32Array(RATE), new Float32Array(RATE));
    expect((r as unknown as { tails: unknown[] }).tails.length).toBe(1);
  });

  it(".bmed keeps the settings; .mod gets a sample of it (with a warning)", async () => {
    const s = song();
    s.instruments[0].synth!.filter.cutoff = 777;
    const files = writeBmed(s);
    const back = await readBmed(files[0].data as string, async () => new Uint8Array(0));
    expect(back.instruments[0].kind).toBe("analog");
    expect(back.instruments[0].synth!.filter.cutoff).toBe(777);
    const mod = writeMod(s);
    expect(mod.warnings.some((w) => w.includes("synth"))).toBe(true);
    const m = readSong(mod.bytes, "x.mod");
    expect(m.instruments[0].kind).toBe("sample");
    expect(m.instruments[0].data.length).toBeGreaterThan(1000);
    expect(s.instruments[0].kind).toBe("analog"); // the song itself isn't changed
  });

  it("bake: a sample of C-3, about as loud as the synth", () => {
    const b = bakeSynth(synth("bass"));
    expect(b.kind).toBe("sample");
    expect(b.transpose).toBe(12);
    expect(Math.max(...b.data.map(Math.abs))).toBeGreaterThan(0.2);
  });

  it("the editor: a synth stays a synth; ⌘Z brings the old setting back", () => {
    const s = song();
    const e = new Editor(s);
    e.instrument(0, "cutoff", (i) => setParam(i.synth!, "filter.cutoff", "500"));
    expect(s.instruments[0].kind).toBe("analog");
    expect(s.instruments[0].synth!.filter.cutoff).toBe(500);
    e.undo();
    expect(s.instruments[0].synth!.filter.cutoff).toBe(analogPreset("pad").filter.cutoff);
  });
});
