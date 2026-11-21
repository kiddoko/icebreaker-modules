import { describe, expect, it } from "vitest";
import { analogPreset } from "../src/dsp/analog";
import { CHORD_COL, Editor } from "../src/edit";
import { readBmed, writeBmed } from "../src/format/bmed";
import { writeMod } from "../src/format/write";
import { Player } from "../src/replayer";
import { Renderer } from "../src/render";
import { chordNotes, DEFAULT_CHORDS, emptyCell, emptyInstrument, newSong, NOTE_OFF, type Song } from "../src/song";

const RATE = 48000;

function song(): Song {
  const s = newSong(2);
  s.instruments = [Object.assign(emptyInstrument(), { kind: "analog" as const, name: "sine", synth: analogPreset("sine") })];
  return s;
}

/** how many sine peaks a second, per frequency band: the notes that sound */
function energyAt(d: Float32Array, hz: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < d.length; i++) (re += d[i] * Math.cos((2 * Math.PI * hz * i) / RATE)), (im += d[i] * Math.sin((2 * Math.PI * hz * i) / RATE));
  return Math.hypot(re, im) / d.length;
}

describe("breakerMED: chords", () => {
  it("the table: 15 chords; a chord's notes over the one written", () => {
    expect(DEFAULT_CHORDS.length).toBe(15);
    const s = song();
    expect(chordNotes(s, 1)).toEqual([4, 7]);
    expect(chordNotes(s, 0)).toEqual([]);
  });

  it("the replayer sends the chord with the note", () => {
    const s = song();
    s.blocks[0].cells[0][0] = { ...emptyCell(1), note: 25, inst: 1, chord: 2 };
    const p = new Player(s);
    const ev = p.step().events.find((e) => e.play !== undefined);
    expect(ev?.chord).toEqual([3, 7]);
  });

  it("C-3 with chord 1 sounds C, E and G; a note off stops all three", () => {
    const s = song();
    s.blocks[0].cells[0][0] = { ...emptyCell(1), note: 25, inst: 1, chord: 1 };
    s.blocks[0].cells[8][0] = { ...emptyCell(1), note: NOTE_OFF };
    const r = new Renderer(s, RATE);
    r.play(0, 0);
    const l = new Float32Array(RATE / 2), rr = new Float32Array(RATE / 2);
    r.render(l, rr);
    const part = l.slice(RATE / 10, RATE / 4);
    const c = energyAt(part, 261.63), e = energyAt(part, 329.63), g = energyAt(part, 392), fs = energyAt(part, 370);
    expect(Math.min(c, e, g)).toBeGreaterThan(fs * 5);
    // about as loud as one note, not three times
    expect(Math.max(...part.map(Math.abs))).toBeLessThan(0.8);
    // later: silent (the note off released all three)
    const late = new Float32Array(RATE * 2), lr = new Float32Array(RATE * 2);
    r.render(late, lr);
    expect(Math.max(...late.slice(RATE).map(Math.abs))).toBeLessThan(1e-3);
  });

  it("editing: the chord digit, clear, undo; the table's own lines", () => {
    const s = song();
    const e = new Editor(s);
    e.writeNote(0, 0, 0, 25, 1);
    e.writeHex(0, 0, 0, CHORD_COL, 3);
    expect(s.blocks[0].cells[0][0].chord).toBe(3);
    e.clear(0, 0, 0, CHORD_COL);
    expect(s.blocks[0].cells[0][0].chord).toBeUndefined();
    e.undo();
    expect(s.blocks[0].cells[0][0].chord).toBe(3);
    e.chords(1, { name: "pow", notes: [7, 12] });
    expect(chordNotes(s, 1)).toEqual([7, 12]);
    expect(chordNotes(s, 2)).toEqual([3, 7]);
    e.undo();
    expect(s.chords).toBeUndefined();
  });

  it(".bmed keeps the chords and the table; .mod warns", async () => {
    const s = song();
    s.blocks[0].cells[0][0] = { ...emptyCell(1), note: 25, inst: 1, chord: 0xc };
    s.chordColumn = true;
    new Editor(s).chords(0xc, { name: "mine", notes: [5, 9] });
    const files = writeBmed(s);
    expect(files[0].data as string).toContain("C-3 01:C");
    const back = await readBmed(files[0].data as string, async () => new Uint8Array(0));
    expect(back.blocks[0].cells[0][0].chord).toBe(0xc);
    expect(back.chordColumn).toBe(true);
    expect(chordNotes(back, 0xc)).toEqual([5, 9]);
    expect(writeMod(s).warnings.some((w) => w.startsWith("chords"))).toBe(true);
  });
});
