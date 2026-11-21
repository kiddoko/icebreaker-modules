/**
 * WAV files (RIFF, little-endian): writing (16 / 24 bits, 32-bit float) and
 * reading (8 / 16 / 24 / 32 bits, 32 / 64-bit float, any number of channels).
 * The public format, our own code; used for the samples of a .bmed song and
 * for the exports.
 */

export interface Pcm {
  rate: number;
  /** one array a channel, -1…1 */
  channels: Float32Array[];
}

export type WavBits = 16 | 24 | 32;

/** A WAV file: 16 or 24-bit integers, or 32-bit floats. */
export function writeWav(pcm: Pcm, bits: WavBits = 16): Uint8Array {
  const ch = Math.max(1, pcm.channels.length);
  const frames = pcm.channels[0]?.length ?? 0;
  const bytes = bits / 8;
  const float = bits === 32;
  const dataLen = frames * ch * bytes;
  const out = new Uint8Array(44 + dataLen);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, Math.round(pcm.rate), true);
  v.setUint32(28, Math.round(pcm.rate) * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bits, true);
  tag(36, "data");
  v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < ch; c++) {
      const x = pcm.channels[c]?.[i] ?? 0;
      const s = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
      if (float) v.setFloat32(o, s, true);
      else if (bits === 16) v.setInt16(o, Math.round(s * 32767), true);
      else {
        const n = Math.round(s * 8388607);
        v.setUint8(o, n & 255);
        v.setUint8(o + 1, (n >> 8) & 255);
        v.setUint8(o + 2, (n >> 16) & 255);
      }
      o += bytes;
    }
  return out;
}

/** Read a WAV file (null when it isn't one we can read). */
export function readWav(b: Uint8Array): Pcm | null {
  if (b.length < 12) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let fmt = 0, ch = 0, rate = 0, bits = 0, data = -1, dataLen = 0;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = tag(o);
    const len = v.getUint32(o + 4, true);
    if (id === "fmt " && o + 24 <= b.length) {
      fmt = v.getUint16(o + 8, true);
      ch = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format
      if (fmt === 0xfffe && len >= 40 && o + 34 <= b.length) fmt = v.getUint16(o + 32, true);
    } else if (id === "data") {
      data = o + 8;
      dataLen = Math.min(len, b.length - data);
      break;
    }
    o += 8 + len + (len & 1);
  }
  if (data < 0 || !ch || !rate || !(fmt === 1 || fmt === 3)) return null;
  const bytes = bits / 8;
  if (![1, 2, 3, 4, 8].includes(bytes) || (fmt === 3 && bytes < 4)) return null;
  const frames = Math.floor(dataLen / (bytes * ch));
  const channels = Array.from({ length: ch }, () => new Float32Array(frames));
  let o = data;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < ch; c++) {
      let x: number;
      if (fmt === 3) x = bytes === 8 ? v.getFloat64(o, true) : v.getFloat32(o, true);
      else if (bytes === 1) x = (b[o] - 128) / 128;
      else if (bytes === 2) x = v.getInt16(o, true) / 32768;
      else if (bytes === 3) x = (((b[o + 2] << 24) | (b[o + 1] << 16) | (b[o] << 8)) >> 8) / 8388608;
      else x = v.getInt32(o, true) / 2147483648;
      channels[c][i] = x === x ? x : 0;
      o += bytes;
    }
  return { rate, channels };
}
