import { describe, expect, it } from "vitest";
import { renderSong } from "../src/export";
import { templateSong } from "../src/template";
import { key, makeDeck } from "./harness";
import { NOTE_OFF } from "../src/song";

describe("0.12 G9: the stems add up to the mix (before its limiter)", () => {
  it("their sum is the unlimited master", async () => {
    const s = templateSong(4);
    s.blocks[0].lines = 16;
    s.blocks[0].cells.length = 16;
    const o = { rate: 12000, bits: 24 as const, paula: false, tail: 0.2 };
    const raw = await renderSong(s, { ...o, limit: false });
    const stems = await Promise.all([0, 1, 2, 3].map((t) => renderSong(s, { ...o, solo: [t], limit: false })));
    let err = 0, ref = 0;
    for (let i = 0; i < raw.channels[0].length; i++) {
      const sum = stems.reduce((a, p) => a + p.channels[0][i], 0);
      err = Math.max(err, Math.abs(sum - raw.channels[0][i]));
      ref = Math.max(ref, Math.abs(raw.channels[0][i]));
    }
    expect(err / ref).toBeLessThan(1e-4);
  });
});

describe("0.12 G11: the old trackers' keys", () => {
  it("1 and caps lock write a note off, F1–F8 the octave", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    d.st.line = 1;
    d.press(key("1"));
    expect(d.st.song!.blocks[0].cells[1][0].note).toBe(NOTE_OFF);
    d.press(key("capslock", { code: "CapsLock" }));
    expect(d.st.song!.blocks[0].cells[2][0].note).toBe(NOTE_OFF);
    d.press(key("f5"));
    expect(d.st.octave).toBe(4);
  });
  it("closing the page on the guide opens on START next time (B13)", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med guide");
    d.draw();
    await d.app.close!();
    expect(d.st.screen).not.toBe("guide");
    expect(d.draw().screen()).toMatch(/START/);
  });
});
