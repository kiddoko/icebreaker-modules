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
  private previews: { voice: Voice; until: number }[] = [];
  private nextPreview = 0;
  /** frames left in the current tick (and the fraction carried, so ticks don't drift) */
  private tickLeft = 0;
  private carry = 0;

  constructor(
    readonly song: Song,
    readonly rate: number,
    public paula = true,
  ) {}

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

  get playing(): boolean {
    return !!this.player && !this.ended;
  }

  /** something to hear: the song, or a key still ringing */
  get busy(): boolean {
    return this.playing || this.previews.some((p) => p.voice.on && p.until > this.frame) || this.voices.some((v) => v?.on);
  }

  /** A key played now: instrument `inst` at `rate`, for `seconds` at most (no key-up from the deck). */
  preview(inst: number, rate: number, seconds = 0.6): void {
    const instrument = this.song.instruments[inst];
    if (!instrument || instrument.kind === "empty") return;
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
      for (const p of this.previews) {
        if (!p) continue;
        if (p.until <= this.frame + at) p.voice.stop();
        else p.voice.render(left, right, at, at + Math.min(span, p.until - (this.frame + at)));
      }
      at += span;
      this.tickLeft -= span;
    }
    this.frame += n;
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
      const v = voiceFor(instrument, this.rate, this.paula);
      v.start({ instrument, rate: e.rate ?? 8363, offset: e.offset ?? 0 });
      this.voices[e.voice] = v;
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
