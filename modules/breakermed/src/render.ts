/**
 * breakerMED — the renderer: the song turned into sound, frame by frame, here
 * in the module (the deck only plays what we hand it: ib.audio.stream). The
 * replayer says what each track does on each tick; the renderer starts and
 * changes the voices exactly on the tick's first frame and mixes them.
 *
 * The same code plays the song, previews the keys (a few voices past the
 * tracks) and, later, writes the exports (a rate of our choosing, as fast as
 * the computer goes, one track alone for a stem).
 */
import { Player, type PlayOptions, type VoiceEvent } from "./replayer";
import type { Song } from "./song";
import { voiceFor, type Voice } from "./dsp/voice";
import { C3_RATE } from "./dsp/analog";
import { DrumVoice, drumOf } from "./dsp/drums";

export interface LineMark {
  /** the frame (since this renderer started) the line begins on */
  frame: number;
  seq: number;
  block: number;
  line: number;
}

/** keys played on the piano: a few voices of their own, in turn */
const PREVIEWS = 4;

export class Renderer {
  /** frames written so far */
  frame = 0;
  /** where each line began (the page follows the one being heard) */
  marks: LineMark[] = [];
  ended = false;
  private player: Player | null = null;
  private voices: (Voice | null)[] = [];
  private previews: { voice: Voice; until: number; released?: boolean }[] = [];
  /** voices still releasing after their track moved on (a synth's tail) */
  private tails: Voice[] = [];
  private nextPreview = 0;
  /** the A500's "LED" filter: a 12 dB low-pass at ~3.3 kHz, on when the song says (0FF9 / med filter on) */
  private led = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x: [0, 0, 0, 0], y: [0, 0, 0, 0] };
  /** frames left in the current tick (and the fraction carried, so ticks don't drift) */
  private tickLeft = 0;
  private carry = 0;

  constructor(
    readonly song: Song,
    readonly rate: number,
    public paula = true,
  ) {
    // a Butterworth low-pass (two poles) at 3275 Hz, the LED filter's corner
    const w = Math.tan((Math.PI * Math.min(3275, rate * 0.45)) / rate);
    const n = 1 / (1 + Math.SQRT2 * w + w * w);
    this.led.b0 = w * w * n;
    this.led.b1 = 2 * this.led.b0;
    this.led.b2 = this.led.b0;
    this.led.a1 = 2 * (w * w - 1) * n;
    this.led.a2 = (1 - Math.SQRT2 * w + w * w) * n;
  }

  /** Play from a position (the song, or one block again and again). */
  play(seq: number, line: number, opts: PlayOptions = {}): void {
    this.player = new Player(this.song, opts);
    this.player.jump(seq, line);
    this.tickLeft = 0;
    this.carry = 0;
    this.ended = false;
    for (const v of this.voices) v?.stop();
  }

  stop(): void {
    this.player = null;
    for (const v of this.voices) v?.stop();
  }

  /** The song ends here, but what's ringing keeps ringing (an export's tail). */
  finish(): void {
    this.player = null;
  }

  get playing(): boolean {
    return !!this.player && !this.ended;
  }

  /** something to hear: the song, or a key still ringing */
  get busy(): boolean {
    return this.playing || this.previews.some((p) => p?.voice.on) || this.voices.some((v) => v?.on) || this.tails.length > 0;
  }

  /** A key played now: instrument `inst` at `rate`, for `seconds` at most (no key-up from the deck). */
  preview(inst: number, rate: number, seconds = 0.6): void {
    const instrument = this.song.instruments[inst];
    if (!instrument || instrument.kind === "empty") return;
    if (instrument.kind === "drums") seconds = 10; // a drum isn't held: it rings out on its own
    const slot = this.nextPreview++ % PREVIEWS;
    const voice = voiceFor(instrument, this.rate, this.paula);
    voice.start({ instrument, rate, offset: 0 });
    voice.set(rate, 0.45 * instrument.gain * (instrument.volume / 64), 0);
    this.previews[slot] = { voice, until: this.frame + Math.round(seconds * this.rate) };
  }

  /** The next `n` frames, added into left / right (they start at zero). */
  render(left: Float32Array, right: Float32Array, n = left.length): void {
    let at = 0;
    while (at < n) {
      if (this.player && !this.ended && this.tickLeft <= 0) this.tick(at);
      const span = this.player && !this.ended ? Math.min(n - at, Math.max(1, this.tickLeft)) : n - at;
      for (const v of this.voices) v?.render(left, right, at, at + span);
      for (const v of this.tails) v.render(left, right, at, at + span);
      if (this.tails.length) this.tails = this.tails.filter((v) => v.on);
      for (const p of this.previews) {
        if (!p) continue;
        if (!p.released && p.until <= this.frame + at) (p.voice.stop(), (p.released = true));
        if (p.voice.on) p.voice.render(left, right, at, at + span);
      }
      if (this.song.flags.filter) this.filter(left, right, at, at + span);
      at += span;
      this.tickLeft -= span;
    }
    this.frame += n;
  }

  private filter(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const f = this.led;
    const [xl1, xl2, yl1, yl2] = [f.x[0], f.x[1], f.y[0], f.y[1]];
    let a = xl1, b = xl2, c = yl1, d = yl2;
    for (let i = from; i < to; i++) {
      const x = left[i];
      const y = f.b0 * x + f.b1 * a + f.b2 * b - f.a1 * c - f.a2 * d;
      b = a, a = x, d = c, c = y;
      left[i] = y;
    }
    f.x[0] = a, f.x[1] = b, f.y[0] = c, f.y[1] = d;
    let e = f.x[2], g = f.x[3], h = f.y[2], k = f.y[3];
    for (let i = from; i < to; i++) {
      const x = right[i];
      const y = f.b0 * x + f.b1 * e + f.b2 * g - f.a1 * h - f.a2 * k;
      g = e, e = x, k = h, h = y;
      right[i] = y;
    }
    f.x[2] = e, f.x[3] = g, f.y[2] = h, f.y[3] = k;
  }

  private tick(at: number): void {
    const p = this.player!;
    const t = p.step();
    if (t.line) this.marks.push({ frame: this.frame + at, ...t.line });
    for (const e of t.events) this.apply(e);
    if (t.ended) {
      this.ended = true;
      return;
    }
    const exact = t.seconds * this.rate + this.carry;
    this.tickLeft = Math.max(1, Math.floor(exact));
    this.carry = exact - this.tickLeft;
    // keep the last few seconds of marks only
    if (this.marks.length > 512) this.marks.splice(0, this.marks.length - 256);
  }

  private apply(e: VoiceEvent): void {
    if (e.stop) {
      this.voices[e.voice]?.stop();
      return;
    }
    if (e.play !== undefined) {
      const instrument = this.song.instruments[e.play];
      if (!instrument) return;
      const old = this.voices[e.voice] as (Voice & { instrument?: unknown }) | null | undefined;
      // a synth with glide slides from its last note: the same voice goes on
      if (old?.on && instrument.kind === "analog" && old.instrument === instrument && (instrument.synth?.glide ?? 0) > 0) {
        old.start({ instrument, rate: e.rate ?? 8363, offset: 0 });
      } else {
        // what was playing on the track rings on (a synth's release, a drum's tail), then the new note
        if (old?.on && old.rings) {
          if (!(old instanceof DrumVoice)) old.stop(); // a synth releases; a drum rings out as it is
          if (old instanceof DrumVoice && instrument.kind === "drums" && old.chokedBy(drumOf(e.rate ?? 8363, C3_RATE))) old.kill();
          if (old.on && this.tails.length < 32) this.tails.push(old);
        }
        const v = voiceFor(instrument, this.rate, this.paula) as Voice & { instrument?: unknown };
        v.instrument = instrument;
        v.start({ instrument, rate: e.rate ?? 8363, offset: e.offset ?? 0 });
        this.voices[e.voice] = v;
      }
    }
    const v = this.voices[e.voice];
    if (!v) return;
    const s = v as Voice & { lastRate?: number; lastVol?: number; lastPan?: number };
    s.lastRate = e.rate ?? s.lastRate ?? 8363;
    s.lastVol = e.volume ?? s.lastVol ?? 0;
    s.lastPan = e.pan ?? s.lastPan ?? 0;
    v.set(s.lastRate, s.lastVol, s.lastPan);
  }
}
