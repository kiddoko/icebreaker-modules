import { describe, expect, it } from "vitest";
import { demoMod } from "../src/demo";
import { encode, renderSong, trackUsed } from "../src/export";
import { readSong } from "../src/format";
import { writeAiff } from "../src/format/aiff";
import { writeFlac } from "../src/format/flac";
import { songLength } from "../src/replayer";

/** A small FLAC reader for what our encoder writes (FIXED / VERBATIM, one Rice partition), checking every CRC. */
function readFlac(b: Uint8Array): { rate: number; bits: number; channels: Int32Array[] } {
  let pos = 0, bit = 0;
  const get = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = v * 2 + ((b[pos] >> (7 - bit)) & 1);
      if (++bit === 8) (bit = 0), pos++;
    }
    return v;
  };
  const signed = (n: number) => {
    const v = get(n);
    return v >= 2 ** (n - 1) ? v - 2 ** n : v;
  };
  const align = () => {
    if (bit) (bit = 0), pos++;
  };
  const crc8 = (from: number, to: number) => {
    let c = 0;
    for (let i = from; i < to; i++) {
      c ^= b[i];
      for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255;
    }
    return c;
  };
  const crc16 = (from: number, to: number) => {
    let c = 0;
    for (let i = from; i < to; i++) {
      c ^= b[i] << 8;
      for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
    }
    return c;
  };
  expect(String.fromCharCode(...b.slice(0, 4))).toBe("fLaC");
  pos = 4;
  expect(get(8)).toBe(0x80);
  expect(get(24)).toBe(34);
  get(16), get(16), get(24), get(24);
  const rate = get(20), ch = get(3) + 1, bits = get(5) + 1;
  const total = get(36);
  pos += 16; // MD5
  const out = Array.from({ length: ch }, () => new Int32Array(total));
  let done = 0;
  while (done < total) {
    const start = pos;
    expect(get(16)).toBe(0xfff8);
    const bsCode = get(4);
    get(4), get(4), get(3), get(1);
    let first = get(8);
    while ((first & 0xc0) === 0xc0) (first <<= 1), get(8); // the frame number's extra bytes
    const size = bsCode === 12 ? 4096 : get(16) + 1;
    const hdrEnd = pos;
    expect(get(8)).toBe(crc8(start, hdrEnd));
    for (let c = 0; c < ch; c++) {
      const head = get(8);
      const type = head >> 1;
      const x = out[c].subarray(done, done + size);
      if (type === 1) for (let i = 0; i < size; i++) x[i] = signed(bits);
      else {
        expect(type & 0b111000).toBe(0b001000);
        const order = type & 7;
        for (let i = 0; i < order; i++) x[i] = signed(bits);
        expect(get(2)).toBe(0);
        expect(get(4)).toBe(0);
        const k = get(4);
        for (let i = order; i < size; i++) {
          let q = 0;
          while (get(1) === 0) q++;
          const u = q * 2 ** k + (k ? get(k) : 0);
          const r = u & 1 ? -(u + 1) / 2 : u / 2;
          const p = order === 0 ? 0 : order === 1 ? x[i - 1] : order === 2 ? 2 * x[i - 1] - x[i - 2] : order === 3 ? 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3] : 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
          x[i] = p + r;
        }
      }
    }
    align();
    const end = pos;
    expect(get(16)).toBe(crc16(start, end));
    done += size;
  }
  return { rate, bits, channels: out };
}

describe("BreakerMED: FLAC", () => {
  it("what we write reads back exactly (16 and 24 bits, blocks and the last short one)", () => {
    const n = 10_000;
    const l = Float32Array.from({ length: n }, (_, i) => 0.6 * Math.sin(i / 7) + (i % 97 === 0 ? 0.3 : 0));
    const r = Float32Array.from({ length: n }, (_, i) => ((i * 7919) % 2000) / 1000 - 1); // noise-like: verbatim wins
    for (const bits of [16, 24] as const) {
      const back = readFlac(writeFlac({ rate: 48000, channels: [l, r] }, bits));
      expect([back.rate, back.bits, back.channels.length]).toEqual([48000, bits, 2]);
      const max = 2 ** (bits - 1) - 1;
      [l, r].forEach((c, k) => c.forEach((x, i) => expect(back.channels[k][i]).toBe(Math.max(-max - 1, Math.min(max, Math.round(x * max))))));
    }
  });

  it("is smaller than a WAV for music", () => {
    const pcm = { rate: 44100, channels: [Float32Array.from({ length: 44100 }, (_, i) => 0.5 * Math.sin(i / 20)), Float32Array.from({ length: 44100 }, (_, i) => 0.5 * Math.sin(i / 21))] };
    expect(writeFlac(pcm, 16).length).toBeLessThan(44100 * 4 * 0.5);
  });
});

describe("BreakerMED: AIFF", () => {
  it("a FORM with COMM (rate as an 80-bit number) and SSND; AIFF-C for 32-bit float", () => {
    const pcm = { rate: 44100, channels: [Float32Array.from([0, 0.5, -0.5])] };
    const a = writeAiff(pcm, 16);
    const tag = (o: number) => String.fromCharCode(...a.slice(o, o + 4));
    expect([tag(0), tag(8), tag(12)]).toEqual(["FORM", "AIFF", "COMM"]);
    const v = new DataView(a.buffer);
    expect(v.getUint32(4)).toBe(a.length - 8);
    expect([v.getUint16(20), v.getUint32(22), v.getUint16(26)]).toEqual([1, 3, 16]);
    // 44100 Hz as an 80-bit extended number: 0x400E AC44 0000 0000 0000
    expect([...a.slice(28, 34)].map((x) => x.toString(16).padStart(2, "0")).join("")).toBe("400eac440000");
    expect(v.getInt16(54 + 2)).toBe(Math.round(0.5 * 32767));
    const f = writeAiff(pcm, 32);
    expect(String.fromCharCode(...f.slice(8, 12))).toBe("AIFC");
    expect(String.fromCharCode(...f.slice(12, 16))).toBe("FVER");
  });
});

describe("BreakerMED: rendering an export", () => {
  it("lasts the song once through plus its tail, at the rate asked", async () => {
    const song = readSong(demoMod());
    const pcm = await renderSong(song, { rate: 22050, bits: 16, paula: true, tail: 1 });
    expect(pcm.channels[0].length).toBe(Math.ceil(songLength(song).seconds * 22050) + 22050);
    expect(Math.max(...pcm.channels[0].slice(0, 22050).map(Math.abs))).toBeGreaterThan(0.05);
    expect(Math.abs(pcm.channels[0][pcm.channels[0].length - 1])).toBeLessThan(1e-3); // faded out
  });

  it("a stem holds one track; normalize peaks at -0.3 dB", async () => {
    const song = readSong(demoMod());
    expect([0, 1, 2, 3].map((t) => trackUsed(song, t))).toEqual([true, true, true, true]);
    const kick = await renderSong(song, { rate: 22050, bits: 16, paula: true, solo: [2], tail: 0.5 });
    const all = await renderSong(song, { rate: 22050, bits: 16, paula: true, tail: 0.5 });
    const energy = (p: { channels: Float32Array[] }) => p.channels[0].reduce((s, x) => s + x * x, 0);
    expect(energy(kick)).toBeLessThan(energy(all));
    expect(energy(kick)).toBeGreaterThan(0);
    const loud = await renderSong(song, { rate: 22050, bits: 16, paula: true, normalize: true, tail: 0.5 });
    const peak = Math.max(...loud.channels.map((c) => c.reduce((m, x) => Math.max(m, Math.abs(x)), 0)));
    expect(peak).toBeCloseTo(0.966, 3);
    expect(encode(loud, "flac", 16).slice(0, 4)).toEqual(new TextEncoder().encode("fLaC"));
  });
});
