/**
 * AIFF (16 / 24-bit integers) and AIFF-C (32-bit float, "fl32"): Apple's
 * uncompressed format, big-endian. The public format, our own code.
 */
import type { Pcm } from "./wav";

/** an IEEE 754 80-bit extended number (AIFF's sample rate; whole rates below 2³² are exact) */
function extended(n: number): Uint8Array {
  const out = new Uint8Array(10);
  if (n <= 0) return out;
  const e = Math.floor(Math.log2(n));
  const exp = e + 16383;
  out[0] = (exp >> 8) & 0x7f;
  out[1] = exp & 255;
  // the 64-bit mantissa, its integer bit explicit: n × 2^(63 − e); the top 32 bits hold a whole rate
  const hi = Math.floor(n * 2 ** (31 - e));
  out[2] = (hi >>> 24) & 255;
  out[3] = (hi >>> 16) & 255;
  out[4] = (hi >>> 8) & 255;
  out[5] = hi & 255;
  return out;
}

export function writeAiff(pcm: Pcm, bits: 16 | 24 | 32 = 16): Uint8Array {
  const ch = Math.max(1, pcm.channels.length);
  const frames = pcm.channels[0]?.length ?? 0;
  const float = bits === 32;
  const bytes = bits / 8;
  const comm = float ? 18 + 4 + 14 : 18; // AIFF-C adds the compression type and its name (pascal string, even)
  const data = frames * ch * bytes;
  const size = 4 + (8 + comm) + (8 + 8 + data) + (float ? 12 : 0);
  const out = new Uint8Array(8 + size);
  const v = new DataView(out.buffer);
  let o = 0;
  const tag = (s: string) => [...s].forEach((c) => v.setUint8(o++, c.charCodeAt(0)));
  const u32 = (x: number) => (v.setUint32(o, x), (o += 4));
  const u16 = (x: number) => (v.setUint16(o, x), (o += 2));
  tag("FORM");
  u32(size);
  tag(float ? "AIFC" : "AIFF");
  if (float) {
    tag("FVER");
    u32(4);
    u32(0xa2805140); // AIFF-C version 1
  }
  tag("COMM");
  u32(comm);
  u16(ch);
  u32(frames);
  u16(bits);
  out.set(extended(pcm.rate), o);
  o += 10;
  if (float) {
    tag("fl32");
    out[o++] = 12;
    tag("32-bit float");
    out[o++] = 0; // pad to even
  }
  tag("SSND");
  u32(8 + data);
  u32(0);
  u32(0);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < ch; c++) {
      const x = pcm.channels[c]?.[i] ?? 0;
      const s = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
      if (float) v.setFloat32(o, s);
      else if (bits === 16) v.setInt16(o, Math.round(s * 32767));
      else {
        const n = Math.round(s * 8388607);
        out[o] = (n >> 16) & 255;
        out[o + 1] = (n >> 8) & 255;
        out[o + 2] = n & 255;
      }
      o += bytes;
    }
  return out;
}

/** an 80-bit extended number back (AIFF's sample rate) */
function fromExtended(b: Uint8Array, o: number): number {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  let mant = 0;
  for (let i = 0; i < 8; i++) mant = mant * 256 + b[o + 2 + i];
  return exp === 0 && mant === 0 ? 0 : mant * 2 ** (exp - 16383 - 63);
}

/** Read an AIFF / AIFF-C file (integers, "sowt" little-endian, 32/64-bit float); null when it isn't one. */
export function readAiff(b: Uint8Array): Pcm | null {
  if (b.length < 12) return null;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "FORM" || (tag(8) !== "AIFF" && tag(8) !== "AIFC")) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let ch = 0, frames = 0, bits = 0, rate = 0, comp = "NONE", data = -1;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = tag(o), len = v.getUint32(o + 4);
    if (id === "COMM" && o + 26 <= b.length) {
      ch = v.getUint16(o + 8);
      frames = v.getUint32(o + 10);
      bits = v.getUint16(o + 14);
      rate = fromExtended(b, o + 16);
      if (tag(8) === "AIFC" && len >= 22) comp = tag(o + 26);
    } else if (id === "SSND") data = o + 16 + v.getUint32(o + 8);
    o += 8 + len + (len & 1);
  }
  if (data < 0 || !ch || !rate) return null;
  const float = comp === "fl32" || comp === "FL32" || comp === "fl64";
  const little = comp === "sowt";
  if (!float && !little && comp !== "NONE" && comp !== "twos") return null;
  const bytes = comp === "fl64" ? 8 : float ? 4 : Math.ceil(bits / 8);
  const n = Math.min(frames, Math.floor((b.length - data) / (bytes * ch)));
  const channels = Array.from({ length: ch }, () => new Float32Array(n));
  let o = data;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      let x: number;
      if (float) x = bytes === 8 ? v.getFloat64(o) : v.getFloat32(o);
      else if (bytes === 1) x = v.getInt8(o) / 128;
      else if (bytes === 2) x = v.getInt16(o, little) / 32768;
      else if (bytes === 3) x = little ? (((b[o + 2] << 24) | (b[o + 1] << 16) | (b[o] << 8)) >> 8) / 8388608 : (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8)) >> 8) / 8388608;
      else x = v.getInt32(o, little) / 2147483648;
      channels[c][i] = x === x ? x : 0;
      o += bytes;
    }
  return { rate, channels };
}
