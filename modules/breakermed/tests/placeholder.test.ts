import { describe, expect, it } from "vitest";
import { PACK } from "../src/pack";
import { placeholderFor } from "../src/placeholder";
import { makeDeck } from "./harness";

describe("0.12: the sound pack's placeholders, computed until people record them", () => {
  it("every sound of the pack has one: a sample, audible, in range, named as a placeholder", () => {
    for (const p of PACK) {
      const ins = placeholderFor(p);
      expect(ins.kind, p.file).toBe("sample");
      expect(ins.data.length, p.file).toBeGreaterThan(500);
      let peak = 0;
      for (const x of ins.data) peak = Math.max(peak, Math.abs(x));
      expect(peak, p.file).toBeGreaterThan(0.05);
      expect(peak, p.file).toBeLessThanOrEqual(1);
      expect(ins.name, p.file).toMatch(/placeholder/);
      if (p.loop) expect(ins.loopLength, p.file).toBeGreaterThan(0);
    }
  });
  it("med pack load gives the placeholder when nobody recorded the sound", async () => {
    const d = makeDeck();
    await d.med("med new");
    expect(await d.med("med pack load kick-acoustic")).toBe(0);
    expect(d.st.song!.instruments[d.st.inst].name).toMatch(/kick-acoustic.*placeholder/);
    expect(d.log).toMatch(/placeholder/);
  });
  it("the sampler with no file in songs/ offers the pack", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push(0);
    expect(await d.med("med sampler")).toBe(0);
    expect(d.asked.at(-1)).toMatch(/load a sound.*kick-acoustic/);
    expect(d.st.song!.instruments[d.st.inst].kind).toBe("sample");
  });
});
