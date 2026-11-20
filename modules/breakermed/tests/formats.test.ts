import { describe, expect, it } from "vitest";
import { demoMod } from "../src/demo";
import { Editor } from "../src/edit";
import { readSong } from "../src/format";
import { readBmed, writeBmed } from "../src/format/bmed";
import { readWav, writeWav } from "../src/format/wav";
import { writeMed, writeMod } from "../src/format/write";
import { songLength } from "../src/replayer";
import { newSong, NOTE_OFF, type Song } from "../src/song";

const cellsOf = (s: Song) => s.blocks.map((b) => b.cells.map((row) => row.map((c) => [c.note, c.inst, c.cmd.join(","), c.val.join(",")].join(" "))));

describe("breakerMED: WAV", () => {
  it("16, 24 bits and 32-bit float come back (within their precision)", () => {
    const ch = [Float32Array.from([0, 0.5, -0.5, 1, -1]), Float32Array.from([0.25, -0.25, 0, 0.1, -0.1])];
    for (const bits of [16, 24, 32] as const) {
      const back = readWav(writeWav({ rate: 44100, channels: ch }, bits))!;
      expect(back.rate).toBe(44100);
      expect(back.channels.length).toBe(2);
      const tol = bits === 16 ? 1e-4 : bits === 24 ? 1e-6 : 0;
      ch.forEach((c, k) => c.forEach((x, i) => expect(Math.abs(back.channels[k][i] - x)).toBeLessThanOrEqual(tol + 1e-7)));
    }
    expect(readWav(new Uint8Array(40))).toBe(null);
  });
});

describe("breakerMED: our format (.bmed)", () => {
  it("keeps the tracks, their names, the cells, the instruments", async () => {
    const song = newSong(8);
    song.instruments = readSong(demoMod()).instruments;
    song.title = "test";
    const e = new Editor(song);
    e.writeNote(0, 0, 0, 25, 1);
    e.writeNote(0, 1, 7, NOTE_OFF);
    e.writeHex(0, 0, 0, 3, 0);
    e.writeHex(0, 0, 0, 4, 0xc);
    e.writeHex(0, 0, 0, 5, 2);
    e.setTrack(2, { name: "kick", volume: 40, pan: 0.25 });
    e.setLines(0, 32);
    const files = writeBmed(song);
    expect(files[0].path).toBe("song.json");
    const json = files[0].data as string;
    expect(json).toContain("C-3 01 0C20");
    const byPath = new Map(files.map((f) => [f.path, f.data]));
    const back = await readBmed(json, async (p) => byPath.get(p) as Uint8Array);
    expect(back.tracks).toBe(8);
    expect(back.trackNames[2]).toBe("kick");
    expect([back.trackVolume[2], back.trackPan[2]]).toEqual([40, 0.25]);
    expect(back.blocks[0].lines).toBe(32);
    expect(cellsOf(back)).toEqual(cellsOf(song));
    expect(back.instruments.map((i) => i.name)).toEqual(song.instruments.map((i) => i.name));
    back.instruments.forEach((ins, k) => {
      expect(ins.data.length).toBe(song.instruments[k].data.length);
      expect(ins.loopLength).toBe(song.instruments[k].loopLength);
      ins.data.forEach((x, i) => expect(Math.abs(x - song.instruments[k].data[i])).toBeLessThan(1e-3));
    });
  });

  it("refuses what isn't one of its songs, or one from a newer breakerMED", async () => {
    await expect(readBmed("{nope", async () => new Uint8Array())).rejects.toThrow(/JSON/);
    await expect(readBmed('{"title":"x"}', async () => new Uint8Array())).rejects.toThrow(/breakerMED/);
    await expect(readBmed('{"breakermed":99}', async () => new Uint8Array())).rejects.toThrow(/newer/);
  });
});

describe("breakerMED: writing .mod and .med", () => {
  it(".mod: the demo comes back the same, and lasts as long", () => {
    const demo = readSong(demoMod());
    const { bytes, warnings } = writeMod(demo);
    expect(warnings).toEqual([]);
    const back = readSong(bytes, "x.mod");
    expect(cellsOf(back)).toEqual(cellsOf(demo));
    expect(back.sequence).toEqual(demo.sequence);
    expect(back.instruments.map((i) => [i.name, i.data.length, i.loopLength, i.volume])).toEqual(demo.instruments.map((i) => [i.name, i.data.length, i.loopLength, i.volume]));
    expect(songLength(back).seconds).toBeCloseTo(songLength(demo).seconds, 3);
  });

  it(".mod from an 8-track song: says what ProTracker can't, keeps the notes", () => {
    const song = newSong(8);
    song.instruments = readSong(demoMod()).instruments;
    const e = new Editor(song);
    e.writeNote(0, 0, 5, 13, 2);
    e.setLines(0, 16);
    const { bytes, warnings } = writeMod(song);
    expect(warnings.join(" ")).toMatch(/8 tracks/);
    const back = readSong(bytes, "x.mod");
    expect(back.tracks).toBe(8);
    expect(back.blocks[0].cells[0][5].note).toBe(13);
    expect(songLength(back).lines).toBe(16); // a break on the block's last line
  });

  it(".med (MMD1): cells, pages, names, instruments, tempo come back", () => {
    const song = newSong(6);
    song.instruments = readSong(demoMod()).instruments;
    song.instruments[0].finetune = -3;
    song.instruments[1].hold = 4;
    song.title = "med test";
    song.blocks[0].name = "intro";
    song.tempo = 140;
    song.lpb = 4;
    const e = new Editor(song);
    e.writeNote(0, 0, 0, 25, 1);
    e.writeNote(0, 2, 5, NOTE_OFF);
    [0, 0xc, 4, 0].forEach((d, i) => e.writeHex(0, 0, 0, 3 + i, d));
    const { bytes, warnings } = writeMed(song);
    expect(warnings).toEqual([]);
    const back = readSong(bytes, "x.med");
    expect(back.format).toBe("MMD1");
    expect(back.title).toBe("med test");
    expect(back.tracks).toBe(6);
    expect(back.blocks[0].name).toBe("intro");
    expect(cellsOf(back)).toEqual(cellsOf(song));
    expect([back.tempoMode, back.tempo, back.lpb, back.speed]).toEqual(["bpm", 140, 4, 6]);
    expect(back.instruments.map((i) => [i.name, i.data.length, i.loopLength, i.finetune, i.hold])).toEqual(song.instruments.map((i) => [i.name, i.data.length, i.loopLength, i.finetune, i.hold]));
  });

  it(".med from the demo .mod: ProTracker's tempo becomes BPM mode, same length", () => {
    const demo = readSong(demoMod());
    const back = readSong(writeMed(demo).bytes, "x.med");
    expect(back.tempoMode).toBe("bpm");
    expect(back.flags.ptSlides).toBe(true);
    expect(songLength(back).seconds).toBeCloseTo(songLength(demo).seconds, 2);
  });
});
