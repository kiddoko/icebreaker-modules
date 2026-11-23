/**
 * BreakerMED — the engine: it computes the sound here, in the module (the
 * renderer: render.ts), and hands it to the deck through ib.audio.stream. The
 * deck asks for more whenever it runs low (~16 ms left): about 30 ms from a key
 * to the sound, and a song that never stutters. It also knows which line is
 * being heard (what was written minus what still waits), for the page to follow.
 */
import { Renderer } from "./render";
import type { Song } from "./song";

/** The deck's end of the sound line (ib.audio.stream; a test gives a fake one). */
export interface StreamLike {
  rate: number;
  low: number;
  high: number;
  onPull?: (frames: number, played: number, buffered: number) => void;
  write(left: Float32Array, right: Float32Array): void;
  close(): void;
}

/** The part of `ib.audio` the engine uses. */
export interface AudioPort {
  available(): boolean;
  stream(): Promise<StreamLike>;
  stop(): Promise<void>;
}

export type PlayMode = "song" | "block";

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
  /** a click on each beat while playing (med click) */
  metronome = false;
  onChange?: () => void;
  private line: StreamLike | null = null;
  private opening: Promise<StreamLike> | null = null;
  private r: Renderer | null = null;
  /** at the last request: frames written then, frames still waiting, when (ms) */
  private clock = { written: 0, waiting: 0, at: 0 };

  constructor(private readonly audio: AudioPort) {}

  /** A new song (nothing to upload: the module plays its instruments itself). */
  async load(song: Song): Promise<void> {
    this.stop();
    this.song = song;
    this.r = null;
  }

  get playing(): boolean {
    return this.mode !== null;
  }

  /** Play the song (or one block, again and again) from a position. */
  async play(mode: PlayMode, from: { seq: number; line: number }): Promise<void> {
    if (!this.song) throw new Error("no song loaded (med open <file>)");
    if (!this.audio.available()) throw new Error("no sound output here");
    const r = await this.renderer();
    // (what's still waiting from before — 30 ms at most — plays out: a flush through the deck
    // could arrive after the new frames, which go straight to the node)
    r.paula = this.paula;
    r.metronome = this.metronome;
    r.play(from.seq, from.line, { loopBlock: mode === "block", muted: this.muted });
    this.mode = mode;
    this.push(this.line!.high);
    this.onChange?.();
  }

  stop(): void {
    const was = this.mode;
    this.mode = null;
    this.r?.stop();
    if (was) {
      void this.audio.stop().catch(() => {});
      this.onChange?.();
    }
  }

  /** The deck silenced us (`audio stop`, the ♪): the song stops and nothing rings on. */
  silence(): void {
    this.stop();
    this.r?.silence();
  }

  /** the keys' notes let go (space, stopped) · true: something was ringing */
  hush(): boolean {
    const was = !!this.r?.ringing;
    this.r?.hush();
    return was;
  }

  /** The line being heard now (null when stopped). */
  current(): Position | null {
    const r = this.r;
    if (!this.mode || !r || !r.marks.length || !this.line) return null;
    const heard = Math.min(r.frame, this.clock.written - this.clock.waiting + ((performance.now() - this.clock.at) / 1000) * this.line.rate);
    let pos: Position = r.marks[0];
    for (const m of r.marks) {
      if (m.frame > heard) break;
      pos = m;
    }
    return { seq: pos.seq, block: pos.block, line: pos.line };
  }

  /** the frame being heard now (what was written, less what still waits) */
  private heard(): number {
    const r = this.r;
    if (!r || !this.line) return 0;
    return Math.min(r.frame, this.clock.written - this.clock.waiting + ((performance.now() - this.clock.at) / 1000) * this.line.rate);
  }

  /** each track's meter (0–1): its last note, fading over ~0.4 s; null when stopped */
  levels(): number[] | null {
    const r = this.r;
    if (!this.mode || !r || !this.line || !this.song) return null;
    const now = this.heard(), rate = this.line.rate;
    return Array.from({ length: this.song.tracks }, (_, t) => {
      const h = r.hits[t];
      if (!h || this.muted.has(t) || h.frame > now) return 0;
      return h.vol * Math.exp(-((now - h.frame) / rate) * 6);
    });
  }

  /** the mix since the last call: its peak (0–1) and how much the limiter took (dB, ≥ 0) */
  master(): { peak: number; limitDb: number } | null {
    const r = this.r;
    if (!this.mode || !r) return null;
    const m = { peak: r.meter.peak, limitDb: -20 * Math.log10(Math.max(1e-6, r.meter.gain)) };
    r.meter = { peak: 0, gain: 1 };
    return m;
  }

  /** A key played on the piano: instrument `inst` at `rate`, heard ~30 ms later. */
  async preview(inst: number, rate: number): Promise<void> {
    if (!this.song) return;
    const r = await this.renderer();
    r.paula = this.paula;
    r.preview(inst, rate);
    // right away, not at the next request: the line may be idle
    if (!this.mode) this.push(this.line!.high);
  }

  /** the renderer for this song at the line's rate (the line opens the first time) */
  private async renderer(): Promise<Renderer> {
    const line = await this.open();
    if (!this.r || this.r.song !== this.song || this.r.rate !== line.rate) this.r = new Renderer(this.song!, line.rate, this.paula);
    return this.r;
  }

  private open(): Promise<StreamLike> {
    if (this.line) return Promise.resolve(this.line);
    this.opening ??= this.audio.stream().then(
      (s) => {
        s.onPull = (frames, _played, waiting) => this.pull(frames, waiting);
        this.line = s;
        return s;
      },
      (e) => {
        this.opening = null;
        throw e;
      },
    );
    return this.opening;
  }

  /** the deck wants more: what it asks for, while there's something to hear */
  private pull(frames: number, waiting: number): void {
    const r = this.r;
    if (!r) return;
    this.clock = { written: r.frame, waiting, at: performance.now() };
    if (!r.busy) {
      if (this.mode && r.ended) {
        this.mode = null;
        this.onChange?.();
      }
      return; // nothing to hear: the deck asks again a little later
    }
    this.push(frames);
  }

  private push(frames: number): void {
    const r = this.r, line = this.line;
    if (!r || !line || frames <= 0) return;
    const n = Math.min(16384, Math.ceil(frames));
    const left = new Float32Array(n), right = new Float32Array(n);
    r.render(left, right, n);
    line.write(left, right);
  }
}
