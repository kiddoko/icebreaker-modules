import { describe, expect, it } from "vitest";
import { C3_RATE } from "../src/dsp/analog";
import { bakeDrum } from "../src/dsp/bake";
import { DRUM_NAMES, DrumVoice, drumKit, drumOf, findDrum, nudgeDrum, sanitizeKit } from "../src/dsp/drums";
import { readSong } from "../src/format";
import { readBmed, writeBmed } from "../src/format/bmed";
import { writeMod } from "../src/format/write";
import { Renderer } from "../src/render";
import { emptyCell, emptyInstrument, newSong, type Instrument } from "../src/song";

const RATE = 48000;
const kit = (name?: string): Instrument => Object.assign(emptyInstrument(), { kind: "drums" as const, name: "drums", drums: drumKit(name) });

function hit(ins: Instrument, drum: number, seconds = 6) {
  const v = new DrumVoice(RATE);
  v.start({ instrument: ins, rate: C3_RATE * 2 ** (drum / 12), offset: 0 });
  v.set(C3_RATE, 1, 0);
  const n = Math.round(seconds * RATE);
  const l = new Float32Array(n), r = new Float32Array(n);
  v.render(l, r, 0, n);
  let peak = 0;
  for (const x of l) peak = Math.max(peak, Math.abs(x));
  return { v, l, peak };
}

describe("breakerMED: the drum machine", () => {
  it("every drum sounds, stays below full scale, and ends by itself", () => {
    DRUM_NAMES.forEach((name, d) => {
      const { v, peak } = hit(kit(), d);
      expect(peak, name).toBeGreaterThan(0.02);
      expect(peak, name).toBeLessThan(1);
      expect(v.on, name).toBe(false);
    });
  });

  it("the drum is the note's place in the octave", () => {
    expect(drumOf(C3_RATE, C3_RATE)).toBe(0);
    expect(drumOf(C3_RATE * 2, C3_RATE)).toBe(0); // C-4: the kick too
    expect(drumOf(C3_RATE * 2 ** (2 / 12), C3_RATE)).toBe(2); // D: the snare
    expect(drumOf(C3_RATE / 2 ** (1 / 12), C3_RATE)).toBe(11); // B-2: the ride
    expect([findDrum("snare"), findDrum("d#"), findDrum("hat"), findDrum("12"), findDrum("nope")]).toEqual([2, 3, -1, 11, -1]);
    expect(findDrum("closed")).toBe(4);
  });

  it("decay makes it longer; grit crushes it to fewer bits", () => {
    const short = kit(), long = kit();
    short.drums!.drums[0].decay = 0.5;
    long.drums!.drums[0].decay = 2;
    const len = (i: Instrument) => {
      const { l } = hit(i, 0);
      let end = l.length;
      while (end > 0 && Math.abs(l[end - 1]) < 1e-3) end--;
      return end;
    };
    expect(len(long)).toBeGreaterThan(len(short) * 2);
    const gritty = kit();
    gritty.drums!.bits = 4;
    const { l } = hit(gritty, 2, 0.1);
    // the voice adds y × 0.5 × volume: the values sit on steps of 1/8 × 0.5
    expect(l.every((x) => Math.abs(x * 16 - Math.round(x * 16)) < 1e-4)).toBe(true);
  });

  it("settings: stepped, clamped; from a file, checked", () => {
    const k = drumKit();
    nudgeDrum(k, 0, "tune", 1);
    expect(k.drums[0].tune).toBe(1);
    for (let i = 0; i < 50; i++) nudgeDrum(k, 0, "level", 1);
    expect(k.drums[0].level).toBe(1);
    const s = sanitizeKit({ drums: [{ tune: 99, decay: "x" }], bits: 0.4, hold: 300 });
    expect([s.drums[0].tune, s.drums[0].decay, s.bits, s.hold]).toEqual([24, drumKit().drums[0].decay, 1, 16]);
    expect(s.drums.length).toBe(12);
  });
});

describe("breakerMED: drums in a song", () => {
  const song = (notes: [number, number][]) => {
    const s = newSong(2);
    s.instruments = [kit()];
    for (const [line, note] of notes) s.blocks[0].cells[line][0] = { ...emptyCell(1), note, inst: 1 };
    return s;
  };
  const tails = (r: Renderer) => (r as unknown as { tails: unknown[] }).tails.length;

  it("a kick rings on under the next hat; a closed hat cuts an open one", () => {
    const r1 = new Renderer(song([[0, 25], [1, 29]]), RATE); // C-3 kick, E-3 closed hat
    r1.play(0, 0);
    r1.render(new Float32Array(RATE / 4), new Float32Array(RATE / 4));
    expect(tails(r1)).toBe(1);
    const r2 = new Renderer(song([[0, 31], [1, 29]]), RATE); // F#3 open hat, then the closed one
    r2.play(0, 0);
    r2.render(new Float32Array(RATE / 4), new Float32Array(RATE / 4));
    expect(tails(r2)).toBe(0);
  });

  it(".bmed keeps the kit; .mod gets a sample a drum, the notes rewritten", async () => {
    const s = song([[0, 25], [2, 27], [4, 37]]); // C-3 kick, D-3 snare, C-4 kick again
    s.instruments[0].drums!.drums[2].tune = 5;
    const back = await readBmed(writeBmed(s)[0].data as string, async () => new Uint8Array(0));
    expect(back.instruments[0].kind).toBe("drums");
    expect(back.instruments[0].drums!.drums[2].tune).toBe(5);
    const mod = writeMod(s);
    expect(mod.warnings.some((w) => w.includes("2 drum(s)"))).toBe(true);
    const m = readSong(mod.bytes, "x.mod");
    const cells = m.blocks[0].cells;
    expect([cells[0][0].inst, cells[2][0].inst, cells[4][0].inst]).toEqual([2, 3, 2]);
    expect(m.instruments[1].data.length).toBeGreaterThan(1000);
    expect(s.blocks[0].cells[0][0].inst).toBe(1); // the song itself isn't changed
  });

  it("bake: one drum as a sample", () => {
    const b = bakeDrum(kit(), 2);
    expect(b.kind).toBe("sample");
    expect(b.name).toContain("snare");
    expect(b.data.length).toBeGreaterThan(1000);
  });
});
