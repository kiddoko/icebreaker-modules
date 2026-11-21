import { describe, expect, it } from "vitest";
import { readBmed, writeBmed } from "../src/format/bmed";
import { writeMed } from "../src/format/write";
import { Renderer } from "../src/render";
import { cleanEcho, newSong } from "../src/song";

const RATE = 48000;

/** an impulse through the renderer's echo: what comes out, left and right */
function impulse(type: "normal" | "cross", ms: number, depth: number) {
  const s = newSong(2);
  s.echo = { type, ms, depth };
  const r = new Renderer(s, RATE);
  const l = new Float32Array(RATE), rr = new Float32Array(RATE);
  l[0] = 1; // a click on the left
  r.render(l, rr);
  return { l, r: rr, d: Math.round((ms / 1000) * RATE), r2: r };
}

describe("breakerMED: the echo", () => {
  it("normal: the sound comes back after its length, each time 1/2^depth as loud", () => {
    const { l, r, d } = impulse("normal", 100, 1);
    expect(l[d]).toBeCloseTo(0.5);
    expect(l[2 * d]).toBeCloseTo(0.25);
    expect(l[d - 1]).toBe(0);
    expect(Math.max(...r.map(Math.abs))).toBe(0); // it stays on its side
  });

  it("cross: it bounces from one side to the other", () => {
    const { l, r, d } = impulse("cross", 50, 2);
    expect(r[d]).toBeCloseTo(0.25);
    expect(l[d]).toBe(0);
    expect(l[2 * d]).toBeCloseTo(0.0625);
  });

  it("keeps the renderer busy while it rings", () => {
    const { r2 } = impulse("normal", 400, 1);
    expect(r2.busy).toBe(true);
  });

  it("checked from a file; kept in .bmed; .med warns", async () => {
    expect(cleanEcho({ type: "cross", ms: 99999, depth: 0 })).toEqual({ type: "cross", ms: 2000, depth: 1 });
    expect(cleanEcho({ type: "loud" })).toBeUndefined();
    const s = newSong(2);
    s.echo = { type: "normal", ms: 300, depth: 3 };
    const back = await readBmed(writeBmed(s)[0].data as string, async () => new Uint8Array(0));
    expect(back.echo).toEqual(s.echo);
    expect(writeMed(s).warnings.some((w) => w.includes("echo"))).toBe(true);
  });
});

describe("breakerMED: silenced by the deck", () => {
  it("silence(): no song, no tail, no echo", () => {
    const s = newSong(2);
    s.echo = { type: "normal", ms: 400, depth: 1 };
    const r = new Renderer(s, RATE);
    const l = new Float32Array(RATE), rr = new Float32Array(RATE);
    l[0] = 1;
    r.render(l, rr);
    expect(r.busy).toBe(true);
    r.silence();
    expect(r.busy).toBe(false);
    const after = new Float32Array(RATE), ar = new Float32Array(RATE);
    r.render(after, ar);
    expect(Math.max(...after.map(Math.abs))).toBe(0);
  });
});
