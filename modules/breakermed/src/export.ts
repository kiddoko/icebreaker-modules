/**
 * breakerMED — exports: the song computed again, here, at the rate you choose
 * (independent of the sound card), as fast as the computer goes, then written
 * as WAV (16 / 24 bits, 32-bit float), AIFF or FLAC — or, through the deck's
 * encoder pack (`encoders install`, then ib.audio.encode), MP3, M4A, OGG or Opus.
 * The master, or one track alone (a stem): the same renderer as what you hear,
 * so the file is what you heard.
 */
import { writeAiff } from "./format/aiff";
import { writeFlac } from "./format/flac";
import { writeWav, type Pcm } from "./format/wav";
import { Renderer } from "./render";
import { songLength } from "./replayer";
import type { Song } from "./song";

export type LossyFormat = "mp3" | "m4a" | "ogg" | "opus";
export type ExportFormat = "wav" | "aiff" | "flac" | LossyFormat;
export const RATES = [22050, 32000, 44100, 48000, 88200, 96000];

/** the formats the deck's encoder pack makes, their qualities (the first is the default) */
export const QUALITIES: Record<LossyFormat, string[]> = {
  mp3: ["v0", "v2", "128", "192", "256", "320"],
  m4a: ["256", "192", "128"],
  ogg: ["q6", "q4", "q8"],
  opus: ["128", "96", "160"],
};
export const isLossy = (f: string): f is LossyFormat => f in QUALITIES;

/** a file name's format: .wav .aif .aiff .flac .mp3 .m4a .ogg .opus (none: WAV) */
export function formatOf(path: string): ExportFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (!ext) return "wav";
  if (ext === "aif" || ext === "aiff") return "aiff";
  return ext === "wav" || ext === "flac" || isLossy(ext) ? (ext as ExportFormat) : null;
}

/** the extension a format's files get */
export const extOf = (f: ExportFormat): string => (f === "aiff" ? "aif" : f);

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
  /** the limiter (and DC blocker) on the mix: on for a master, off for stems (they then add up to the mix) */
  limit?: boolean;
}

/** what a format can do (`quality`: only for MP3, M4A, OGG, Opus; "" = the default) */
export function checkFormat(format: ExportFormat, bits: number, rate: number, quality = ""): string | null {
  if (format === "flac" && bits === 32) return "FLAC goes up to 24 bits (32-bit float: WAV or AIFF)";
  if (!RATES.includes(rate)) return `a rate among ${RATES.join(", ")}`;
  if (isLossy(format)) {
    if (rate > 48000) return `${format.toUpperCase()} goes up to 48000 Hz`;
    if (quality && !QUALITIES[format].includes(quality.toLowerCase())) return `${format.toUpperCase()} quality ${QUALITIES[format].join(", ")} (default ${QUALITIES[format][0]})`;
  } else if (quality) return "--quality is for MP3, M4A, OGG and Opus (WAV, AIFF, FLAC: --bits)";
  return null;
}

/** what an export in this format is, for the last line ("MP3 · v0 · 48000 Hz") */
export function describe(format: ExportFormat, bits: number, rate: number, quality = ""): string {
  if (!isLossy(format)) return `${format.toUpperCase()} · ${bits === 32 ? "32-bit float" : `${bits} bits`} · ${rate} Hz`;
  const q = (quality || QUALITIES[format][0]).toLowerCase();
  const shown = /^\d+$/.test(q) ? `${q} kbps` : format === "mp3" ? `VBR ${q.toUpperCase()}` : `quality ${q.slice(1)}`;
  return `${format.toUpperCase()} · ${shown} · ${format === "opus" ? 48000 : rate} Hz`;
}

/** left and right as one interleaved array (what the encoder pack reads) */
export function interleave(pcm: Pcm): Float32Array {
  const [l, r = l] = pcm.channels;
  const out = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) (out[2 * i] = l[i]), (out[2 * i + 1] = r[i]);
  return out;
}

/** the deck's encoder pack, as breakerMED sees it */
export interface Encoder {
  encode?(pcm: Float32Array, opts: { format: LossyFormat; quality?: string; rate: number; channels: 1 | 2; title?: string }): Promise<Uint8Array>;
  encoders?(): Promise<{ installed: boolean; supported: boolean; formats: string[] }>;
}

/** why a lossy export can't happen here (null: it can) */
export async function encoderProblem(audio: Encoder, format: LossyFormat): Promise<string | null> {
  if (!audio.encode || !audio.encoders) return `${format.toUpperCase()} needs a newer ICEBREAKER (with the encoder pack) — WAV, AIFF and FLAC work here`;
  const e = await audio.encoders();
  if (!e.supported) return `there's no encoder pack for this computer yet — WAV, AIFF and FLAC work here`;
  if (!e.installed) return `${format.toUpperCase()} needs the deck's encoder pack: run \`encoders install\` (once, ~3 MB), then export again`;
  return null;
}

/** an MP3 / M4A / OGG / Opus file's bytes, through the deck's encoder pack */
export async function encodeLossy(audio: Encoder, pcm: Pcm, format: LossyFormat, quality: string, title: string): Promise<Uint8Array> {
  return audio.encode!(interleave(pcm), { format, quality: quality.toLowerCase(), rate: pcm.rate, channels: 2, title });
}

/** The song as sound: once through, plus its tail. `onProgress(0…1)`; it yields now and then. */
export async function renderSong(song: Song, o: ExportOptions, onProgress?: (done: number) => void): Promise<Pcm> {
  const r = new Renderer(song, o.rate, o.paula);
  r.limit = o.limit !== false;
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

export function encode(pcm: Pcm, format: "wav" | "aiff" | "flac", bits: 16 | 24 | 32, dither = true): Uint8Array {
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
