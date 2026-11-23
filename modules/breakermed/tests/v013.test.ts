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

describe("0.13 D1: ⏎ plays from the top of the block, ⇧⏎ loops it, ⇧space plays from the cursor", () => {
  it("⏎ → the song from this block's line 0; ⇧⏎ → this block looped; ⇧space → from the cursor", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.line = 20;
    d.press(key("enter"));
    await settle();
    expect(d.log).toMatch(/\$ med play song 00\n/);
    expect(d.engine.mode).toBe("song");
    expect(d.engine.current()?.line).toBe(0);
    await d.med("med stop");
    d.st.line = 20;
    d.press(key("enter", { shift: true }));
    await settle();
    expect(d.log).toMatch(/\$ med play block 00\n/);
    expect(d.engine.mode).toBe("block");
    await d.med("med stop");
    d.st.line = 20;
    d.press(key("space", { shift: true }));
    await settle();
    expect(d.log).toMatch(/\$ med play song 00 20\n/);
    expect(d.engine.current()?.line).toBe(20);
  });
  it("⏎ again while it plays: the block heard starts over", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med play song 00 30");
    d.draw(); // follow on: the cursor is the line heard
    d.press(key("enter"));
    await settle();
    expect(d.engine.current()?.line).toBe(0);
  });
  it("space still stops; ⇧space while playing stops too", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med play");
    d.press(key("space", { shift: true }));
    await settle();
    expect(d.engine.playing).toBe(false);
  });
});

describe("0.13 D2: line numbers in decimal, command values in hex", () => {
  it("the block's numbers, its title and med note / pos / play take decimal lines", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.line = 10;
    const ui = d.draw(120, 50);
    expect(ui.find("line 010/063")).toBeTruthy();
    expect(ui.texts.some((t) => t.s === " 010")).toBe(true);
    expect(await d.med("med note 10 1 C-3 01 0C20")).toBe(0);
    expect(d.st.song!.blocks[0].cells[10][0]).toMatchObject({ note: 25, inst: 1, cmd: [0x0c], val: [0x20] });
    await d.med("med pos 00 33");
    expect(d.st.line).toBe(33);
    expect(d.log).toMatch(/line 033/);
  });
});

describe("0.13 I4: a command is said in words", () => {
  it("the status line names the command under the cursor", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med note 0 1 C-3 01 0F06");
    d.st.line = 0; d.st.track = 0; d.st.col = 4;
    expect(d.app.status!()).toMatch(/0F06 · tempo 6 BPM \(the speed is 09xx\)/);
    await d.med("med note 0 1 C-3 01 0C20");
    expect(d.app.status!()).toMatch(/0C20 · volume 32 of 64/);
    await d.med("med note 0 1 C-3 01 0E12");
    expect(d.app.status!()).toMatch(/0E12 · no such command here/);
    await d.med("med note 0 1 C-3 01 1D10");
    expect(d.app.status!()).toMatch(/next block, at line 16/);
  });
});

describe("0.13 P1: the status line fits the screen and the mode", () => {
  it("edit on says how to stop editing; each screen its own keys; the chord hint only on the block", async () => {
    const d = makeDeck();
    await d.med("med new");
    expect(d.app.status!()).toMatch(/space edit/);
    await d.med("med edit on");
    expect(d.app.status!()).toMatch(/space stop editing/);
    d.st.screen = "instrument";
    expect(d.app.status!()).toMatch(/the keys play it/);
    d.st.screen = "song";
    expect(d.app.status!()).toMatch(/↑↓ ←→ ⏎/);
    d.st.song!.chordColumn = true;
    d.st.col = 3;
    expect(d.app.status!()).not.toMatch(/chord/);
  });
});

describe("0.13 P2 / P3: the commands answer, and refuse what they don't know", () => {
  it("med with no song names med new and med demo", async () => {
    const d = makeDeck();
    await d.med("med");
    expect(d.log).toMatch(/med new.*med demo/);
  });
  it("med play foo is refused; med tracks says the count; one line is 'line'; med pos names the range", async () => {
    const d = makeDeck();
    await d.med("med new");
    expect(await d.med("med play foo")).toBe(1);
    expect(d.engine.playing).toBe(false);
    expect(d.log).toMatch(/med play: "foo"\?/);
    await d.med("med tracks 4");
    expect(d.log).toMatch(/4 tracks\n/);
    await d.med("med block lines 1");
    expect(d.log).toMatch(/: 1 line\n/);
    expect(await d.med("med pos 5")).toBe(1);
    expect(d.log).toMatch(/position 5 isn't in the sequence \(00–00\)/);
    await d.med("med undo");
    await d.med("med undo");
    await d.med("med undo");
    await d.med("med undo");
    expect(d.log).toMatch(/nothing to undo|undone/);
  });
});

describe("0.13 P12: the two 0.12.2 questions", () => {
  it("'don't save' mentions the autosave's copy only when the autosave is on", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med autosave off");
    await d.med("med note 0 1 C-3 01");
    d.answers.push(2);
    await d.med("med new");
    expect(d.asked.at(-1)).toMatch(/\| don't save \|/);
    await d.med("med autosave on");
    d.answers.push(2);
    await d.med("med new");
    expect(d.asked.at(-1)).toMatch(/the autosave keeps a copy/);
  });
  it("closing a new song with changes asks about 'this new song'", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.draw();
    await d.med("med note 0 1 C-3 01");
    d.answers.push(2);
    await d.app.close!();
    expect(d.asked.at(-1)).toMatch(/^save the changes to this new song\?/);
  });
});
