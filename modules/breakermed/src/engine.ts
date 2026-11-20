/**
 * breakerMED — the engine: it runs the replayer a little ahead of the sound
 * (LOOKAHEAD) and sends what it plays to the deck's sampler (ib.audio), each
 * event dated on the audio clock. The deck plays them on the exact frame, so
 * the song never stutters even when the screen is busy. It also remembers when
 * each line sounds, so the page can follow the song as it's heard.
 */
import { Player, type VoiceEvent } from "./replayer";
import type { Instrument, Song } from "./song";

/** The part of `ib` the engine uses (a test can give a fake one). */
export interface AudioPort {
  available(): boolean;
  now(): Promise<number>;
  sample(id: string, data: Float32Array, opts?: { loopStart?: number; loopLength?: number }): Promise<void>;
  drop(id?: string): Promise<void>;
  schedule(events: object[]): Promise<void>;
  stop(): Promise<void>;
}

export type PlayMode = "song" | "block";

/** seconds of song computed ahead of the sound */
const LOOKAHEAD = 0.15;
const PUMP_MS = 25;
/** how long a note played on the keyboard lasts (the deck says when a key goes down, not up) */
const PREVIEW_SECONDS = 0.6;

export interface Position {
  seq: number;
  block: number;
  line: number;
}

export class Engine {
  song: Song | null = null;
  mode: PlayMode | null = null;
  /** stepped like the Amiga's Paula (true) or smooth */
  paula = true;
  muted = new Set<number>();
  onChange?: () => void;
  private player: Player | null = null;
  private uploaded = new Map<number, Instrument>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** audio time of the next tick */
  private next = 0;
  /** audio time − performance time (s), measured at start, checked now and then */
  private skew = 0;
  private synced = 0;
  private lines: { at: number; pos: Position }[] = [];
  private busy = false;
  private previews = 0;

  constructor(private readonly audio: AudioPort) {}

  /** A new song: its instruments go to the sampler. */
  async load(song: Song): Promise<void> {
    this.stop();
    this.song = song;
    this.lines = [];
    await this.audio.drop().catch(() => {});
    this.uploaded.clear();
    await this.upload();
  }

  /** Send the instruments that changed (or every one). */
  async upload(): Promise<void> {
    const s = this.song;
    if (!s) return;
    for (let i = 0; i < s.instruments.length; i++) {
      const inst = s.instruments[i];
      if (this.uploaded.get(i) === inst) continue;
      if (inst.kind === "empty" || !inst.data.length) continue;
      await this.audio.sample(`i${i}`, inst.data, { loopStart: inst.loopStart, loopLength: inst.loopLength });
      this.uploaded.set(i, inst);
    }
  }

  get playing(): boolean {
    return this.mode !== null;
  }

  /** Play the song (or one block, again and again) from a position. */
  async play(mode: PlayMode, from: Position | { seq: number; line: number }): Promise<void> {
    const s = this.song;
    if (!s) throw new Error("no song loaded (med open <file>)");
    if (!this.audio.available()) throw new Error("no sound output here");
    this.stop();
    await this.upload();
    this.player = new Player(s, { loopBlock: mode === "block", muted: this.muted });
    this.player.jump(from.seq, from.line);
    await this.sync();
    this.next = this.audioNow() + 0.05;
    this.lines = [];
    this.mode = mode;
    this.timer = setInterval(() => void this.pump(), PUMP_MS);
    await this.pump();
    this.onChange?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const was = this.mode;
    this.mode = null;
    this.player = null;
    if (was) {
      void this.audio.stop().catch(() => {});
      this.onChange?.();
    }
  }

  /** The line being heard now (null when stopped). */
  current(): Position | null {
    if (!this.mode || !this.lines.length) return null;
    const now = this.audioNow();
    let pos = this.lines[0].pos;
    for (const l of this.lines) {
      if (l.at > now) break;
      pos = l.pos;
    }
    return pos;
  }

  /** One note now (the keyboard as a piano), on a voice past the song's tracks. */
  async preview(instrument: number, rate: number, voice?: number): Promise<void> {
    const s = this.song;
    if (!s) return;
    await this.upload();
    // four voices past the song's tracks, in turn: chords, and a note's own stop never cuts the next one
    const v = voice ?? Math.min(63, s.tracks + (this.previews++ % 4));
    if (!this.synced) await this.sync();
    // no "key released" from the deck: a looping sound stops on its own after a moment
    await this.audio.schedule([
      { voice: v, play: `i${instrument}`, offset: 0, rate, volume: 0.45, pan: 0, interp: this.paula ? "none" : "linear" },
      { at: this.audioNow() + PREVIEW_SECONDS, voice: v, stop: true },
    ]);
  }

  private audioNow(): number {
    return performance.now() / 1000 + this.skew;
  }

  private async sync(): Promise<void> {
    const before = performance.now();
    const t = await this.audio.now();
    const after = performance.now();
    this.skew = t - (before + after) / 2000;
    this.synced = after;
  }

  /** Compute what's due in the next LOOKAHEAD seconds and send it. */
  private async pump(): Promise<void> {
    if (this.busy || !this.player || !this.mode) return;
    this.busy = true;
    try {
      if (performance.now() - this.synced > 2000) await this.sync();
      const now = this.audioNow();
      // fell behind (the app slept): start again from now
      if (this.next < now - 0.2) this.next = now + 0.02;
      const out: object[] = [];
      const p = this.player;
      while (this.next < now + LOOKAHEAD && this.player === p) {
        const t = p.step();
        if (t.line) this.lines.push({ at: this.next, pos: t.line });
        for (const e of t.events) out.push(this.event(e, this.next));
        if (t.ended) {
          this.mode = null;
          break;
        }
        this.next += t.seconds;
      }
      // keep a few seconds of the timeline (what the page shows)
      while (this.lines.length > 2 && this.lines[1].at < now - 1) this.lines.shift();
      if (out.length) await this.audio.schedule(out);
      if (!this.mode) {
        // the song stopped by itself (0FFE): what's scheduled still plays out
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.player = null;
        this.onChange?.();
      }
    } finally {
      this.busy = false;
    }
  }

  private event(e: VoiceEvent, at: number): object {
    const o: Record<string, unknown> = { at, voice: e.voice };
    if (e.stop) o.stop = true;
    if (e.play !== undefined) {
      o.play = `i${e.play}`;
      o.offset = e.offset ?? 0;
      o.interp = this.paula ? "none" : "linear";
    }
    if (e.rate !== undefined) o.rate = e.rate;
    if (e.volume !== undefined) o.volume = e.volume;
    if (e.pan !== undefined) o.pan = e.pan;
    return o;
  }
}
