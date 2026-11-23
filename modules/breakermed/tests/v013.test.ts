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
    expect(d.log).toMatch(/\$ med play song 000\n/);
    expect(d.engine.mode).toBe("song");
    expect(d.engine.current()?.line).toBe(0);
    await d.med("med stop");
    d.st.line = 20;
    d.press(key("enter", { shift: true }));
    await settle();
    expect(d.log).toMatch(/\$ med play block 000\n/);
    expect(d.engine.mode).toBe("block");
    await d.med("med stop");
    d.st.line = 20;
    d.press(key("space", { shift: true }));
    await settle();
    expect(d.log).toMatch(/\$ med play song 000 20\n/);
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
    expect(d.log).toMatch(/position 5 isn.t in the sequence \(000–000\)/);
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

describe("0.13 D3: mute, solo and the sequence by key", () => {
  it("alt M mutes the cursor's track, ⇧alt M solos it; alt N / alt D / alt ⌫ shape the sequence", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.track = 2;
    d.press(alt("KeyM"));
    await settle();
    expect(d.engine.muted.has(2)).toBe(true);
    d.press(alt("KeyM", { shift: true }));
    await settle();
    expect([...d.engine.muted].sort()).toEqual([0, 1, 3, 4, 5, 6, 7]);
    const blocks = d.st.song!.blocks.length;
    d.press(alt("KeyN"));
    await settle();
    expect(d.st.song!.sequence.length).toBe(2);
    expect(d.st.song!.blocks.length).toBe(blocks + 1);
    d.press(alt("KeyD"));
    await settle();
    expect(d.st.song!.sequence.length).toBe(3);
    d.press(key("backspace", { code: "Backspace", alt: true }));
    await settle();
    expect(d.st.song!.sequence.length).toBe(2);
  });
  it("insert (edit mode): a line, like alt ⏎", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    const first = JSON.stringify(d.st.song!.blocks[0].cells[0][0]);
    d.press(key("insert", { code: "Insert" }));
    expect(JSON.stringify(d.st.song!.blocks[0].cells[1][0])).toBe(first);
  });
});

describe("0.13 I5: a key plays the whole sound", () => {
  it("a sample with no loop: to its end; a synth 1.5 s; a new key cuts the last one", async () => {
    const { Renderer } = await import("../src/render");
    const d = makeDeck();
    await d.med("med new");
    const s = d.st.song!;
    s.instruments[0] = { ...s.instruments[0], kind: "sample", data: new Float32Array(48000 * 9).fill(0.5), loopLength: 0, loopStart: 0 };
    const r = new Renderer(s, 48000, false);
    r.preview(0, 48000);
    const prev = (r as unknown as { previews: { until: number; released?: boolean }[] }).previews;
    expect(prev[0].until).toBe(48000 * 9);
    r.preview(0, 48000);
    expect(prev[0].released).toBe(true);
    expect(r.ringing).toBe(true);
    r.hush();
    expect(prev[1].released).toBe(true);
  });
});

describe("0.13 I9: undo goes where it undid; an instrument number is one undo", () => {
  it("two digits typed are one step; undo brings the cursor back to the cell", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    d.st.line = 5; d.st.track = 3; d.st.col = 1;
    const before = d.st.song!.blocks[0].cells[5][3].inst;
    d.press(key("1", { code: "Digit1" }));
    d.press(key("2", { code: "Digit2" }));
    expect(d.st.song!.blocks[0].cells[5][3].inst).toBe(0x12);
    d.st.line = 40; d.st.track = 0;
    d.press(key("z", { code: "KeyZ", meta: true }));
    expect(d.st.song!.blocks[0].cells[5][3].inst).toBe(before);
    expect([d.st.line, d.st.track]).toEqual([5, 3]);
  });
});

describe("0.13 P5 / P7 / P8 / P9", () => {
  it("P5: no note past B-9 is written, B-9 reads B-9", async () => {
    const { noteName } = await import("../src/song");
    expect(noteName(108)).toBe("B-9");
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    d.st.octave = 7; d.st.line = 1;
    const before = JSON.stringify(d.st.song!.blocks[0].cells[1][0]);
    d.press(key("i", { code: "KeyI" })); // the top row's highest key: past B-9 in octave 8
    expect(JSON.stringify(d.st.song!.blocks[0].cells[1][0])).toBe(before);
  });
  it("P7: undoing back to the saved song: no ● any more", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push("songs/a.bmed");
    await d.med("med save");
    await d.med("med note 3 1 C-3 01");
    expect(d.st.editor!.dirty).toBe(true);
    await d.med("med undo");
    expect(d.st.editor!.dirty).toBe(false);
    await d.med("med redo");
    expect(d.st.editor!.dirty).toBe(true);
  });
  it("P8: transposing past the range moves nothing", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med note 0 1 B-9 01");
    await d.med("med note 1 1 C-3 01");
    d.st.sel = { block: 0, line0: 0, line1: 1, track0: 0, track1: 0 };
    expect(await d.med("med transpose 1")).toBe(1);
    expect(d.st.song!.blocks[0].cells[1][0].note).toBe(25);
  });
  it("P9: the first thing written is the song's folder, then song.json", async () => {
    const d = makeDeck();
    await d.med("med new");
    const order: string[] = [];
    const v = d.ib.vault as unknown as Record<string, (p: string, x?: unknown) => Promise<void>>;
    for (const k of ["mkdir", "write", "writeBytes"]) {
      const f = v[k];
      v[k] = (p, x) => (order.push(p), f(p, x));
    }
    d.answers.push("songs/b.bmed");
    await d.med("med save");
    expect(order.slice(0, 2)).toEqual(["songs/b.bmed", "songs/b.bmed/song.json"]);
  });
  it("P6: the SONG screen says the BPM once when it is the same", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.screen = "song";
    expect(d.draw().screen()).not.toMatch(/(\d+) BPM \(\1\)/);
  });
});

describe("0.13 P4: LIM lights from 3 dB of reduction", () => {
  it("2 dB: not lit", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med play");
    const r = (d.engine as unknown as { r: { meter: { peak: number; gain: number } } }).r;
    r.meter = { peak: 0.89, gain: 10 ** (-2 / 20) };
    expect(d.draw().screen().split("\n")[0]).not.toMatch(/LIM/);
  });
});

describe("0.13 D4: a sound keeps its own rate", () => {
  it("C-3 plays a 48 kHz sound at 48 kHz; .bmed keeps the rate; .mod gets the Amiga's", async () => {
    const { SampleVoice } = await import("../src/dsp/voice");
    const { PAULA_CLOCK, newSong, emptyInstrument } = await import("../src/song");
    const { writeBmed, readBmed } = await import("../src/format/bmed");
    const { withAmigaRates } = await import("../src/dsp/bake");
    const { HQ_RATE } = await import("../src/sampler");
    const ins = { ...emptyInstrument(), kind: "sample" as const, rate: 48000, data: Float32Array.from({ length: 4800 }, (_, i) => i / 4800) };
    const v = new SampleVoice(48000);
    v.paula = true;
    v.start({ instrument: ins, rate: PAULA_CLOCK / 214, offset: 0 });
    v.set(PAULA_CLOCK / 214, 1, 0);
    const L = new Float32Array(100), R = new Float32Array(100);
    v.render(L, R, 0, 100);
    expect(L[99]).toBeCloseTo(99 / 4800, 4); // one frame of the sound a frame out: its own rate
    const s = newSong(1);
    s.instruments = [ins];
    const files = writeBmed(s);
    const back = await readBmed(files.find((f) => f.path === "song.json")!.data as string, async (p) => files.find((f) => f.path === p)!.data as Uint8Array);
    expect(back.instruments[0].rate).toBe(48000);
    const old = withAmigaRates(s).instruments[0];
    expect(old.rate).toBeUndefined();
    expect(old.transpose).toBe(12);
    expect(old.data.length).toBeCloseTo((4800 * HQ_RATE) / 48000, -1);
  });
});

describe("0.13 D4: the vintage mode", () => {
  it("amiga: 8 bits and the note's own rate; akai: 12 bits at its rate; off: the sound as it was", async () => {
    const { voiceFor } = await import("../src/dsp/voice");
    const { emptyInstrument } = await import("../src/song");
    const sine = Float32Array.from({ length: 48000 }, (_, i) => 0.9 * Math.sin((2 * Math.PI * 1000 * i) / 48000));
    const base = { ...emptyInstrument(), kind: "sample" as const, rate: 48000, data: sine };
    const play = (vintage?: { kind: "amiga" | "akai"; rate?: number }, rate = 3546895 / 214) => {
      const v = voiceFor({ ...base, ...(vintage ? { vintage } : {}) }, 48000, false);
      v.start({ instrument: base, rate, offset: 0 });
      v.set(rate, 1, 0);
      const L = new Float32Array(4800), R = new Float32Array(4800);
      v.render(L, R, 0, 4800);
      return L;
    };
    const plain = play();
    const amiga = play({ kind: "amiga" });
    const akai = play({ kind: "akai" });
    const diff = (a: Float32Array, b: Float32Array) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0);
    expect(diff(plain, amiga)).toBeGreaterThan(0.05);
    expect(diff(plain, akai)).toBeGreaterThan(0.01);
    // off: exactly the sound before (no wrapper)
    expect(voiceFor(base, 48000, false).constructor.name).toBe("SampleVoice");
  });
  it("med vintage <n> amiga|akai [rate]|off: undoable, saved in the song, said on the INSTRUMENT screen; alt R goes round", async () => {
    const d = makeDeck();
    await d.med("med new");
    expect(await d.med("med vintage 01 amiga")).toBe(0);
    expect(d.st.song!.instruments[0].vintage).toEqual({ kind: "amiga" });
    expect(await d.med("med vintage 01 akai 26000")).toBe(0);
    expect(d.st.song!.instruments[0].vintage).toEqual({ kind: "akai", rate: 26000 });
    expect(await d.med("med vintage 01 akai 99")).toBe(1);
    await d.med("med undo");
    expect(d.st.song!.instruments[0].vintage).toEqual({ kind: "amiga" });
    await d.med("med vintage 01 off");
    expect(d.st.song!.instruments[0].vintage).toBeUndefined();
    d.st.inst = 0;
    d.press(alt("KeyR"));
    expect(d.st.song!.instruments[0].vintage?.kind).toBe("amiga");
    d.press(alt("KeyR"));
    expect(d.st.song!.instruments[0].vintage?.kind).toBe("akai");
    d.st.screen = "instrument";
    expect(d.draw().screen()).toMatch(/vintage/);
    d.press(alt("KeyR"));
    expect(d.st.song!.instruments[0].vintage).toBeUndefined();
    d.answers.push("songs/v.bmed");
    await d.med("med vintage 02 akai");
    await d.med("med save");
    const json = JSON.parse(d.files.get("songs/v.bmed/song.json") as string);
    expect(json.instruments[1].vintage).toEqual({ kind: "akai" });
  });
});

describe("0.13 D2 (all of it): positions and block numbers in decimal too", () => {
  it("the sequence, the block's frame and the commands use decimal; a song file keeps plain numbers", async () => {
    const d = makeDeck();
    await d.med("med new");
    for (let i = 0; i < 11; i++) await d.med("med seq new");
    expect(d.st.song!.sequence.length).toBe(12);
    // position 10 is the eleventh (decimal, not hex 0x10 = 16)
    expect(await d.med("med pos 10")).toBe(0);
    expect(d.st.seq).toBe(10);
    expect(d.log).toMatch(/position 010 → block 010/);
    const ui = d.draw(120, 40);
    expect(ui.find("BLOCK 010")).toBeTruthy();
    expect(ui.texts.some((t) => t.s === "011")).toBe(true); // the sequence list
    await d.med("med seq set 11 2");
    expect(d.st.song!.sequence[11]).toBe(2);
    expect(await d.med("med play song 1A")).toBe(1); // hex is refused, not misread
    await d.med("med play block 11 12");
    expect(d.engine.current()?.seq).toBe(11);
    d.answers.push("songs/dec.bmed");
    await d.med("med save");
    const json = JSON.parse(d.files.get("songs/dec.bmed/song.json") as string);
    expect(json.sequence[11]).toBe(2);
  });
});
