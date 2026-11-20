/**
 * breakerMED — the replayer: it reads a song tick by tick, the way OctaMED and
 * ProTracker do, and says what each voice does (start this instrument, at
 * this speed, this loud, there). No sound and no clock here: `step()` gives
 * one tick and how long it lasts; engine.ts dates those and sends them to the
 * deck's sampler (ib.audio). So it runs the same in a test.
 *
 * A line is `speed` ticks. On a line's first tick the notes start and the
 * one-off commands act; the slides, vibratos and arpeggios move on the other
 * ticks (on every tick, the first too, in OctaMED's own slide mode).
 *
 * Commands, in OctaMED's numbering (hex):
 *   00 arpeggio · 01/02 slide up/down · 03 slide to note · 04 vibrato (twice
 *   ProTracker's depth) · 05 03 + volume slide · 06 04 + volume slide · 07 tremolo ·
 *   09 speed (ticks a line) · 0A / 0D volume slide · 0B jump to a position ·
 *   0C volume · 0F tempo, 0F00 next block, 0FF1 note twice, 0FF2 half a line
 *   late, 0FF3 three times, 0FF8/9 filter, 0FFE stop, 0FFF note off ·
 *   11/12 fine slide · 14 vibrato (ProTracker's) · 15 finetune · 16 loop ·
 *   18 cut the note · 19 sample offset · 1A/1B fine volume · 1D next block at a
 *   line · 1E repeat the line · 1F note delay / retrigger · 2E pan.
 * Not yet: 08 hold/decay (the instrument's own hold/decay works), 0E synth jump,
 * 20 reverse, the synth instruments' programs, MIDI.
 */
import { NOTE_OFF, PAULA_CLOCK, periodOf, ptBpmOf, type Instrument, type Song } from "./song";

/** What a voice does on a tick: only what changed. */
export interface VoiceEvent {
  voice: number;
  /** start this instrument (its index in song.instruments) from `offset` frames */
  play?: number;
  offset?: number;
  /** frames a second */
  rate?: number;
  /** 0…1 */
  volume?: number;
  pan?: number;
  stop?: boolean;
}

export interface Tick {
  seconds: number;
  events: VoiceEvent[];
  /** the line this tick belongs to (on its first tick) */
  line?: { seq: number; block: number; line: number };
  /** the song went back to its start (or jumped back): it has been heard whole */
  wrapped?: boolean;
  /** 0FFE: the song stops here */
  ended?: boolean;
}

const SINE = [0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253, 255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24];

interface Chan {
  inst: number;
  semi: number;
  period: number;
  target: number;
  portaSpeed: number;
  volume: number;
  finetune: number;
  vibPos: number;
  vibSpeed: number;
  vibDepth: number;
  vibShift: number;
  tremPos: number;
  tremSpeed: number;
  tremDepth: number;
  pan: number;
  offsetMem: number;
  /** a note waiting for its tick (note delay) */
  delayed: { tick: number; note: number; inst: number; porta: boolean } | null;
  cutAt: number;
  retrig: number;
  loopLine: number;
  loopCount: number;
  /** ticks since the note started (hold / decay) */
  age: number;
  /** on, as far as the replayer knows */
  on: boolean;
  /** what was sent last (to send only changes) */
  sent: { rate: number; volume: number; pan: number };
}

export interface PlayOptions {
  /** play one block again and again (the editor's "play block") */
  loopBlock?: boolean;
  /** tracks that make no sound */
  muted?: ReadonlySet<number>;
}

export class Player {
  seq = 0;
  line = 0;
  tick = 0;
  speed: number;
  tempo: number;
  /** a tempo OctaMED's 0F01 / 0F02 set (as ProTracker BPM), else null */
  private bpmOverride: number | null = null;
  private chans: Chan[];
  private delayLines = 0;
  private breakTo: number | null = null;
  private jumpTo: number | null = null;
  private stopped = false;
  private readonly mix: number;

  constructor(readonly song: Song, readonly opts: PlayOptions = {}) {
    this.speed = song.speed;
    this.tempo = song.tempo;
    this.chans = Array.from({ length: song.tracks }, (_, i) => this.newChan(i));
    // headroom: four Amiga voices at full volume make a full signal
    this.mix = 0.5 * Math.min(1, 2 / Math.sqrt(Math.max(4, song.tracks)));
  }

  private newChan(i: number): Chan {
    return { inst: 0, semi: 0, period: 0, target: 0, portaSpeed: 0, volume: 64, finetune: 0, vibPos: 0, vibSpeed: 0, vibDepth: 0, vibShift: 7, tremPos: 0, tremSpeed: 0, tremDepth: 0, pan: this.song.trackPan[i] ?? 0, offsetMem: 0, delayed: null, cutAt: -1, retrig: 0, loopLine: 0, loopCount: 0, age: 0, on: false, sent: { rate: -1, volume: -1, pan: -2 } };
  }

  /** Start (again) from a position. */
  jump(seq: number, line = 0): void {
    this.seq = Math.max(0, Math.min(this.song.sequence.length - 1, seq));
    this.line = line;
    this.tick = 0;
    this.delayLines = 0;
    this.breakTo = this.jumpTo = null;
    this.stopped = false;
  }

  get block(): number {
    return this.song.sequence[this.seq] ?? 0;
  }

  get tickSeconds(): number {
    const f = this.song.flags;
    return 2.5 / (this.bpmOverride ?? ptBpmOf(this.song.tempoMode, this.tempo, this.song.lpb, f.eightChannel, f.hardwareMix));
  }

  /** Silence everything (the events to send). */
  silence(): VoiceEvent[] {
    return this.chans.map((c, voice) => ((c.on = false), (c.sent = { rate: -1, volume: -1, pan: -2 }), { voice, stop: true }));
  }

  /** One tick: what the voices do, and how long it lasts. */
  step(): Tick {
    const out: Tick = { seconds: this.tickSeconds, events: [] };
    if (this.stopped) return { ...out, ended: true };
    const triggers = new Map<number, number>();
    if (this.tick === 0 && this.delayLines === 0) {
      out.line = { seq: this.seq, block: this.block, line: this.line };
      this.readLine(triggers);
    } else this.effects(triggers);
    this.voices(out.events, triggers);
    out.seconds = this.tickSeconds;
    // next tick, next line
    if (++this.tick >= this.speed) {
      this.tick = 0;
      if (this.delayLines > 0) this.delayLines--;
      if (this.delayLines === 0) this.advance(out);
    }
    if (this.stopped) out.ended = true;
    return out;
  }

  private cells() {
    return this.song.blocks[this.block]?.cells[this.line] ?? [];
  }

  private inst(c: Chan): Instrument | undefined {
    return this.song.instruments[c.inst - 1];
  }

  /** a note number → the semitone it plays (0 = C-1), the Amiga's octave folding included */
  private semiOf(note: number, inst: Instrument | undefined): number {
    let s = note - 1 + this.song.transpose + this.song.noteShift + (inst?.transpose ?? 0);
    if (this.song.format.startsWith("MMD")) {
      const top = this.song.flags.hardwareMix ? 36 : 48;
      if (s >= top) s -= Math.floor((s - top + 12) / 12) * 12;
    }
    return s;
  }

  private readLine(triggers: Map<number, number>): void {
    const f = this.song.flags;
    this.cells().forEach((cell, t) => {
      const c = this.chans[t];
      if (!c) return;
      c.cutAt = -1;
      c.retrig = 0;
      // the commands of every page
      let porta = false;
      let delay = 0;
      for (let p = 0; p < cell.cmd.length; p++) {
        const cmd = cell.cmd[p], v = cell.val[p];
        if (cmd === 0x03 || cmd === 0x05) porta = true;
        if (cmd === 0x1f && v >> 4) delay = v >> 4;
        if (cmd === 0x0f && v === 0xf2) delay = this.speed >> 1;
      }
      if (delay && delay < this.speed && (cell.note || cell.inst)) {
        c.delayed = { tick: delay, note: cell.note, inst: cell.inst, porta };
      } else this.noteOn(c, t, cell.note, cell.inst, porta, triggers);
      for (let p = 0; p < cell.cmd.length; p++) this.lineCommand(c, t, cell.cmd[p], cell.val[p], !!cell.note, triggers);
      if (!f.ptSlides) this.slides(c, cell.cmd, cell.val, true);
    });
  }

  private noteOn(c: Chan, t: number, note: number, instNo: number, porta: boolean, triggers: Map<number, number>): void {
    if (instNo) {
      c.inst = instNo;
      const inst = this.inst(c);
      c.volume = inst?.volume ?? 64;
      c.finetune = inst?.finetune ?? 0;
    }
    if (note === NOTE_OFF) {
      c.on = false;
      triggers.set(t, -1);
      return;
    }
    if (!note) return;
    const inst = this.inst(c);
    const semi = this.semiOf(note, inst);
    const period = periodOf(semi, c.finetune);
    if (porta && c.on) {
      c.target = period;
      return;
    }
    c.semi = semi;
    c.period = c.target = period;
    c.vibPos = c.tremPos = 0;
    c.age = 0;
    if (inst && inst.kind !== "empty" && inst.data.length) {
      c.on = true;
      triggers.set(t, 0);
    } else {
      c.on = false;
      triggers.set(t, -1);
    }
  }

  private lineCommand(c: Chan, t: number, cmd: number, v: number, hasNote: boolean, triggers: Map<number, number>): void {
    const f = this.song.flags;
    switch (cmd) {
      case 0x03: if (v) c.portaSpeed = v; break;
      case 0x04: if (v >> 4) c.vibSpeed = v >> 4; if (v & 15) c.vibDepth = v & 15; c.vibShift = 6; break;
      case 0x14: if (v >> 4) c.vibSpeed = v >> 4; if (v & 15) c.vibDepth = v & 15; c.vibShift = 7; break;
      case 0x07: if (v >> 4) c.tremSpeed = v >> 4; if (v & 15) c.tremDepth = v & 15; break;
      case 0x09: if (v > 0 && v <= 0x20) this.speed = v; break;
      case 0x0b: this.jumpTo = v; this.breakTo ??= 0; break;
      case 0x0c: {
        let vol: number;
        if (f.vol7bit) vol = ((v & 0x7f) + 1) >> 1;
        else if (f.volHex) vol = Math.min(64, v & 0x7f);
        else vol = v < 0x99 ? (v >> 4) * 10 + (v & 15) : 64;
        c.volume = Math.min(64, vol);
        break;
      }
      case 0x0f: this.cmd0F(c, t, v, triggers); break;
      case 0x11: c.period = this.clampPeriod(c.period - (v & 15)); break;
      case 0x12: c.period = this.clampPeriod(c.period + (v & 15)); break;
      case 0x15: c.finetune = (v & 15) > 7 ? (v & 15) - 16 : v & 15; break;
      case 0x16:
        if ((v & 15) === 0) c.loopLine = this.line;
        else if (c.loopCount === 0) {
          c.loopCount = v & 15;
          this.breakTo = c.loopLine;
          this.jumpTo = -1; // same block
        } else if (--c.loopCount > 0) {
          this.breakTo = c.loopLine;
          this.jumpTo = -1;
        }
        break;
      case 0x18: c.cutAt = Math.min(15, v); if (c.cutAt === 0) c.volume = 0; break;
      case 0x19:
        if (v) c.offsetMem = v * 256;
        if (hasNote && triggers.get(t) === 0) triggers.set(t, c.offsetMem);
        break;
      case 0x1a: c.volume = Math.min(64, c.volume + (v & 15)); break;
      case 0x1b: c.volume = Math.max(0, c.volume - (v & 15)); break;
      case 0x1d: this.breakTo = v; break;
      case 0x1e: if (this.delayLines === 0 && v) this.delayLines = Math.min(15, v) + 1; break;
      case 0x1f: c.retrig = v & 15; break;
      case 0x2e: { const s = v > 127 ? v - 256 : v; if (s >= -16 && s <= 16) c.pan = s / 16; break; }
    }
  }

  private cmd0F(c: Chan, t: number, v: number, triggers: Map<number, number>): void {
    if (v === 0) this.breakTo = 0;
    else if (v <= 0xf0) {
      if (this.song.tempoMode === "pt") {
        if (v >= 0x20) this.tempo = v;
      } else if (v < 3) this.bpmOverride = 112;
      else {
        this.tempo = v;
        this.bpmOverride = null;
      }
    } else if (v === 0xf1) c.retrig = Math.max(1, this.speed >> 1);
    else if (v === 0xf3) c.retrig = Math.max(1, Math.floor(this.speed / 3));
    else if (v === 0xf8) this.song.flags.filter = false;
    else if (v === 0xf9) this.song.flags.filter = true;
    else if (v === 0xfe) this.stopped = true;
    else if (v === 0xff) {
      c.on = false;
      triggers.set(t, -1);
    }
  }

  /** the ticks after the first: slides, vibrato, arpeggio, retrigger, cut, delayed notes */
  private effects(triggers: Map<number, number>): void {
    this.cells().forEach((cell, t) => {
      const c = this.chans[t];
      if (!c) return;
      if (c.delayed && c.delayed.tick === this.tick) {
        const d = c.delayed;
        c.delayed = null;
        this.noteOn(c, t, d.note, d.inst, d.porta, triggers);
      }
      if (c.cutAt === this.tick) c.volume = 0;
      if (c.retrig && this.tick % c.retrig === 0 && c.on) {
        c.age = 0;
        triggers.set(t, 0);
      }
      this.slides(c, cell.cmd, cell.val, false);
    });
  }

  /** slides on this tick (`first`: OctaMED's own mode also slides on a line's first tick) */
  private slides(c: Chan, cmds: number[], vals: number[], first: boolean): void {
    for (let p = 0; p < cmds.length; p++) {
      const cmd = cmds[p], v = vals[p];
      switch (cmd) {
        case 0x01: c.period = this.clampPeriod(c.period - v); break;
        case 0x02: c.period = this.clampPeriod(c.period + v); break;
        case 0x03: this.toward(c); break;
        case 0x05: this.toward(c); this.volSlide(c, v); break;
        case 0x06: if (!first) this.vibrato(c); this.volSlide(c, v); break;
        case 0x0a: case 0x0d: this.volSlide(c, v); break;
        case 0x04: case 0x14: if (!first) this.vibrato(c); break;
        case 0x07: if (!first) c.tremPos = (c.tremPos + c.tremSpeed) & 63; break;
      }
    }
  }

  private toward(c: Chan): void {
    if (!c.target || !c.portaSpeed) return;
    if (c.period < c.target) c.period = Math.min(c.target, c.period + c.portaSpeed);
    else if (c.period > c.target) c.period = Math.max(c.target, c.period - c.portaSpeed);
  }

  private volSlide(c: Chan, v: number): void {
    if (v >> 4) c.volume = Math.min(64, c.volume + (v >> 4));
    else c.volume = Math.max(0, c.volume - (v & 15));
  }

  private vibrato(c: Chan): void {
    c.vibPos = (c.vibPos + c.vibSpeed) & 63;
  }

  private clampPeriod(p: number): number {
    return this.song.tempoMode === "pt" ? Math.max(113, Math.min(856, p)) : Math.max(28, Math.min(6848, p));
  }

  /** what each voice plays now, as events (only what changed) */
  private voices(events: VoiceEvent[], triggers: Map<number, number>): void {
    const s = this.song;
    this.chans.forEach((c, voice) => {
      const trig = triggers.get(voice);
      const muted = this.opts.muted?.has(voice);
      if (trig === -1 || (!c.on && c.sent.volume !== 0 && c.sent.volume !== -1)) {
        events.push({ voice, stop: true });
        c.sent = { rate: -1, volume: 0, pan: -2 };
        return;
      }
      if (!c.on) return;
      const inst = this.inst(c);
      if (!inst) return;
      // the pitch: arpeggio, vibrato on top of the period
      let period = c.period;
      for (const [cmd, v] of this.cellCmds(voice)) {
        if (cmd === 0x00 && v) {
          const k = this.tick % 3;
          if (k) period = periodOf(c.semi + (k === 1 ? v >> 4 : v & 15), c.finetune);
        }
        if ((cmd === 0x04 || cmd === 0x14 || cmd === 0x06) && c.vibDepth) period += (SINE[c.vibPos & 31] * (c.vibPos & 32 ? -1 : 1) * c.vibDepth) >> c.vibShift;
      }
      let vol = c.volume;
      if (this.cellCmds(voice).some(([cmd]) => cmd === 0x07) && c.tremDepth) vol = Math.max(0, Math.min(64, vol + ((SINE[c.tremPos & 31] * (c.tremPos & 32 ? -1 : 1) * c.tremDepth) >> 6)));
      // the instrument's hold and decay
      let env = 1;
      if (inst.hold > 0) {
        if (c.age >= inst.hold) env = inst.decay ? Math.max(0, 1 - ((c.age - inst.hold + 1) * inst.decay) / 64) : 0;
      }
      c.age++;
      const rate = PAULA_CLOCK / Math.max(1, period);
      const volume = muted ? 0 : (vol / 64) * env * inst.gain * ((s.trackVolume[voice] ?? 64) / 64) * (s.masterVolume / 64) * this.mix;
      const ev: VoiceEvent = { voice };
      let any = false;
      if (trig !== undefined && trig >= 0) {
        ev.play = c.inst - 1;
        ev.offset = trig;
        any = true;
      }
      if (any || Math.abs(rate - c.sent.rate) > 1e-6) (ev.rate = rate), (any = true);
      if (any || Math.abs(volume - c.sent.volume) > 1e-6) (ev.volume = volume), (any = true);
      if (any || c.pan !== c.sent.pan) (ev.pan = c.pan), (any = true);
      if (any) {
        events.push(ev);
        c.sent = { rate, volume, pan: c.pan };
      }
    });
  }

  private cellCmds(t: number): [number, number][] {
    const cell = this.cells()[t];
    if (!cell) return [];
    return cell.cmd.map((cmd, i) => [cmd, cell.val[i]]);
  }

  /** after a line: the next one (breaks, jumps, loops, the block's end, the song's end) */
  private advance(out: Tick): void {
    const seqLen = this.song.sequence.length;
    const lines = this.song.blocks[this.block]?.lines ?? 64;
    if (this.opts.loopBlock) {
      // one block again and again: a loop inside it still works, breaks and jumps go to its top
      if (this.jumpTo === -1 && this.breakTo !== null) this.line = this.breakTo;
      else if (this.breakTo !== null || this.jumpTo !== null) this.line = 0;
      else this.line = (this.line + 1) % lines;
    } else if (this.jumpTo === -1 && this.breakTo !== null) {
      this.line = this.breakTo; // a loop (16): back up in the same block
    } else if (this.jumpTo !== null && this.jumpTo >= 0) {
      if (this.jumpTo <= this.seq) out.wrapped = true;
      this.seq = this.jumpTo < seqLen ? this.jumpTo : 0;
      this.line = this.breakTo ?? 0;
    } else if (this.breakTo !== null) {
      this.next(out);
      this.line = this.breakTo;
    } else if (++this.line >= lines) {
      this.next(out);
      this.line = 0;
    }
    const now = this.song.blocks[this.block]?.lines ?? 64;
    if (this.line >= now) this.line = 0;
    this.breakTo = this.jumpTo = null;
  }

  private next(out: Tick): void {
    if (++this.seq >= this.song.sequence.length) {
      this.seq = Math.min(this.song.restart, this.song.sequence.length - 1);
      out.wrapped = true;
    }
  }
}

/** How long the song lasts once through (seconds), and its lines — by playing it silently. */
export function songLength(song: Song, maxSeconds = 3600): { seconds: number; lines: number } {
  const p = new Player(song);
  let seconds = 0;
  let lines = 0;
  while (seconds < maxSeconds) {
    const t = p.step();
    if (t.line) lines++;
    seconds += t.seconds;
    if (t.wrapped || t.ended) break;
  }
  return { seconds, lines };
}
