import { describe, expect, it } from "vitest";
import { colKind, colsOf, Editor, parseNote } from "../src/edit";
import { newSong, noteName, NOTE_OFF } from "../src/song";

const fresh = () => {
  const s = newSong(4);
  return { s, e: new Editor(s) };
};
const cell = (s: ReturnType<typeof newSong>, l: number, t: number) => s.blocks[0].cells[l][t];

describe("breakerMED: editing", () => {
  it("columns: the note, two instrument digits, four a command page", () => {
    expect(colsOf(1)).toBe(7);
    expect(colKind(0)).toEqual({ kind: "note" });
    expect(colKind(2)).toEqual({ kind: "inst", digit: 1 });
    expect(colKind(3)).toEqual({ kind: "cmd", page: 0, digit: 0 });
    expect(colKind(6)).toEqual({ kind: "val", page: 0, digit: 1 });
    expect(colKind(7)).toEqual({ kind: "cmd", page: 1, digit: 0 });
  });

  it("writes a note with its instrument, and hex digit by digit", () => {
    const { s, e } = fresh();
    e.writeNote(0, 2, 1, 25, 3);
    expect([noteName(cell(s, 2, 1).note), cell(s, 2, 1).inst]).toEqual(["C-3", 3]);
    e.writeHex(0, 2, 1, 3, 0x0);
    e.writeHex(0, 2, 1, 4, 0xc);
    e.writeHex(0, 2, 1, 5, 0x2);
    e.writeHex(0, 2, 1, 6, 0x0);
    expect([cell(s, 2, 1).cmd[0], cell(s, 2, 1).val[0]]).toEqual([0x0c, 0x20]);
    e.writeHex(0, 2, 1, 1, 0xf);
    expect(cell(s, 2, 1).inst).toBe(63); // 0xF3 is past 63: kept in range
    expect(e.dirty).toBe(true);
  });

  it("note off, clear, undo and redo", () => {
    const { s, e } = fresh();
    e.writeNote(0, 0, 0, 13, 1);
    e.writeNote(0, 1, 0, NOTE_OFF, 1);
    expect(cell(s, 1, 0)).toMatchObject({ note: NOTE_OFF, inst: 0 });
    e.clear(0, 0, 0, 0);
    expect(cell(s, 0, 0).note).toBe(0);
    expect(e.undo()).toBe("clear");
    expect(noteName(cell(s, 0, 0).note)).toBe("C-2");
    e.redo();
    expect(cell(s, 0, 0).note).toBe(0);
  });

  it("inserts and deletes lines in a track, the rest moves", () => {
    const { s, e } = fresh();
    e.writeNote(0, 0, 0, 1);
    e.writeNote(0, 1, 0, 2);
    e.writeNote(0, 1, 1, 9);
    e.insertLine(0, 0, [0]);
    expect([cell(s, 0, 0).note, cell(s, 1, 0).note, cell(s, 2, 0).note]).toEqual([0, 1, 2]);
    expect(cell(s, 1, 1).note).toBe(9); // the other track didn't move
    e.deleteLine(0, 0, [0]);
    expect([cell(s, 0, 0).note, cell(s, 1, 0).note]).toEqual([1, 2]);
  });

  it("copy, cut, paste, transpose a selection", () => {
    const { s, e } = fresh();
    e.writeNote(0, 0, 0, 13, 1);
    e.writeNote(0, 1, 1, 15, 2);
    const sel = { block: 0, line0: 0, line1: 1, track0: 0, track1: 1 };
    const clip = e.copy(sel);
    e.paste(0, 8, 2, clip);
    expect([cell(s, 8, 2).note, cell(s, 9, 3).note, cell(s, 9, 3).inst]).toEqual([13, 15, 2]);
    e.transpose({ block: 0, line0: 8, line1: 9, track0: 2, track1: 3 }, 12);
    expect([noteName(cell(s, 8, 2).note), noteName(cell(s, 9, 3).note)]).toEqual(["C-3", "D-3"]);
    e.cut(sel);
    expect([cell(s, 0, 0).note, cell(s, 1, 1).note]).toEqual([0, 0]);
    e.paste(0, 62, 3, clip); // what doesn't fit is left out
    expect(cell(s, 63, 3).note).toBe(0);
    expect(cell(s, 62, 3).note).toBe(13);
  });

  it("blocks, lengths, tracks and the sequence, undoable", () => {
    const { s, e } = fresh();
    const n = e.newBlock(32);
    expect(s.blocks[n].lines).toBe(32);
    e.seqInsert(1, n);
    expect(s.sequence).toEqual([0, n]);
    e.setLines(0, 16);
    expect(s.blocks[0].cells.length).toBe(16);
    e.setTracks(6);
    expect(s.tracks).toBe(6);
    expect(s.blocks[1].cells[0].length).toBe(6);
    e.seqDelete(0);
    expect(s.sequence).toEqual([n]);
    e.undo();
    e.undo();
    expect(s.tracks).toBe(4);
    expect(s.sequence).toEqual([0, n]);
  });

  it("reads notes the way they're written", () => {
    expect(parseNote("C-3")).toBe(25);
    expect(parseNote("c#1")).toBe(2);
    expect(parseNote("A3")).toBe(34);
    expect(parseNote("^^^")).toBe(NOTE_OFF);
    expect(parseNote("---")).toBe(0);
    expect(parseNote("H-9")).toBe(null);
  });
});
