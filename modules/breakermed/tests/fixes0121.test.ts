import { describe, expect, it } from "vitest";
import { key, makeDeck } from "./harness";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("0.12.1: ⏎ again stops", () => {
  it("enter plays, enter again stops", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.press(key("enter"));
    await settle();
    expect(d.engine.playing).toBe(true);
    d.press(key("enter"));
    await settle();
    expect(d.engine.playing).toBe(false);
  });
});

describe("0.12.1: where the song is, with follow off", () => {
  it("the frame says the line heard, even when it's off screen", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med follow off");
    await d.med("med play song 0 30");
    const title = d.draw(120, 20).texts.find((t) => /BLOCK 000/.test(t.s))!.s;
    expect(title).toMatch(/▶ 030/);
  });
});

describe("0.12.1: LIM stays lit long enough to be seen", () => {
  it("held about a second and a half, whatever the drawing rate", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med play");
    const r = (d.engine as unknown as { r: { meter: { peak: number; gain: number } } }).r;
    r.meter = { peak: 0.89, gain: 0.5 }; // the limiter took 6 dB
    expect(d.draw().screen().split("\n")[0]).toMatch(/LIM/);
    // 30 more frames with nothing new (the page draws faster than the sound is computed)
    for (let i = 0; i < 30; i++) d.draw();
    expect(d.draw().screen().split("\n")[0]).toMatch(/LIM/);
  });
});

describe("0.12.1: the save note, the saved time", () => {
  it("one name in the note; a new song has no 'saved' time", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push("songs/a.bmed");
    await d.med("med save");
    expect(d.notes.at(-1)).toMatch(/^saved · songs\/a\.bmed/);
    expect(d.notes.join("\n")).not.toMatch(/BreakerMED:/);
    await d.med("med new");
    expect(d.draw().screen().split("\n")[0]).not.toMatch(/saved/);
  });
  it("the question names a song never saved as 'this new song'", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med tempo 99");
    await d.med("med new");
    expect(d.asked.at(-1)).toMatch(/^this new song: changes not saved/);
  });
});

describe("0.12.1: the autosave's permission is asked when the song starts, not mid-edit", () => {
  it("med new writes the recovery folder at once (the deck asks then)", async () => {
    const d = makeDeck();
    await d.med("med new");
    await settle();
    expect([...d.files.keys()].some((p) => p.startsWith("songs/.recovery/"))).toBe(true);
  });
});
