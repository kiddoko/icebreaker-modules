import { describe, expect, it } from "vitest";
import { C3_RATE } from "../src/dsp/analog";
import { CHIP_PRESETS, CHIP_WAVES, CHIPS, chipHz, chipVolume, chipPreset, chipPresetsFor, ChipVoice, noiseHz, parseTable, sanitizeChip, snapDuty, tableOf } from "../src/dsp/chip";
import { withSynthsBaked } from "../src/dsp/bake";
import { readBmed, writeBmed } from "../src/format/bmed";
import { songLength } from "../src/replayer";
import { Renderer } from "../src/render";
import { emptyInstrument, newSong, type Instrument } from "../src/song";
import { chipSong, CHIP_TRACKS } from "../src/template";

const SR = 48000;
function play(ins: Instrument, seconds = 0.3, rate = C3_RATE): Float32Array {
  const v = new ChipVoice(SR);
  v.start({ instrument: ins, rate, offset: 0 });
  v.set(rate, 1, 0);
  const n = Math.round(SR * seconds);
  const l = new Float32Array(n), r = new Float32Array(n);
  v.render(l, r, 0, n);
  return l;
}
const chipIns = (preset: string): Instrument => ({ ...emptyInstrument(), kind: "chip", name: preset, chip: chipPreset(preset) });
const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe("CHIP: the sound chips", () => {
  it("every preset sounds, and stays within bounds", () => {
    for (const name of Object.keys(CHIP_PRESETS)) {
      const out = play(chipIns(name), 0.12);
      expect(out.every(Number.isFinite), name).toBe(true);
      expect(peak(out), name).toBeGreaterThan(0.01);
      expect(peak(out), name).toBeLessThan(10 ** (chipPreset(name).level / 20)); // full volume, its level on top
    }
  });
  it("every chip plays every wave", () => {
    for (const chip of CHIPS)
      for (const wave of CHIP_WAVES) {
        const ins = chipIns("2a03-square");
        Object.assign(ins.chip!, { chip, wave });
        expect(peak(play(ins, 0.05)), `${chip} ${wave}`).toBeGreaterThan(0.01);
      }
  });
  it("snaps the pitch to each chip's grid", () => {
    expect(chipHz("2a03", "pulse", 440)).toBeCloseTo(1789773 / (16 * 254), 3); // the NES's A4: 440.4 Hz
    expect(chipHz("2a03", "triangle", 440)).toBeCloseTo(1789773 / (32 * 127), 3);
    expect(chipHz("dmg", "pulse", 440)).toBeCloseTo(131072 / 298, 3);
    expect(Math.abs(chipHz("sid", "saw", 440) - 440)).toBeLessThan(0.06);
    expect(chipHz("psg", "pulse", 8000)).toBe(3579545 / (32 * 14)); // high notes go out of tune, like the chip
    expect(chipHz("2a03", "pulse", 1)).toBe(1789773 / (16 * 2048)); // the lowest it can
    expect(noiseHz("2a03", 261)).toBe(1789773 / 380);
  });
  it("gives the 2A03 and the Game Boy their four pulse widths", () => {
    expect(snapDuty("2a03", 0.3)).toBe(0.25);
    expect(snapDuty("dmg", 0.1)).toBe(0.125);
    expect(snapDuty("sid", 0.3)).toBe(0.3);
  });
  it("keeps the volume to 16 steps (and the SID's to 256)", () => {
    const levels = (chip: "2a03" | "sid") => new Set(Array.from({ length: 1001 }, (_, i) => chipVolume(chip, i / 1000))).size;
    expect(levels("2a03")).toBe(16);
    expect(levels("sid")).toBe(256);
  });
  it("a kick sweeps down and ends by itself", () => {
    const out = play(chipIns("2a03-kick"), 0.5);
    expect(peak(out.subarray(0, 2000))).toBeGreaterThan(0.05);
    expect(peak(out.subarray(out.length - 2000))).toBe(0);
  });
  it("reads its own wavetables", () => {
    expect(parseTable("0123456789ABCDEFFEDCBA9876543210")?.[15]).toBe(31);
    expect(parseTable("0123")).toBeNull();
    expect(parseTable("0123456789abcdefghijklmnopqrstuv")?.[31]).toBe(31);
    const p = sanitizeChip({ table: "custom", custom: Array(32).fill(5) });
    expect(tableOf(p)).toEqual(Array(32).fill(5));
    expect(sanitizeChip({ custom: [99] }).custom).toBeUndefined();
    expect(chipPresetsFor("sid").every((n) => n.startsWith("sid-"))).toBe(true);
  });
});

describe("CHIP in the song", () => {
  it("plays a chord as an arpeggio when its arp is on, stacked when it's off", () => {
    const render = (arp: number) => {
      const s = newSong(1);
      s.instruments = [chipIns("2a03-square")];
      s.instruments[0].chip!.arp = arp;
      Object.assign(s.blocks[0].cells[0][0], { note: 25, inst: 1, chord: 1 });
      const r = new Renderer(s, SR);
      r.play(0, 0);
      const l = new Float32Array(SR / 4), rr = new Float32Array(SR / 4);
      r.render(l, rr);
      return l;
    };
    const arp = render(50), stacked = render(0);
    expect(peak(arp)).toBeGreaterThan(0.01);
    // stacked, three voices share the level; arpeggiated, one note at a time: a different sound
    let diff = 0;
    for (let i = 0; i < arp.length; i++) diff += Math.abs(arp[i] - stacked[i]);
    expect(diff / arp.length).toBeGreaterThan(0.01);
  });
  it("is saved in .bmed with its own wavetable, and baked for .mod", async () => {
    const s = newSong(2);
    s.instruments = [chipIns("sid-sync-lead"), chipIns("dmg-wave-bass")];
    s.instruments[1].chip!.custom = Array.from({ length: 32 }, (_, i) => i);
    s.instruments[1].chip!.table = "custom";
    const files = writeBmed(s);
    const back = await readBmed(files[0].data as string, async () => new Uint8Array(0));
    expect(back.instruments[0].kind).toBe("chip");
    expect(back.instruments[0].chip!.sync).toBe(2.5);
    expect(back.instruments[1].chip!.custom![31]).toBe(31);
    const baked = withSynthsBaked(s);
    expect(baked.baked).toBe(2);
    expect(baked.song.instruments[0].kind).toBe("sample");
    expect(baked.song.instruments[0].data.length).toBeGreaterThan(1000);
  });
  it("the chiptune template: 4 NES-style tracks that play", () => {
    const s = chipSong();
    expect(s.trackNames).toEqual(CHIP_TRACKS);
    expect(s.instruments.every((i) => i.kind === "chip")).toBe(true);
    expect(s.blocks[0].cells[0][1].chord).toBe(2);
    expect(songLength(s).seconds).toBeGreaterThan(3);
    const r = new Renderer(s, SR);
    r.play(0, 0);
    const l = new Float32Array(SR), rr = new Float32Array(SR);
    r.render(l, rr);
    expect(peak(l)).toBeGreaterThan(0.05);
    expect(l.every(Number.isFinite)).toBe(true);
  });
});
