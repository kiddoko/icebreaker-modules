import { describe, expect, it } from "vitest";
import { makeDeck } from "./harness";

/** what one command printed */
async function said(d: ReturnType<typeof makeDeck>, line: string) {
  const from = d.log.length;
  const code = await d.med(line);
  return { code, out: d.log.slice(from).split("\n").slice(1).join("\n") };
}

describe("0.12 R10: every command answers", () => {
  it("confirms what it did", async () => {
    const d = makeDeck();
    await d.med("med new");
    const cases: [string, RegExp][] = [
      ["med tempo 118", /tempo 118/],
      ["med speed 5", /speed 5/],
      ["med lpb 4", /4 lines a beat/],
      ["med pos 0", /position 00 → block 000/],
      ["med block lines 32", /32 lines/],
      ["med track 2 vol 40", /snare.*volume 40/],
      ["med track 2 pan -30", /snare.*pan -30/],
      ["med copy", /copied/],
      ["med paste", /pasted/],
      ["med cut", /cut/],
      ["med clear", /cleared/],
      ["med transpose 2", /transposed \+2/],
      ["med step 2", /step 2/],
      ["med octave 4", /octave 4/],
      ["med ins 02", /instrument 02/],
      ["med seq add 0", /position 01 → block 000/],
      ["med seq set 1 0", /position 01 → block 000/],
      ["med seq rm 1", /removed position 01/],
      ["med play", /playing/],
      ["med stop", /stopped/],
    ];
    for (const [line, re] of cases) {
      const r = await said(d, line);
      expect(r.out, line).toMatch(re);
      expect(r.code, line).toBe(0);
    }
  });
  it("med seq and med block list what there is; a block in no position is marked", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med block new");
    expect((await said(d, "med seq")).out).toMatch(/pos\s+block[\s\S]*00\s+000/);
    expect((await said(d, "med block")).out).toMatch(/001.*not in the sequence/);
  });
});

describe("0.12 R10: errors say what's wrong", () => {
  it("names the faulty argument", async () => {
    const d = makeDeck();
    await d.med("med new 4");
    const cases: [string, RegExp][] = [
      ["med note 00 1 C-3 7F", /instrument 7F.*01–3F/],
      ["med note 00 9 C-3", /track 9: the song has 4/],
      ["med seq set 9 0", /position 09.*00–00/],
      ["med seq rm 9", /position 09/],
      ["med seq set 0 7", /block 007.*000–000/],
      ["med block lines 999999", /1–3200/],
      ["med track 9 vol 3", /track 9: the song has 4/],
    ];
    for (const [line, re] of cases) {
      const r = await said(d, line);
      expect(r.code, line).toBe(1);
      expect(r.out, line).toMatch(re);
    }
  });
});

describe("0.12 G1: blocks — delete one, refused while used", () => {
  it("med block rm: an unused block goes (undoable), a used one stays", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med block new");
    expect((await said(d, "med block rm 0")).code).toBe(1);
    expect((await said(d, "med block rm 1")).out).toMatch(/deleted block 001/);
    expect(d.st.song!.blocks.length).toBe(1);
    await d.med("med undo");
    expect(d.st.song!.blocks.length).toBe(2);
  });
  it("deleting a block renumbers the sequence after it", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med block new"); // 001, unused
    await d.med("med block new"); // 002
    await d.med("med seq add 2");
    await d.med("med block rm 1");
    expect(d.st.song!.sequence).toEqual([0, 1]);
  });
  it("med seq move: a position up or down", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med block new");
    await d.med("med seq add 1");
    expect((await said(d, "med seq move 1 up")).code).toBe(0);
    expect(d.st.song!.sequence).toEqual([1, 0]);
    expect(d.st.seq).toBe(0);
  });
});

describe("0.12 R11: small texts", () => {
  it("info, ls and recover say the right thing", async () => {
    const d = makeDeck();
    expect((await said(d, "med ls")).out).toMatch(/\.bmed/);
    await d.med("med new --chip");
    const info = (await said(d, "med info")).out;
    expect(info).not.toMatch(/MMD1/);
    expect(info).not.toMatch(/0 frames/);
  });
});
