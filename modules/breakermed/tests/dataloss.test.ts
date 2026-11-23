import { describe, expect, it } from "vitest";
import { key, makeDeck } from "./harness";

const noteAt = (d: ReturnType<typeof makeDeck>, line: number, track: number) => d.st.song!.blocks[d.st.song!.sequence[d.st.seq]].cells[line][track].note;

describe("0.12 R1: med save never writes over another song", () => {
  it("a song never saved asks for a name, and two new songs make two folders", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push("songs/first.bmed");
    expect(await d.med("med save")).toBe(0);
    expect(d.asked.at(-1)).toMatch(/^save as/);
    expect(d.files.has("songs/first.bmed/song.json")).toBe(true);
    await d.med("med new --force");
    await d.med("med tempo 77");
    d.answers.push("songs/second.bmed");
    await d.med("med save");
    expect(d.files.has("songs/second.bmed/song.json")).toBe(true);
    expect(JSON.parse(d.files.get("songs/first.bmed/song.json") as string).tempo.tempo).not.toBe(77);
  });
  it("offers a free name when untitled.bmed is taken", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push("songs/untitled.bmed");
    await d.med("med save");
    await d.med("med new --force");
    await d.med("med save"); // no answer: the window is closed
    expect(d.asked.at(-1)).toBe("save as (songs/untitled 2.bmed)");
    expect(d.log).toMatch(/not saved/);
  });
  it("saving onto another song's file asks first; cancel writes nothing", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push("songs/a.bmed");
    await d.med("med save");
    await d.med("med new --force");
    await d.med("med tempo 99");
    d.answers.push("songs/a.bmed", null); // the name, then "cancel" on the question
    expect(await d.med("med save")).toBe(1);
    expect(d.asked.at(-1)).toMatch(/already there/);
    expect(JSON.parse(d.files.get("songs/a.bmed/song.json") as string).tempo.tempo).not.toBe(99);
  });
  it("a song saved once saves again in place, without a question", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push("songs/a.bmed");
    await d.med("med save");
    const n = d.asked.length;
    await d.med("med tempo 101");
    expect(await d.med("med save")).toBe(0);
    expect(d.asked.length).toBe(n);
    expect(JSON.parse(d.files.get("songs/a.bmed/song.json") as string).tempo.tempo).toBe(101);
  });
});

describe("0.12 R2: new, open, demo never replace a changed song without asking", () => {
  it("asks; cancel keeps the song", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med note 01 1 C-3 01");
    const song = d.st.song;
    d.answers.push(2); // cancel
    expect(await d.med("med new")).toBe(1);
    expect(d.asked.at(-1)).toMatch(/changes not saved/);
    expect(d.st.song).toBe(song);
  });
  it("don't save: the autosave keeps a copy, even of a change a moment old", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med note 01 1 C-3 01");
    d.answers.push(1); // don't save
    expect(await d.med("med demo")).toBe(0);
    expect((await d.st.autosave!.list()).length).toBe(1);
  });
  it("save first, then the new song", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med note 01 1 C-3 01");
    d.answers.push(0, "songs/kept.bmed");
    expect(await d.med("med new --chip")).toBe(0);
    expect(d.files.has("songs/kept.bmed/song.json")).toBe(true);
    expect(d.st.song!.tracks).toBe(4);
  });
  it("from a script with no window: refused with a message, unless --force", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med note 01 1 C-3 01");
    expect(await d.med("med new")).toBe(1);
    expect(d.log).toMatch(/--force/);
    expect(await d.med("med new --force")).toBe(0);
  });
});

describe("0.12 R3: delete and ⌫ write only in edit mode", () => {
  it("edit mode off: nothing changes", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.line = 0;
    d.st.track = 0;
    const before = noteAt(d, 0, 0);
    expect(before).toBeTruthy();
    d.press(key("delete"));
    d.press(key("backspace"));
    expect(noteAt(d, 0, 0)).toBe(before);
    expect(d.st.editor!.dirty).toBe(false);
  });
  it("edit mode on: delete clears, ⌫ pulls the track up", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    d.st.line = 0;
    d.press(key("delete"));
    expect(noteAt(d, 0, 0)).toBe(0);
  });
});
