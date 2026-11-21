import { describe, expect, it } from "vitest";
import { Player } from "../src/replayer";
import { periodOf } from "../src/song";
import { chipSong, templateSong } from "../src/template";
import { parseNote } from "../src/edit";
import doc from "../SOUND_DESIGN.md?raw";
import { PACK } from "../src/pack";
import { GUIDE, EFFECTS } from "../src/guide";
import { START } from "../src/start";

/** the period the replayer gives a note written in the first cell of track 1 */
function periodPlayed(s: ReturnType<typeof templateSong>, note: string, inst: number) {
  const c = s.blocks[0].cells[0][0];
  (c.note = parseNote(note)!), (c.inst = inst), (c.chord = undefined);
  return new Player(s).step().events.find((e) => e.voice === 0 && e.play !== undefined)?.rate;
}

describe("0.11.0: notes play in the octave they're written", () => {
  it("a new song's E-4 on a synth plays E-4, not E-3", () => {
    const s = templateSong();
    const rate = periodPlayed(s, "E-4", 3); // the analog lead
    expect(rate).toBeCloseTo(3546895 / periodOf(3 * 12 + 4), 0);
    expect(s.flags.hardwareMix).toBe(false);
  });
  it("even in a song with the Amiga's voices, a chip plays every octave", () => {
    const s = chipSong();
    s.flags.hardwareMix = true;
    expect(periodPlayed(s, "E-5", 1)).toBeCloseTo(3546895 / periodOf(4 * 12 + 4), 0);
  });
});


describe("0.11.0: the sound pack, the guide, START", () => {
  it("SOUND_DESIGN.md lists exactly the pack's sounds", () => {
    const inDoc = [...doc.matchAll(/^\| `([^`]+\.wav)`/gm)].map((m) => m[1]);
    expect(inDoc).toEqual(PACK.map((p) => p.file));
  });
  it("the guide has the effects, START its six choices with a med command each", () => {
    expect(GUIDE.some((p) => p.rows === EFFECTS)).toBe(true);
    expect(START.map((s) => s.key)).toEqual(["N", "O", "D", "?", "C", "S"]);
    expect(START.every((s) => s.cmd.startsWith("med "))).toBe(true);
  });
});
