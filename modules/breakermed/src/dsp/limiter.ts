/**
 * BreakerMED — the last thing on the mix: a peak limiter, so a louder song never
 * clips. Below the ceiling it does nothing; a peak over it turns the gain down at
 * once (the same gain on both sides, no distortion), and the gain comes back slowly.
 */
export class Limiter {
  /** the loudest a sample may be: -1 dBFS */
  static readonly CEILING = 0.891;
  private gain = 1;
  private readonly back: number;

  constructor(rate: number, releaseSeconds = 0.15) {
    this.back = 1 - Math.exp(-1 / (releaseSeconds * rate));
  }

  /** returns the least gain it used (1: it did nothing) */
  process(left: Float32Array, right: Float32Array, from: number, to: number): number {
    const c = Limiter.CEILING;
    let g = this.gain, least = 1;
    for (let i = from; i < to; i++) {
      const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      const want = peak > c ? c / peak : 1;
      g = want < g ? want : g + (want - g) * this.back;
      left[i] *= g;
      right[i] *= g;
      if (g < least) least = g;
    }
    this.gain = g;
    return least;
  }
}
