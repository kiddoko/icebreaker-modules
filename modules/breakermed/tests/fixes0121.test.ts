import { describe, expect, it } from "vitest";
import { makeDeck } from "./harness";


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

describe("0.12.1: a placeholder's name fits the instrument list", () => {
  it("◌ and the sound's name in the list; the full name in its tip", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med pack load kick-acoustic");
    d.st.screen = "block";
    const ui = d.draw();
    const row = ui.texts.find((t) => /^06 /.test(t.s))!;
    expect(row.s).toBe("06 ◌kick-acoustic");
  });
});
