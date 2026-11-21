import { describe, expect, it } from "vitest";
import { voiceFor } from "../src/dsp/voice";
import { SYNTHS } from "../src/synths";
import { C3_RATE } from "../src/dsp/analog";
import { emptyInstrument, type Instrument } from "../src/song";
import { PRESET_LEVELS } from "../src/dsp/levels";

/** the loudness every preset is matched to: its loudest 100 ms, in dB, at full volume */
export const TARGET_DB = -9;
/** hats sit lower in a mix: 6 dB under the rest */
const targetOf = (id: string) => TARGET_DB - (id.includes("hat") ? 6 : 0);
const R = 24000;

/** an instrument's loudest 100 ms (RMS, dB), one C-3 held 0.6 s then released */
export function loudness(ins: Instrument): number {
  const v = voiceFor(ins, R, false);
  v.start({ instrument: ins, rate: C3_RATE, offset: 0 });
  v.set(C3_RATE, 1, 0);
  const n = R, held = Math.floor(R * 0.6);
  const L = new Float32Array(n), Rt = new Float32Array(n);
  v.render(L, Rt, 0, held);
  v.stop();
  v.render(L, Rt, held, n);
  const w = R / 10;
  let best = 0;
  for (let a = 0; a + w <= n; a += w / 2) {
    let s = 0;
    for (let i = a; i < a + w; i++) s += L[i] * L[i] + Rt[i] * Rt[i];
    best = Math.max(best, s / (2 * w));
  }
  return 10 * Math.log10(best + 1e-12);
}

const presets = SYNTHS.flatMap((sk) =>
  sk.presets.map((name) => {
    const ins = { ...emptyInstrument(), kind: sk.kind, name } as Instrument;
    (ins as unknown as Record<string, object>)[sk.field] = sk.preset(name);
    return { id: `${sk.kind}:${name}`, ins };
  }),
);

describe("the presets are about as loud as each other", () => {
  it("each within 2 dB of the target (else: the level to write in dsp/levels.ts)", () => {
    const off = presets
      .map(({ id, ins }) => ({ id, db: loudness(ins) }))
      .filter((x) => Math.abs(x.db - targetOf(x.id)) > ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ALL_LEVELS ? 0.25 : 2))
      .map((x) => `  "${x.id}": ${Math.round(((PRESET_LEVELS[x.id] ?? 0) + targetOf(x.id) - x.db) * 2) / 2},`);
    expect(off.join("\n")).toBe("");
  });
});
