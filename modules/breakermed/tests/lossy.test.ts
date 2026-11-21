import { describe, expect, it } from "vitest";
import { checkFormat, describe as describeExport, encodeLossy, encoderProblem, extOf, formatOf, interleave, isLossy, QUALITIES } from "../src/export";

describe("MP3 / M4A / OGG / Opus exports (the deck's encoder pack)", () => {
  it("reads the format from the file name", () => {
    expect(formatOf("songs/x.mp3")).toBe("mp3");
    expect(formatOf("x.M4A")).toBe("m4a");
    expect(formatOf("x.ogg")).toBe("ogg");
    expect(formatOf("x.opus")).toBe("opus");
    expect(formatOf("x.aif")).toBe("aiff");
    expect(formatOf("x.flac")).toBe("flac");
    expect(formatOf("songs/x")).toBe("wav");
    expect(formatOf("x.wma")).toBeNull();
    expect(extOf("aiff")).toBe("aif");
    expect(extOf("opus")).toBe("opus");
    expect(isLossy("mp3") && !isLossy("flac")).toBe(true);
  });

  it("checks the qualities and rates each format takes", () => {
    expect(checkFormat("mp3", 24, 48000)).toBeNull();
    expect(checkFormat("mp3", 24, 44100, "320")).toBeNull();
    expect(checkFormat("mp3", 24, 48000, "V2")).toBeNull();
    expect(checkFormat("mp3", 24, 48000, "999")).toMatch(/quality/);
    expect(checkFormat("ogg", 24, 48000, "q8")).toBeNull();
    expect(checkFormat("ogg", 24, 48000, "q9")).toMatch(/quality/);
    expect(checkFormat("opus", 24, 48000, "160")).toBeNull();
    expect(checkFormat("m4a", 24, 96000)).toMatch(/48000/);
    expect(checkFormat("wav", 24, 48000, "320")).toMatch(/--bits/);
    for (const [f, qs] of Object.entries(QUALITIES)) for (const q of qs) expect(checkFormat(f as "mp3", 24, 48000, q)).toBeNull();
  });

  it("says what was made", () => {
    expect(describeExport("mp3", 24, 48000)).toBe("MP3 · VBR V0 · 48000 Hz");
    expect(describeExport("m4a", 24, 44100)).toBe("M4A · 256 kbps · 44100 Hz");
    expect(describeExport("ogg", 24, 48000, "q8")).toBe("OGG · quality 8 · 48000 Hz");
    expect(describeExport("opus", 24, 48000)).toBe("OPUS · 128 kbps · 48000 Hz");
    expect(describeExport("wav", 32, 96000)).toBe("WAV · 32-bit float · 96000 Hz");
  });

  it("tells the user to install the pack, or that the deck is too old", async () => {
    expect(await encoderProblem({}, "mp3")).toMatch(/newer ICEBREAKER/);
    const missing = { encode: async () => new Uint8Array(), encoders: async () => ({ installed: false, supported: true, formats: [] }) };
    expect(await encoderProblem(missing, "ogg")).toMatch(/OGG needs the deck's encoder pack: run `encoders install`/);
    const elsewhere = { ...missing, encoders: async () => ({ installed: false, supported: false, formats: [] }) };
    expect(await encoderProblem(elsewhere, "mp3")).toMatch(/no encoder pack for this computer/);
    const ready = { ...missing, encoders: async () => ({ installed: true, supported: true, formats: ["mp3", "m4a", "ogg", "opus"] }) };
    expect(await encoderProblem(ready, "mp3")).toBeNull();
  });

  it("hands the pack interleaved stereo, the rate, the quality and a title", async () => {
    const l = Float32Array.from([0.1, 0.2, 0.3]), r = Float32Array.from([-0.1, -0.2, -0.3]);
    expect([...interleave({ rate: 48000, channels: [l, r] })].map((x) => +x.toFixed(2))).toEqual([0.1, -0.1, 0.2, -0.2, 0.3, -0.3]);
    expect(interleave({ rate: 48000, channels: [l] }).length).toBe(6);
    let got: { pcm: Float32Array; opts: object } | undefined;
    const audio = { encode: async (pcm: Float32Array, opts: object) => ((got = { pcm, opts }), Uint8Array.of(0x49, 0x44, 0x33)) };
    const bytes = await encodeLossy(audio, { rate: 44100, channels: [l, r] }, "mp3", "V0", "my song — bass");
    expect([...bytes]).toEqual([0x49, 0x44, 0x33]);
    expect(got!.pcm.length).toBe(6);
    expect(got!.opts).toEqual({ format: "mp3", quality: "v0", rate: 44100, channels: 2, title: "my song — bass" });
  });
});
