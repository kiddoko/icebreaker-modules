/**
 * breakerMED — exports: the song computed again, here, at the rate you choose
 * (independent of the sound card), as fast as the computer goes, then written
 * as WAV (16 / 24 bits, 32-bit float), AIFF or FLAC. The master, or one track
 * alone (a stem): the same renderer as what you hear, so the file is what you
 * heard. MP3 / M4A / OGG come later (the deck's encoder pack).
 */
import { writeAiff } from "./format/aiff";
import { writeFlac } from "./format/flac";
import { writeWav, type Pcm } from "./format/wav";
import { Renderer } from "./render";
import { songLength } from "./replayer";
import type { Song } from "./song";

export type ExportFormat = "wav" | "aiff" | "flac";
export const RATES = [22050, 32000, 44100, 48000, 88200, 96000];

export interface ExportOptions {
  rate: number;
  bits: 16 | 24 | 32;
  /** stepped like Paula, or smooth */
  paula: boolean;
  /** only these tracks sound (a stem); none = all */
  solo?: number[];
  /** muted on the page: they stay silent in the master too */
  muted?: ReadonlySet<number>;
  /** seconds after the end for what still rings (then a short fade) */
  tail?: number;
  /** peak at -0.3 dB */
  normalize?: boolean;
}

/** what a format can do */
export function checkFormat(format: ExportFormat, bits: number, rate: number): string | null {
  if (format === "flac" && bits === 32) return "FLAC goes up to 24 bits (32-bit float: WAV or AIFF)";
  if (!RATES.includes(rate)) return `a rate among ${RATES.join(", ")}`;
  return null;
}

/** The song as sound: once through, plus its tail. `onProgress(0…1)`; it yields now and then. */
export async function renderSong(song: Song, o: ExportOptions, onProgress?: (done: number) => void): Promise<Pcm> {
  const r = new Renderer(song, o.rate, o.paula);
  const muted = new Set<number>(o.muted ?? []);
  if (o.solo?.length) for (let t = 0; t < song.tracks; t++) if (!o.solo.includes(t)) muted.add(t);
  r.play(0, 0, { muted });
  const body = Math.ceil(songLength(song).seconds * o.rate);
  const tail = Math.round((o.tail ?? 1.5) * o.rate);
  const total = body + tail;
  const left = new Float32Array(total), right = new Float32Array(total);
  const CHUNK = 8192;
  let lastYield = 0;
  for (let at = 0, n = 0; at < total; at += n) {
    if (at === body) r.finish();
    n = Math.min(CHUNK, at < body ? body - at : total - at);
    const l = new Float32Array(n), rr = new Float32Array(n);
    r.render(l, rr, n);
    left.set(l, at);
    right.set(rr, at);
    if (at - lastYield > o.rate / 2) {
      lastYield = at;
      onProgress?.(at / total);
      await new Promise((ok) => setTimeout(ok, 0));
    }
  }
  // the tail fades out over its last half second (a looped sample would ring forever)
  const fade = Math.min(tail, Math.round(0.5 * o.rate));
  for (let i = 0; i < fade; i++) {
    const g = 1 - i / fade;
    left[total - fade + i] *= g;
    right[total - fade + i] *= g;
  }
  if (o.normalize) {
    let peak = 0;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    if (peak > 1e-6) {
      const g = 0.966 / peak; // -0.3 dB
      for (let i = 0; i < total; i++) (left[i] *= g), (right[i] *= g);
    }
  }
  onProgress?.(1);
  return { rate: o.rate, channels: [left, right] };
}

/** 16 bits: a whisper of noise (TPDF dither) so quiet passages don't turn to grit — unless you asked for grit */
function dither16(pcm: Pcm): void {
  let seed = 22222;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const lsb = 1 / 32768;
  for (const c of pcm.channels) for (let i = 0; i < c.length; i++) c[i] += (rnd() - rnd()) * lsb;
}

export function encode(pcm: Pcm, format: ExportFormat, bits: 16 | 24 | 32, dither = true): Uint8Array {
  if (bits === 16 && dither) dither16(pcm);
  if (format === "aiff") return writeAiff(pcm, bits);
  if (format === "flac") return writeFlac(pcm, bits === 32 ? 24 : bits);
  return writeWav(pcm, bits);
}

/** Does this track play anything (a stem worth writing)? */
export function trackUsed(song: Song, t: number): boolean {
  const used = new Set(song.sequence);
  return song.blocks.some((b, n) => used.has(n) && b.cells.some((row) => !!row[t]?.note));
}
