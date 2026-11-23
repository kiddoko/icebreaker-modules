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
import { ECHO_MAX_MS, MAX_CHORD_NOTES, type Echo, type Song } from "./song";
import { voiceFor, type Voice } from "./dsp/voice";
import { C3_RATE } from "./dsp/analog";
import { Limiter } from "./dsp/limiter";
import { DrumVoice, drumOf } from "./dsp/drums";
import { ChipVoice } from "./dsp/chip";

export interface LineMark {
  /** the frame (since this renderer started) the line begins on */
  frame: number;
  seq: number;
  block: number;
  line: number;
}

/** keys played on the piano: a few voices of their own, in turn */
const PREVIEWS = 4;
/** a key played alone: about as loud as a note of the song */
const PREVIEW_GAIN = 0.7;

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
  /** each track's chord: the extra voices over its note, and their intervals */
  private chordVoices: Voice[][] = [];
  private chordSteps: number[][] = [];
  private nextPreview = 0;
  /** the A500's "LED" filter: a 12 dB low-pass at ~3.3 kHz, on when the song says (0FF9 / med filter on) */
  private led = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x: [0, 0, 0, 0], y: [0, 0, 0, 0] };
  /** frames left in the current tick (and the fraction carried, so ticks don't drift) */
  private tickLeft = 0;
  /** the mix's last stage: loud, never clipping */
  private readonly limiter: Limiter;
  /** the mix's last stage on: the DC blocker and the limiter (tests of the echo or the mix turn it off to measure them) */
  limit = true;
  private carry = 0;
  /** the metronome: a click on each beat (live only: an export never has it) */
  metronome = false;
  private click = { left: 0, phase: 0, step: 0, gain: 0 };
  /** a DC blocker a side, before the limiter (a ~10 Hz high-pass: no offset in the mix) */
  private dc = { xl: 0, yl: 0, xr: 0, yr: 0, k: 0 };
  /** each track's last note: when (frame) and how loud (0–1), for the page's meters */
  hits: { frame: number; vol: number }[] = [];
  /** the mix after the limiter: its peak and the limiter's least gain since the page last asked */
  meter = { peak: 0, gain: 1 };

  constructor(
    readonly song: Song,
    readonly rate: number,
    public paula = true,
  ) {
    this.limiter = new Limiter(rate);
    this.dc.k = 1 - (2 * Math.PI * 10) / rate;
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
    this.stopAll();
  }

  stop(): void {
    this.player = null;
    this.stopAll();
  }

  /** Everything quiet now: no song, no note ringing, no echo (the deck silenced us). */
  silence(): void {
    this.player = null;
    this.voices = [];
    this.tails = [];
    this.chordVoices = [];
    this.chordSteps = [];
    this.previews = [];
    this.echoL = this.echoR = null;
    this.dc = { xl: 0, yl: 0, xr: 0, yr: 0, k: this.dc.k };
    this.click.left = 0;
  }

  private stopAll(): void {
    for (const v of this.voices) v?.stop();
    for (const list of this.chordVoices) for (const v of list ?? []) v.stop();
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
    return this.playing || this.previews.some((p) => p?.voice.on) || this.voices.some((v) => v?.on) || this.tails.length > 0 || this.chordVoices.some((l) => l?.some((v) => v.on)) || this.echoing();
  }

  /** A key played now: instrument `inst` at `rate`, for `seconds` at most (no key-up from the deck). */
  preview(inst: number, rate: number, seconds = 0.6): void {
    const instrument = this.song.instruments[inst];
    if (!instrument || instrument.kind === "empty") return;
    if (instrument.kind === "drums") seconds = 10; // a drum isn't held: it rings out on its own
    const slot = this.nextPreview++ % PREVIEWS;
    const voice = voiceFor(instrument, this.rate, this.paula);
    voice.start({ instrument, rate, offset: 0 });
    voice.set(rate, PREVIEW_GAIN * instrument.gain * (instrument.volume / 64), 0);
    this.previews[slot] = { voice, until: this.frame + Math.round(seconds * this.rate) };
  }

  /** The next `n` frames, added into left / right (they start at zero). */
  render(left: Float32Array, right: Float32Array, n = left.length): void {
    let at = 0;
    while (at < n) {
      if (this.player && !this.ended && this.tickLeft <= 0) this.tick(at);
      const span = this.player && !this.ended ? Math.min(n - at, Math.max(1, this.tickLeft)) : n - at;
      for (const v of this.voices) v?.render(left, right, at, at + span);
      for (const list of this.chordVoices) for (const v of list ?? []) v.render(left, right, at, at + span);
      for (const v of this.tails) v.render(left, right, at, at + span);
      if (this.tails.length) this.tails = this.tails.filter((v) => v.on);
      for (const p of this.previews) {
        if (!p) continue;
        if (!p.released && p.until <= this.frame + at) (p.voice.stop(), (p.released = true));
        if (p.voice.on) p.voice.render(left, right, at, at + span);
      }
      if (this.song.flags.filter) this.filter(left, right, at, at + span);
      if (this.song.echo) this.echo(left, right, at, at + span, this.song.echo);
      else if (this.echoL) this.echoL = this.echoR = null; // off: the next echo starts clean
      if (this.limit) {
        this.dcBlock(left, right, at, at + span);
        const g = this.limiter.process(left, right, at, at + span);
        if (g < this.meter.gain) this.meter.gain = g;
      }
      if (this.click.left > 0) this.clickInto(left, right, at, at + span);
      for (let i = at; i < at + span; i++) {
        const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
        if (a > this.meter.peak) this.meter.peak = a;
      }
      at += span;
      this.tickLeft -= span;
    }
    this.frame += n;
  }

  /** y = x − x₁ + k·y₁ on each side: takes out an offset (DC) a sound may have, and nothing one can hear */
  private dcBlock(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const d = this.dc;
    let { xl, yl, xr, yr } = d;
    for (let i = from; i < to; i++) {
      const l = left[i], r = right[i];
      yl = l - xl + d.k * yl;
      xl = l;
      yr = r - xr + d.k * yr;
      xr = r;
      left[i] = yl;
      right[i] = yr;
    }
    Object.assign(d, { xl, yl, xr, yr });
  }

  /** the metronome's click: 25 ms of a sine, higher on the bar's first beat */
  private clickInto(left: Float32Array, right: Float32Array, from: number, to: number): void {
    const c = this.click;
    const len = Math.round(this.rate * 0.025);
    for (let i = from; i < to && c.left > 0; i++, c.left--) {
      const env = c.left / len;
      const x = Math.sin(c.phase) * c.gain * env * env;
      c.phase += c.step;
      left[i] += x;
      right[i] += x;
    }
  }

  /** OctaMED's echo: a delay line a side, fed back softer each time (cross: from one side to the other) */
  private echoL: Float32Array | null = null;
  private echoR: Float32Array | null = null;
  private echoAt = 0;
  private echo(left: Float32Array, right: Float32Array, from: number, to: number, e: Echo): void {
    const size = Math.ceil((ECHO_MAX_MS / 1000) * this.rate) + 1;
    if (!this.echoL) (this.echoL = new Float32Array(size)), (this.echoR = new Float32Array(size));
    const bl = this.echoL, br = this.echoR!;
    const delay = Math.max(1, Math.min(size - 1, Math.round((e.ms / 1000) * this.rate)));
    const g = 2 ** -e.depth;
    const cross = e.type === "cross";
    let w = this.echoAt;
    for (let i = from; i < to; i++) {
      const r = (w - delay + size) % size;
      const dl = bl[r], dr = br[r];
      const yl = left[i] + dl, yr = right[i] + dr;
      left[i] = yl;
      right[i] = yr;
      // what comes back next time: this sound, softer (cross: the other side's)
      bl[w] = (cross ? yr : yl) * g;
      br[w] = (cross ? yl : yr) * g;
      w = (w + 1) % size;
    }
    this.echoAt = w;
  }

  /** something still echoing (the song stopped, the echo rings on) */
  private echoing(): boolean {
    if (!this.song.echo || !this.echoL) return false;
    for (let i = 0; i < this.echoL.length; i += 64) if (Math.abs(this.echoL[i]) > 1e-4 || Math.abs(this.echoR![i]) > 1e-4) return true;
    return false;
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
    if (t.line) {
      this.marks.push({ frame: this.frame + at, ...t.line });
      const lpb = Math.max(1, this.song.lpb);
      if (this.metronome && t.line.line % lpb === 0) {
        const bar = t.line.line % (lpb * 4) === 0;
        this.click = { left: Math.round(this.rate * 0.025), phase: 0, step: (2 * Math.PI * (bar ? 1760 : 1320)) / this.rate, gain: bar ? 0.35 : 0.22 };
      }
    }
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
      for (const v of this.chordVoices[e.voice] ?? []) v.stop();
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
      // the page's meter: this track just played a note, this loud
      this.hits[e.voice] = { frame: this.frame, vol: Math.max(0, Math.min(1, (this.song.trackVolume[e.voice] ?? 64) / 64)) };
      // the chord: the old one's notes let go (or ring on), the new one's start with the note
      for (const old of this.chordVoices[e.voice] ?? []) {
        if (!old.on || !old.rings) continue;
        if (!(old instanceof DrumVoice || (old instanceof Strummed && old.inner instanceof DrumVoice))) old.stop();
        if (old.on && this.tails.length < 32) this.tails.push(old);
      }
      let steps = (e.chord ?? []).slice(0, MAX_CHORD_NOTES);
      // a chip with its arpeggio on plays the chord itself, one note after the other (the chiptune way)
      const main = this.voices[e.voice];
      if (steps.length && main instanceof ChipVoice && (instrument.chip?.arp ?? 0) > 0) {
        main.arpeggio(steps);
        steps = [];
      }
      this.chordSteps[e.voice] = steps;
      // strummed: each note of the chord a little after the one under it
      const strum = Math.round(((this.song.trackStrum?.[e.voice] ?? 0) / 1000) * this.rate);
      const order = steps.map((st, i) => ({ st, i })).sort((a, b) => a.st - b.st);
      this.chordVoices[e.voice] = steps.map((st, i) => {
        const cv = voiceFor(instrument, this.rate, this.paula);
        cv.start({ instrument, rate: (e.rate ?? 8363) * 2 ** (st / 12), offset: e.offset ?? 0 });
        if (!strum) return cv;
        // the notes under the written one come before it, the ones over it after
        const rank = order.findIndex((o) => o.i === i), below = order.filter((o) => o.st < 0).length;
        return rank < below ? cv : new Strummed(cv, (rank - below + 1) * strum);
      });
    }
    const v = this.voices[e.voice];
    if (!v) return;
    const s = v as Voice & { lastRate?: number; lastVol?: number; lastPan?: number };
    s.lastRate = e.rate ?? s.lastRate ?? 8363;
    s.lastVol = e.volume ?? s.lastVol ?? 0;
    s.lastPan = e.pan ?? s.lastPan ?? 0;
    // a chord's notes follow the note (slides, vibrato, volume, place); together about as loud as one
    const chord = this.chordVoices[e.voice] ?? [];
    const k = chord.length ? 1 / Math.sqrt(1 + chord.length) : 1;
    v.set(s.lastRate, s.lastVol * k, s.lastPan);
    chord.forEach((cv, i) => cv.set(s.lastRate! * 2 ** ((this.chordSteps[e.voice]?.[i] ?? 0) / 12), s.lastVol! * k, s.lastPan!));
  }
}

/** A chord's note that starts `wait` frames late (a strum): silent until then, the same voice after. */
export class Strummed implements Voice {
  constructor(
    readonly inner: Voice,
    private wait: number,
  ) {}
  /** let go before it was heard: it never will be */
  private dead = false;
  get on(): boolean {
    return !this.dead && (this.wait > 0 || this.inner.on);
  }
  get rings(): boolean | undefined {
    return this.inner.rings;
  }
  start(n: Parameters<Voice["start"]>[0]): void {
    this.inner.start(n);
  }
  set(rate: number, volume: number, pan: number): void {
    this.inner.set(rate, volume, pan);
  }
  stop(): void {
    if (this.wait > 0) this.dead = true;
    this.inner.stop();
  }
  render(left: Float32Array, right: Float32Array, from: number, to: number): void {
    if (this.dead) return;
    if (this.wait >= to - from) return void (this.wait -= to - from);
    const start = from + this.wait;
    this.wait = 0;
    this.inner.render(left, right, start, to);
  }
}
