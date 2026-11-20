/**
 * FLAC (lossless, 16 or 24 bits): the public format (xiph.org), our own small
 * encoder. Each block of 4096 frames, each channel: the best of FLAC's fixed
 * predictors (order 0–4), its residual Rice-coded in one partition — or the
 * samples as they are when that's smaller. No MD5 (allowed: "unknown"). Any
 * player reads it; it's about half the size of a WAV.
 */
import type { Pcm } from "./wav";

const BLOCK = 4096;

class Bits {
  private buf = new Uint8Array(1 << 16);
  private len = 0; // bytes done
  private acc = 0; // bits waiting (up to 32)
  private n = 0;

  private room(extra: number): void {
    if (this.len + extra + 8 <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra + 8) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  /** write the low `count` bits of `v` (count ≤ 24 at a time) */
  put(v: number, count: number): void {
    if (count > 24) {
      this.put(Math.floor(v / 2 ** 24) & ((1 << (count - 24)) - 1), count - 24);
      this.put(v & 0xffffff, 24);
      return;
    }
    this.room(4);
    this.acc = (this.acc << count) | (v & ((1 << count) - 1));
    this.n += count;
    while (this.n >= 8) {
      this.n -= 8;
      this.buf[this.len++] = (this.acc >>> this.n) & 255;
    }
    this.acc &= (1 << this.n) - 1;
  }
  /** a signed value in `count` bits (two's complement) */
  putSigned(v: number, count: number): void {
    this.put(v < 0 ? v + 2 ** count : v, count);
  }
  /** q zeros then a one */
  unary(q: number): void {
    while (q >= 24) (this.put(0, 24), (q -= 24));
    this.put(1, q + 1);
  }
  align(): void {
    if (this.n) this.put(0, 8 - this.n);
  }
  get bytes(): number {
    return this.len;
  }
  slice(from: number, to = this.len): Uint8Array {
    return this.buf.slice(from, to);
  }
  done(): Uint8Array {
    this.align();
    return this.buf.slice(0, this.len);
  }
}

function crc8(b: Uint8Array): number {
  let c = 0;
  for (const x of b) {
    c ^= x;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
  }
  return c;
}

function crc16(b: Uint8Array): number {
  let c = 0;
  for (const x of b) {
    c ^= x << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

/** the residual of FLAC's fixed predictor of this order */
function residual(x: Int32Array, order: number): Int32Array {
  const r = new Int32Array(x.length - order);
  for (let i = order; i < x.length; i++) {
    const p = order === 0 ? 0 : order === 1 ? x[i - 1] : order === 2 ? 2 * x[i - 1] - x[i - 2] : order === 3 ? 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3] : 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
    r[i - order] = x[i] - p;
  }
  return r;
}

const zigzag = (v: number) => (v >= 0 ? 2 * v : -2 * v - 1);

/** the best Rice parameter for these values, and how many bits they take with it */
function rice(r: Int32Array): { k: number; bits: number } {
  let sum = 0;
  for (const v of r) sum += zigzag(v);
  let best = { k: 0, bits: Infinity };
  const guess = Math.max(0, Math.floor(Math.log2(Math.max(1, sum / Math.max(1, r.length)))));
  for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 2); k++) {
    let bits = 0;
    for (const v of r) bits += Math.floor(zigzag(v) / 2 ** k) + 1 + k;
    if (bits < best.bits) best = { k, bits };
  }
  return best;
}

function subframe(w: Bits, x: Int32Array, bps: number): void {
  let best: { order: number; k: number; bits: number; r: Int32Array } | null = null;
  for (let order = 0; order <= Math.min(4, x.length - 1); order++) {
    const r = residual(x, order);
    const { k, bits } = rice(r);
    const total = 8 + order * bps + 2 + 4 + 4 + bits;
    if (!best || total < best.bits) best = { order, k, bits: total, r };
  }
  const verbatim = 8 + x.length * bps;
  if (!best || best.bits >= verbatim || best.k > 14) {
    w.put(0b00000010, 8); // VERBATIM
    for (const v of x) w.putSigned(v, bps);
    return;
  }
  w.put((0b001000 | best.order) << 1, 8); // FIXED, this order, no wasted bits
  for (let i = 0; i < best.order; i++) w.putSigned(x[i], bps);
  w.put(0, 2); // Rice, 4-bit parameters
  w.put(0, 4); // partition order 0: one partition
  w.put(best.k, 4);
  for (const v of best.r) {
    const u = zigzag(v);
    w.unary(Math.floor(u / 2 ** best.k));
    if (best.k) w.put(u & ((1 << best.k) - 1), best.k);
  }
}

/** a frame number the way FLAC writes it (like UTF-8) */
function utf8(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 63)];
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
  return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
}

export function writeFlac(pcm: Pcm, bits: 16 | 24 = 16): Uint8Array {
  const ch = Math.max(1, Math.min(8, pcm.channels.length));
  const frames = pcm.channels[0]?.length ?? 0;
  const max = 2 ** (bits - 1) - 1;
  const w = new Bits();
  // "fLaC", then STREAMINFO (the last metadata block)
  for (const c of "fLaC") w.put(c.charCodeAt(0), 8);
  w.put(0x80, 8);
  w.put(34, 24);
  w.put(BLOCK, 16);
  w.put(BLOCK, 16);
  w.put(0, 24);
  w.put(0, 24);
  w.put(Math.round(pcm.rate), 20);
  w.put(ch - 1, 3);
  w.put(bits - 1, 5);
  w.put(Math.floor(frames / 2 ** 32), 4);
  w.put(Math.floor(frames / 2 ** 16) & 0xffff, 16);
  w.put(frames & 0xffff, 16);
  for (let i = 0; i < 16; i++) w.put(0, 8); // MD5 unknown
  const ints = pcm.channels.slice(0, ch).map((c) => Int32Array.from(c, (x) => Math.max(-max - 1, Math.min(max, Math.round((x === x ? x : 0) * max)))));
  for (let start = 0, n = 0; start < frames; start += BLOCK, n++) {
    const size = Math.min(BLOCK, frames - start);
    const frameAt = w.bytes;
    w.put(0xfff8, 16); // sync, fixed blocking
    w.put(size === BLOCK ? 12 : 7, 4); // 4096, or the size follows (16 bits)
    w.put(0, 4); // sample rate: as in STREAMINFO
    w.put(ch - 1, 4); // independent channels
    w.put(0, 3); // sample size: as in STREAMINFO
    w.put(0, 1);
    for (const b of utf8(n)) w.put(b, 8);
    if (size !== BLOCK) w.put(size - 1, 16);
    w.put(crc8(w.slice(frameAt)), 8);
    for (let c = 0; c < ch; c++) subframe(w, ints[c].subarray(start, start + size), bits);
    w.align();
    w.put(crc16(w.slice(frameAt)), 16);
  }
  return w.done();
}
