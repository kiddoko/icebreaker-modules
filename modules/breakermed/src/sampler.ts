/**
 * BreakerMED — the sampler's tools: plain operations on a sample's frames
 * (mono floats, -1…1), each returning a new array (the editor keeps the old
 * one for ⌘Z). No UI here (tests/sampler.test.ts).
 *
 *   chop      N equal slices, or cut at the attacks (onsets)
 *   stretch   longer or shorter, same pitch — the Amiga way: grains repeated
 *             or skipped, nothing smoothed (it grinds, on purpose)
 *   fade      in / out          pitch    resample (stepped, like Paula, or smooth)
 *   reverse   crush    fewer bits and a lower rate (the 8-bit grit, for real)
 *   normalize            trim     the silence at both ends
 */

/** frames a second a sample is meant to be heard at when played at C-3 (period 214 on the Amiga's clock) */
export const C3_RATE = 3546895 / 214;
/** our imports and bounces: twice that (and the instrument transposed an octave up), for a clean sound */
export const HQ_RATE = C3_RATE * 2;

export function chop(d: Float32Array, slices: number): Float32Array[] {
  const n = Math.max(1, Math.min(64, Math.floor(slices)));
  const len = Math.floor(d.length / n);
  return Array.from({ length: n }, (_, i) => d.slice(i * len, i === n - 1 ? d.length : (i + 1) * len));
}

/** Where the attacks are: a jump of the short-term energy over the recent average (at most `max`). */
export function onsets(d: Float32Array, max = 32, win = 256): number[] {
  const out = [0];
  let avg = 0;
  let last = 0; // the start is the first slice: the next attack comes at least 8 windows later
  for (let at = 0; at + win <= d.length; at += win) {
    let e = 0;
    for (let i = at; i < at + win; i++) e += d[i] * d[i];
    e /= win;
    if (at > 0 && e > 0.002 && e > avg * 4 && at - last > win * 8) {
      out.push(at);
      last = at;
      if (out.length >= max) break;
    }
    avg = avg * 0.9 + e * 0.1;
  }
  return out;
}

/** Cut at these frames. */
export function sliceAt(d: Float32Array, cuts: number[]): Float32Array[] {
  const c = [...new Set(cuts.filter((x) => x >= 0 && x < d.length))].sort((a, b) => a - b);
  if (!c.length || c[0] !== 0) c.unshift(0);
  return c.map((s, i) => d.slice(s, c[i + 1] ?? d.length)).filter((x) => x.length > 0);
}

/**
 * Amiga-style timestretch: the sample cut in grains of `grain` frames, each
 * played as it is, repeated or skipped to reach `factor` × the length (2 = twice
 * as long, same pitch). No crossfade: the clicks and the stutter are the sound.
 */
export function stretch(d: Float32Array, factor: number, grain = 512): Float32Array {
  const f = Math.max(0.1, Math.min(8, factor));
  const g = Math.max(16, Math.floor(grain));
  const out = new Float32Array(Math.max(1, Math.round(d.length * f)));
  for (let o = 0; o < out.length; o += g) {
    // the grain that sits at this point of the original
    const src = Math.min(d.length - 1, Math.floor(o / f / g) * g);
    for (let i = 0; i < g && o + i < out.length; i++) out[o + i] = d[Math.min(d.length - 1, src + i)];
  }
  return out;
}

export function fade(d: Float32Array, dir: "in" | "out", frames = d.length): Float32Array {
  const out = d.slice();
  const n = Math.max(1, Math.min(d.length, Math.floor(frames)));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    if (dir === "in") out[i] *= g;
    else out[d.length - 1 - i] *= g;
  }
  return out;
}

/** Resample by `ratio` (2 = an octave up: half the frames). Stepped (nearest, Paula's way) or linear. */
export function resample(d: Float32Array, ratio: number, smooth = false): Float32Array {
  const r = Math.max(1 / 16, Math.min(16, ratio));
  const out = new Float32Array(Math.max(1, Math.floor(d.length / r)));
  for (let i = 0; i < out.length; i++) {
    const p = i * r;
    const k = Math.floor(p);
    out[i] = smooth && k + 1 < d.length ? d[k] + (d[k + 1] - d[k]) * (p - k) : d[Math.min(d.length - 1, k)];
  }
  return out;
}

/** a pitch change in semitones */
export const pitch = (d: Float32Array, semitones: number, smooth = false) => resample(d, 2 ** (semitones / 12), smooth);

export function reverse(d: Float32Array): Float32Array {
  return d.slice().reverse();
}

/** Fewer bits (1–16) and a lower rate (every `hold` frames the same value): destructive, the real 8-bit grit. */
export function crush(d: Float32Array, bits = 8, hold = 1): Float32Array {
  const b = Math.max(1, Math.min(16, Math.floor(bits)));
  const h = Math.max(1, Math.min(64, Math.floor(hold)));
  const steps = 2 ** (b - 1);
  const out = new Float32Array(d.length);
  let v = 0;
  for (let i = 0; i < d.length; i++) {
    if (i % h === 0) v = Math.round(d[i] * steps) / steps;
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

export function normalize(d: Float32Array, peak = 1): Float32Array {
  let m = 0;
  for (const x of d) m = Math.max(m, Math.abs(x));
  if (m < 1e-6) return d.slice();
  const g = peak / m;
  return d.map((x) => x * g);
}

/** The silence at both ends removed (below `threshold`). Returns the frames and where they started. */
export function trim(d: Float32Array, threshold = 0.004): { data: Float32Array; start: number } {
  let a = 0, b = d.length - 1;
  while (a < d.length && Math.abs(d[a]) < threshold) a++;
  while (b > a && Math.abs(d[b]) < threshold) b--;
  return a > b ? { data: new Float32Array(0), start: 0 } : { data: d.slice(a, b + 1), start: a };
}

/** Mono from any number of channels (their average), resampled to `to` frames a second. */
export function toMono(channels: Float32Array[], rate: number, to: number): Float32Array {
  const n = channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  return Math.abs(rate - to) < 0.5 ? mono : resample(mono, rate / to, true);
}
