import { describe, expect, it } from "vitest";
import { key, makeDeck, settle } from "./harness";

const alt = (code: string, o = {}) => key(code.replace(/^Key/, "").toLowerCase(), { code, alt: true, ...o });

describe("0.13 B1: edit mode writes in the block only on the BLOCK screen", () => {
  for (const screen of ["instrument", "song", "export", "guide"] as const) {
    it(`on ${screen}: keys leave the block as it was`, async () => {
      const d = makeDeck();
      await d.med("med new");
      await d.med("med edit on");
      d.st.track = 1; // the snare track: a note column with something under it
      const before = JSON.stringify(d.st.song!.blocks);
      const at = [d.st.line, d.st.track, d.st.col];
      if (screen === "guide") d.press(key("?"));
      else d.st.screen = screen;
      // (on the guide ⌫ goes back to the block: that one is left out there)
      for (const k of [key("z", { code: "KeyZ" }), key("q", { code: "KeyQ" }), ...(screen === "guide" ? [] : [key("backspace")]), key("delete"), key("b", { code: "KeyB" }), key("5", { code: "Digit5" }), key("down", { shift: true }), key("1", { code: "Digit1" })]) d.press(k);
      for (const c of ["KeyC", "KeyX", "KeyV", "KeyQ", "KeyA", "Enter", "KeyL", "KeyK"]) d.press(alt(c));
      d.app.onAction!("down");
      await settle();
      expect(JSON.stringify(d.st.song!.blocks)).toBe(before);
      expect([d.st.line, d.st.track, d.st.col]).toEqual(at);
      expect(d.st.editor!.dirty).toBe(false);
    });
  }
  it("the piano keys still play there", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.screen = "instrument";
    expect(d.press(key("z", { code: "KeyZ" }))).toBe(true);
  });
});

describe("0.13 B2: recording while it plays is shown, and writes one note where the song is", () => {
  it("● REC at the top, a red line; a key writes on the line heard, the cursor doesn't jump", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    await d.med("med play block 00 10");
    const top = d.draw().screen().split("\n")[0];
    expect(top).toMatch(/● REC/);
    const line = d.st.line;
    d.press(key("z", { code: "KeyZ" }));
    expect(d.st.song!.blocks[0].cells[line][d.st.track].note).toBeGreaterThan(0);
    expect(d.st.line).toBe(line);
    expect(d.app.status!()).toMatch(/rec/);
  });
  it("edit off while playing: no REC, keys write nothing", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med play block 00 10");
    expect(d.draw().screen().split("\n")[0]).not.toMatch(/REC/);
    const before = JSON.stringify(d.st.song!.blocks);
    d.press(key("z", { code: "KeyZ" }));
    expect(JSON.stringify(d.st.song!.blocks)).toBe(before);
  });
});

describe("0.13 B3: paste keeps the chords", () => {
  it("copy a chord cell, paste it: the chord digit is there; undo takes it away", async () => {
    const d = makeDeck();
    await d.med("med new");
    const s = d.st.song!;
    s.chordColumn = true;
    const src = s.blocks[0].cells[0][0];
    src.note = 37; src.inst = 5; src.chord = 2;
    const clip = d.st.editor!.copy({ block: 0, line0: 0, line1: 0, track0: 0, track1: 0 });
    s.blocks[0].cells[1][0].chord = 4;
    d.st.editor!.paste(0, 2, 0, clip);
    expect(s.blocks[0].cells[2][0].chord).toBe(2);
    // a clip cell without a chord clears the chord where it lands
    const plain = d.st.editor!.copy({ block: 0, line0: 3, line1: 3, track0: 0, track1: 0 });
    d.st.editor!.paste(0, 1, 0, plain);
    expect(s.blocks[0].cells[1][0].chord).toBeUndefined();
    d.st.editor!.undo();
    d.st.editor!.undo();
    expect(s.blocks[0].cells[2][0].chord).toBeUndefined();
  });
});
