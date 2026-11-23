import { describe, expect, it } from "vitest";
import { readBmed, writeBmed } from "../src/format/bmed";
import { Strummed } from "../src/render";
import { songLength } from "../src/replayer";
import { Editor } from "../src/edit";
import { invertChord, newSong, swingFactor } from "../src/song";
import { TEMPLATE_TRACKS, templateSong } from "../src/template";
import type { Voice } from "../src/dsp/voice";

/** write a song as .bmed, read it back */
async function roundTrip(s: ReturnType<typeof newSong>) {
  const files = writeBmed(s);
  return readBmed(files[0].data as string, async (p) => files.find((f) => f.path === p)!.data as Uint8Array);
}

describe("BreakerMED beta: the new-song template", () => {
  it("has 8 named tracks, its own instruments and a bar that plays", () => {
    const s = templateSong();
    expect(s.tracks).toBe(8);
    expect(s.trackNames).toEqual(TEMPLATE_TRACKS);
    expect(s.instruments.map((i) => i.kind)).toEqual(["drums", "analog", "analog", "analog", "fm"]);
    expect(s.chordColumn).toBe(true);
    const b = s.blocks[0];
    expect(b.cells[0][0]).toMatchObject({ note: 25, inst: 1 }); // C-3 kick
    expect(b.cells[16][0]).toMatchObject({ note: 25, inst: 1 }); // the bar again
    expect(b.cells[0][6].chord).toBe(2);
    expect(songLength(s).seconds).toBeGreaterThan(5);
  });
  it("takes 1 to 16 tracks", () => {
    expect(templateSong(4).trackNames).toEqual(["kick", "snare", "hats", "bass"]);
    expect(templateSong(12).trackNames[11]).toBe("");
    expect(templateSong(40).tracks).toBe(16);
  });
});

describe("BreakerMED beta: swing", () => {
  it("lengthens even lines and shortens odd ones, a pair unchanged", () => {
    expect(swingFactor(undefined, 0)).toBe(1);
    expect(swingFactor(100, 0) / swingFactor(100, 1)).toBeCloseTo(2);
    for (const sw of [0, 30, 75, 100]) expect(swingFactor(sw, 0) + swingFactor(sw, 1)).toBeCloseTo(2);
  });
  it("leaves the song's length alone (lines come in pairs) and is saved", async () => {
    const s = templateSong();
    const straight = songLength(s).seconds;
    s.swing = 60;
    expect(songLength(s).seconds).toBeCloseTo(straight, 3);
    expect((await roundTrip(s)).swing).toBe(60);
  });
});

describe("BreakerMED beta: chords turned over and strummed", () => {
  it("inverts a chord around the written note", () => {
    expect(invertChord([4, 7], 1)).toEqual([-8, -5]);
    expect(invertChord([4, 7], 2)).toEqual([-5, 4]);
    expect(invertChord([4, 7], 3)).toEqual([4, 7]);
    expect(invertChord([3, 7, 10], 1)).toEqual([-9, -5, -2]);
  });
  it("keeps a track's strum, undoably, and saves it", async () => {
    const s = newSong(4);
    const e = new Editor(s);
    e.setTrack(2, { strum: 30 });
    expect(s.trackStrum).toEqual([0, 0, 30, 0]);
    e.setTrack(2, { strum: 999 });
    expect(s.trackStrum![2]).toBe(200);
    expect((await roundTrip(s)).trackStrum).toEqual([0, 0, 200, 0]);
    e.undo();
    e.undo();
    expect(s.trackStrum).toBeUndefined();
  });
  it("a strummed note waits, then plays; let go before, it's never heard", () => {
    let rendered: [number, number] | null = null;
    let stopped = false;
    const inner: Voice = { on: true, start() {}, set() {}, stop: () => void (stopped = true), render: (_l, _r, from, to) => void (rendered = [from, to]) };
    const v = new Strummed(inner, 100);
    const l = new Float32Array(256), r = new Float32Array(256);
    v.render(l, r, 0, 64);
    expect(rendered).toBeNull();
    v.render(l, r, 64, 128);
    expect(rendered).toEqual([100, 128]);
    const w = new Strummed(inner, 500);
    w.stop();
    expect(stopped && !w.on).toBe(true);
  });
});

import { exportLine, fixChoices, newExportChoices } from "../src/screens";

describe("BreakerMED beta: the EXPORT screen's command line", () => {
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  it("writes only what isn't the default", () => {
    const x = { ...newExportChoices(), path: "songs/my song" };
    expect(exportLine(x, q)).toBe('med export "songs/my song.wav"'); // 0.12: master only by default (R13)
    x.what = "master";
    x.format = "flac";
    x.bits = 24;
    x.rate = 44100;
    expect(exportLine(x, q)).toBe('med export "songs/my song.flac" --rate 44100 --bits 24');
  });
  it("keeps the choices possible for each format", () => {
    const x = { ...newExportChoices(), path: "a", format: "flac" as const, bits: 32 as const, rate: 96000 };
    fixChoices(x);
    expect(x.bits).toBe(24);
    const m = { ...x, format: "mp3" as const };
    fixChoices(m);
    expect(m.rate).toBe(48000);
    expect(m.quality).toBe("v0");
    const o = { ...newExportChoices(), path: "a", format: "opus" as const, rate: 44100, what: "stems only" as const, normalize: true, tail: 3 };
    fixChoices(o);
    expect(exportLine(o, q)).toBe("med export a.opus --only-stems --normalize --tail 3");
    const g = { ...newExportChoices(), path: "a.wav", format: "ogg" as const, quality: "q8", what: "master" as const };
    expect(exportLine(g, q)).toBe("med export a.ogg --quality q8");
  });
});

describe("BreakerMED beta: an export never goes to a nameless file", () => {
  it("falls back to songs/untitled", () => {
    expect(exportLine({ ...newExportChoices(), path: "", what: "master" }, (s) => s)).toBe("med export songs/untitled.wav");
  });
});
