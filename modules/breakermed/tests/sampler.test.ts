import { describe, expect, it } from "vitest";
import { demoMod } from "../src/demo";
import { Editor } from "../src/edit";
import { readSong } from "../src/format";
import { readAiff, writeAiff } from "../src/format/aiff";
import { Writer } from "../src/format/bytes";
import { read8svx } from "../src/format/iff";
import { readSample } from "../src/format/sample";
import { writeWav } from "../src/format/wav";
import { Renderer } from "../src/render";
import { chop, crush, fade, HQ_RATE, normalize, onsets, pitch, resample, reverse, sliceAt, stretch, trim } from "../src/sampler";
import { newSong } from "../src/song";

const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i / n);

describe("BreakerMED: the sampler's tools", () => {
  it("chop: equal slices covering everything; slices at cuts", () => {
    const parts = chop(ramp(10), 3);
    expect(parts.map((p) => p.length)).toEqual([3, 3, 4]);
    expect(sliceAt(ramp(10), [4, 7, 99]).map((p) => p.length)).toEqual([4, 3, 3]);
  });

  it("onsets: finds the attacks after silence", () => {
    const d = new Float32Array(20000);
    for (const at of [0, 8000, 15000]) for (let i = 0; i < 1500; i++) d[at + i] = 0.8 * Math.sin(i / 5) * (1 - i / 1500);
    const o = onsets(d);
    expect(o.length).toBe(3);
    expect(Math.abs(o[1] - 8000)).toBeLessThan(300);
    expect(Math.abs(o[2] - 15000)).toBeLessThan(300);
  });

  it("stretch: the length × the factor, the grains copied as they are (no new values)", () => {
    const d = ramp(4096);
    const long = stretch(d, 2, 256);
    expect(long.length).toBe(8192);
    const values = new Set(d);
    expect(long.every((x) => values.has(x))).toBe(true);
    expect(stretch(d, 0.5, 256).length).toBe(2048);
  });

  it("fade, reverse, pitch, normalize, trim, crush", () => {
    const one = new Float32Array(10).fill(1);
    expect(fade(one, "in")[0]).toBe(0);
    expect(fade(one, "out")[9]).toBe(0);
    expect([...reverse(Float32Array.from([1, 2, 3]))]).toEqual([3, 2, 1]);
    expect(pitch(ramp(1200), 12).length).toBe(600);
    expect(resample(Float32Array.from([0, 1]), 0.5).length).toBe(4);
    expect(Math.max(...normalize(Float32Array.from([0.1, -0.25])))).toBeCloseTo(0.4);
    expect(Math.min(...normalize(Float32Array.from([0.1, -0.25])))).toBeCloseTo(-1);
    const t = trim(Float32Array.from([0, 0, 0.5, 0.2, 0, 0]));
    expect([t.start, ...t.data]).toEqual([2, 0.5, 0.2].map((x) => Math.fround(x)).map((x, i) => (i === 0 ? 2 : x)));
    const c = crush(Float32Array.from([0.3, 0.31, 0.7, 0.71]), 2, 2);
    expect([...c]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe("BreakerMED: reading sounds", () => {
  it("AIFF (16 bits, AIFF-C float) back from our writer", () => {
    const ch = [Float32Array.from([0, 0.5, -0.5, 0.25])];
    for (const bits of [16, 24, 32] as const) {
      const p = readAiff(writeAiff({ rate: 44100, channels: ch }, bits))!;
      expect(p.rate).toBe(44100);
      p.channels[0].forEach((x, i) => expect(Math.abs(x - ch[0][i])).toBeLessThan(1e-4));
    }
  });

  it("IFF 8SVX: name, rate, loop, volume", () => {
    const w = new Writer();
    const body = Array.from({ length: 100 }, (_, i) => (i < 50 ? 64 : -64));
    w.text("FORM", 4).u32(4 + 8 + 20 + 8 + 6 + 8 + body.length).text("8SVX", 4);
    w.text("VHDR", 4).u32(20).u32(60).u32(40).u32(0).u16(16726).u8(1).u8(0).u32(0x8000);
    w.text("NAME", 4).u32(6).text("snare", 6);
    w.text("BODY", 4).u32(body.length);
    for (const b of body) w.u8(b & 255);
    const s = read8svx(w.done())!;
    expect([s.name, s.rate, s.loopStart, s.loopLength, s.volume]).toEqual(["snare", 16726, 60, 40, 32]);
    expect(s.channels[0][0]).toBe(0.5);
  });

  it("an imported sound becomes mono and keeps its own rate (0.13, D4: C-3 plays it as recorded)", async () => {
    const wav = writeWav({ rate: 44100, channels: [new Float32Array(44100).fill(0.5), new Float32Array(44100).fill(-0.5)] }, 16);
    const ins = await readSample(wav, "drums/kick.wav");
    expect(ins.name).toBe("kick");
    expect(ins.transpose).toBe(0);
    expect(ins.rate).toBe(44100);
    expect(ins.data.length).toBe(44100);
    expect((await readSample(wav, "k.wav", undefined, true)).data.length).toBeCloseTo(HQ_RATE / 2, -2);
    expect(Math.abs(ins.data[100])).toBeLessThan(1e-3); // left and right averaged
  });
});

describe("BreakerMED: instruments in the editor", () => {
  it("changes are undoable; new instruments go to free slots", () => {
    const song = newSong(4);
    song.instruments = readSong(demoMod()).instruments;
    const e = new Editor(song);
    const before = song.instruments[0].data;
    e.instrument(0, "reverse", (i) => (i.data = reverse(i.data)));
    expect(song.instruments[0].data).not.toBe(before);
    e.undo();
    expect(song.instruments[0].data).toBe(before);
    const placed = e.addInstruments([{ ...song.instruments[0], name: "a" }, { ...song.instruments[0], name: "b" }]);
    expect(placed).toEqual([4, 5]);
    expect(song.instruments[5].name).toBe("b");
  });

  it("the LED filter softens the top (a square loses its edges)", () => {
    const song = readSong(demoMod());
    const edge = (filter: boolean) => {
      song.flags.filter = filter;
      const r = new Renderer(song, 48000);
      r.play(0, 0);
      const l = new Float32Array(4800), rr = new Float32Array(4800);
      r.render(l, rr);
      let jump = 0;
      for (let i = 1; i < l.length; i++) jump = Math.max(jump, Math.abs(l[i] - l[i - 1]));
      return jump;
    };
    expect(edge(true)).toBeLessThan(edge(false) * 0.6);
  });
});
