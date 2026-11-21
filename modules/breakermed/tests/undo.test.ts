import { describe, expect, it } from "vitest";
import { Editor, MERGE_MS } from "../src/edit";
import { sameSettings } from "../src/app";
import { chipPreset } from "../src/dsp/chip";
import { drumKit } from "../src/dsp/drums";
import { chipSong, templateSong } from "../src/template";

/** an editor with a clock the test moves */
function editor(song = templateSong()) {
  const e = new Editor(song);
  let t = 1000;
  e.now = () => t;
  return { e, s: song, wait: (ms: number) => (t += ms) };
}

describe("0.10.2: one undo for a run of nudges", () => {
  it("strum nudged step by step is one undo; a pause makes a new one", () => {
    const { e, s, wait } = editor();
    for (let i = 0; i < 6; i++) (e.setTrack(6, { strum: (s.trackStrum?.[6] ?? 0) + 5 }, true), wait(100));
    expect(s.trackStrum?.[6]).toBe(30);
    wait(MERGE_MS + 1);
    e.setTrack(6, { strum: 40 }, true);
    expect(e.undo()).toBe("track");
    expect(s.trackStrum?.[6]).toBe(30);
    e.undo();
    expect(s.trackStrum).toBeUndefined();
    expect(e.canUndo).toBe(false);
    // redo brings both back, in order
    e.redo();
    expect(s.trackStrum?.[6]).toBe(30);
    e.redo();
    expect(s.trackStrum?.[6]).toBe(40);
  });

  it("two different settings, or a plain command, stay two undos", () => {
    const { e, s } = editor();
    e.setTrack(1, { volume: 50 }, true);
    e.setTrack(1, { pan: 0.5 }, true);
    e.setTrack(1, { volume: 40 });
    e.setTrack(1, { volume: 30 });
    e.undo();
    expect(s.trackVolume[1]).toBe(40);
    e.undo();
    expect(s.trackVolume[1]).toBe(50);
    e.undo();
    expect(s.trackPan[1]).not.toBe(0.5);
  });

  it("a synth setting nudged ten times (the arp, the cutoff) is one undo", () => {
    const { e, s } = editor(chipSong());
    const before = structuredClone(s.instruments[1].chip);
    for (let i = 0; i < 10; i++) e.instrument(1, "arpeggio speed", (x) => x.chip && (x.chip.arp = Math.min(16, (x.chip.arp ?? 0) + 1)), true);
    expect(e.undo()).toBe("arpeggio speed");
    expect(s.instruments[1].chip).toEqual(before);
    expect(e.canUndo).toBe(false);
  });

  it("nothing merges across an undo", () => {
    const { e, s } = editor();
    e.settings("tempo", (x) => (x.tempo = 130), true);
    e.undo();
    e.settings("tempo", (x) => (x.tempo = 140), true);
    e.settings("tempo", (x) => (x.tempo = 141), true);
    e.undo();
    expect(s.tempo).toBe(templateSong().tempo);
  });
});

describe("0.10.2: the song's settings and the mutes undo", () => {
  it("tempo, speed, swing, echo, the LED filter, the title", () => {
    const { e, s } = editor();
    const was = { tempo: s.tempo, speed: s.speed, filter: s.flags.filter, title: s.title };
    e.settings("tempo", (x) => (x.tempo = 99));
    e.settings("speed", (x) => (x.speed = 3));
    e.settings("swing", (x) => (x.swing = 50));
    e.settings("echo", (x) => (x.echo = { type: "cross", ms: 300, depth: 3 }));
    e.settings("echo delay", (x) => x.echo && (x.echo.ms = 400));
    e.settings("LED filter", (x) => (x.flags.filter = !x.flags.filter));
    e.settings("title", (x) => (x.title = "night drive"));
    expect(s.echo?.ms).toBe(400);
    for (let i = 0; i < 2; i++) e.undo();
    expect([s.title, s.flags.filter]).toEqual([was.title, was.filter]);
    e.undo();
    expect(s.echo?.ms).toBe(300);
    e.undo();
    expect(s.echo).toBeUndefined();
    e.undo();
    expect(s.swing).toBeUndefined();
    e.undo();
    e.undo();
    expect([s.tempo, s.speed]).toEqual([was.tempo, was.speed]);
    for (let i = 0; i < 7; i++) e.redo();
    expect([s.tempo, s.speed, s.swing, s.echo?.ms, s.title]).toEqual([99, 3, 50, 400, "night drive"]);
  });

  it("an undone echo isn't changed later by a nudge of the one shown", () => {
    const { e, s } = editor();
    e.settings("echo", (x) => (x.echo = { type: "normal", ms: 250, depth: 2 }));
    const shown = s.echo!;
    e.settings("echo delay", (x) => x.echo && (x.echo.ms = 260));
    e.undo();
    shown.ms = 999; // the object a screen held: the history keeps its own copies
    e.redo();
    expect(s.echo?.ms).toBe(260);
  });

  it("a mute undoes, and doesn't mark the song unsaved", () => {
    const { e } = editor();
    const muted = new Set<number>();
    const put = (m: Set<number>) => () => (muted.clear(), m.forEach((x) => muted.add(x)));
    e.act("mute", put(new Set([2])), put(new Set()), { view: true });
    expect([...muted]).toEqual([2]);
    expect(e.dirty).toBe(false);
    expect(e.undo()).toBe("mute");
    expect(muted.size).toBe(0);
    expect(e.dirty).toBe(false);
  });
});

describe("0.10.2: which preset an instrument is", () => {
  it("a preset's settings match it, in any key order, and stop matching once moved", () => {
    const p = chipPreset("2a03-lead");
    const reordered = Object.fromEntries(Object.entries(p).reverse());
    expect(sameSettings(p, reordered)).toBe(true);
    expect(sameSettings(p, chipPreset("2a03-bass"))).toBe(false);
    expect(sameSettings(p, { ...p, arp: (p.arp ?? 0) + 1 })).toBe(false);
    expect(sameSettings(drumKit("classic"), drumKit("classic"))).toBe(true);
  });
});
