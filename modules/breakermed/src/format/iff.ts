/**
 * IFF 8SVX: the Amiga's sample files (FORM 8SVX: VHDR, NAME, BODY of signed
 * 8-bit frames; Fibonacci-delta packing too). The public format (EA IFF 85),
 * our own code. A loop comes from the "repeat" part.
 */
import type { Pcm } from "./wav";

export interface Iff extends Pcm {
  name: string;
  /** the repeat part, in frames (0 = none) */
  loopStart: number;
  loopLength: number;
  /** 0–64 */
  volume: number;
}

const FIB = [-34, -21, -13, -8, -5, -3, -2, -1, 0, 1, 2, 3, 5, 8, 13, 21];

export function read8svx(b: Uint8Array): Iff | null {
  if (b.length < 12) return null;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "FORM" || tag(8) !== "8SVX") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let oneShot = 0, repeat = 0, rate = 8363, comp = 0, volume = 64, name = "", body: Uint8Array | null = null;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = tag(o), len = v.getUint32(o + 4);
    const end = Math.min(b.length, o + 8 + len);
    if (id === "VHDR" && len >= 20) {
      oneShot = v.getUint32(o + 8);
      repeat = v.getUint32(o + 12);
      rate = v.getUint16(o + 20) || 8363;
      comp = b[o + 23];
      volume = Math.round((v.getUint32(o + 24) / 65536) * 64);
    } else if (id === "NAME") name = String.fromCharCode(...b.subarray(o + 8, end)).replace(/\0.*$/, "");
    else if (id === "BODY") body = b.subarray(o + 8, end);
    o += 8 + len + (len & 1);
  }
  if (!body) return null;
  let frames: Int8Array;
  if (comp === 1) {
    // Fibonacci delta: the first byte is padding, the second the start value, then two 4-bit deltas a byte
    frames = new Int8Array((body.length - 2) * 2);
    let x = (body[1] << 24) >> 24;
    for (let i = 2, k = 0; i < body.length; i++) {
      x = Math.max(-128, Math.min(127, x + FIB[body[i] >> 4]));
      frames[k++] = x;
      x = Math.max(-128, Math.min(127, x + FIB[body[i] & 15]));
      frames[k++] = x;
    }
  } else frames = new Int8Array(body.buffer, body.byteOffset, body.length);
  // the first octave only (multi-octave files hold the same sound several times)
  const len = Math.min(frames.length, oneShot + repeat || frames.length);
  const data = Float32Array.from(frames.subarray(0, len), (x) => x / 128);
  return { rate, channels: [data], name, loopStart: repeat ? oneShot : 0, loopLength: repeat, volume: Math.max(0, Math.min(64, volume)) };
}
