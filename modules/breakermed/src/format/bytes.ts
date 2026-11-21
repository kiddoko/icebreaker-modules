/**
 * Reading and writing big-endian files (the Amiga's order), bounds-checked:
 * a broken or hostile file throws a clear error, never reads past its end.
 */

export class Reader {
  pos = 0;
  constructor(readonly b: Uint8Array) {}

  get length(): number {
    return this.b.length;
  }
  can(n: number, at = this.pos): boolean {
    return at >= 0 && n >= 0 && at + n <= this.b.length;
  }
  need(n: number, at = this.pos, what = "data"): void {
    if (!this.can(n, at)) throw new Error(`the file ends too early (${what} at ${at})`);
  }
  seek(at: number): this {
    if (at < 0 || at > this.b.length) throw new Error(`a pointer leads out of the file (${at})`);
    this.pos = at;
    return this;
  }
  u8(): number {
    this.need(1);
    return this.b[this.pos++];
  }
  s8(): number {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }
  u16(): number {
    this.need(2);
    const v = (this.b[this.pos] << 8) | this.b[this.pos + 1];
    this.pos += 2;
    return v;
  }
  s16(): number {
    const v = this.u16();
    return v > 32767 ? v - 65536 : v;
  }
  u32(): number {
    this.need(4);
    const v = ((this.b[this.pos] << 24) >>> 0) + (this.b[this.pos + 1] << 16) + (this.b[this.pos + 2] << 8) + this.b[this.pos + 3];
    this.pos += 4;
    return v;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** a fixed-size text field (stops at the first 0), Latin-1 like the Amiga's */
  text(n: number): string {
    const raw = this.bytes(n);
    let s = "";
    for (const c of raw) {
      if (!c) break;
      s += c < 32 ? " " : String.fromCharCode(c);
    }
    return s.trimEnd();
  }
}

/** Signed 8-bit sample bytes → floats. */
export function s8ToFloats(raw: Uint8Array): Float32Array {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = (raw[i] > 127 ? raw[i] - 256 : raw[i]) / 128;
  return out;
}

/** Signed 16-bit big-endian sample bytes → floats. */
export function s16beToFloats(raw: Uint8Array): Float32Array {
  const out = new Float32Array(raw.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = (raw[2 * i] << 8) | raw[2 * i + 1];
    out[i] = (v > 32767 ? v - 65536 : v) / 32768;
  }
  return out;
}

/** OctaMED's "delta" samples: each byte is the difference from the previous one. */
export function undelta8(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(raw.length);
  let acc = 0;
  for (let i = 0; i < raw.length; i++) out[i] = acc = (acc + raw[i]) & 0xff;
  return out;
}

export class Writer {
  private buf = new Uint8Array(1024);
  pos = 0;

  private room(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }
  u8(v: number): this {
    this.room(1);
    this.buf[this.pos++] = v & 0xff;
    return this;
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v);
  }
  u32(v: number): this {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff);
  }
  bytes(b: Uint8Array): this {
    this.room(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  /** a fixed-size text field, padded with zeros */
  text(s: string, n: number): this {
    for (let i = 0; i < n; i++) this.u8(i < s.length ? Math.min(255, s.charCodeAt(i)) : 0);
    return this;
  }
  zeros(n: number): this {
    this.room(n);
    this.buf.fill(0, this.pos, this.pos + n);
    this.pos += n;
    return this;
  }
  /** go back and write a 32-bit value (a pointer known later) */
  patch32(at: number, v: number): void {
    const here = this.pos;
    this.pos = at;
    this.u32(v);
    this.pos = here;
  }
  align(n = 2): this {
    while (this.pos % n) this.u8(0);
    return this;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Floats → signed 8-bit bytes (rounded, clipped). */
export function floatsToS8(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(-128, Math.min(127, Math.round(f[i] * 128))) & 0xff;
  return out;
}

/** Floats → signed 16-bit big-endian bytes. */
export function floatsToS16be(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length * 2);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32768))) & 0xffff;
    out[2 * i] = v >> 8;
    out[2 * i + 1] = v & 0xff;
  }
  return out;
}
