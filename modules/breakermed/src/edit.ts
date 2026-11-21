/**
 * breakerMED — editing a song: what the page's keys and the `med` commands
 * change, in one place, each change undoable. No UI here (tests/edit.test.ts).
 *
 * A cell has columns: 0 the note, 1–2 the instrument (two hex digits), 3 the
 * chord (one digit, 1–F of the song's table), then per command page 4 more:
 * the command's two digits, the parameter's two.
 */
import { computed, DEFAULT_CHORDS, MAX_STRUM_MS, emptyCell, type ChordDef, MAX_TRACKS, newBlock, NOTE_OFF, type Block, type Cell, type Instrument, type Song } from "./song";

/** a song holds 63 instruments at most (OctaMED's limit) */
export const MAX_INSTRUMENTS = 63;

export const NOTE_COL = 0;
export const CHORD_COL = 3;
/** the first command column (page 0's command, first digit) */
export const CMD_COL = 4;
/** how many columns a cell has */
export const colsOf = (pages: number) => CMD_COL + 4 * pages;
/** what a column is: the note, the instrument, or a page's command / parameter (and which digit) */
export function colKind(col: number): { kind: "note" } | { kind: "inst"; digit: 0 | 1 } | { kind: "chord" } | { kind: "cmd" | "val"; page: number; digit: 0 | 1 } {
  if (col === 0) return { kind: "note" };
  if (col <= 2) return { kind: "inst", digit: (col - 1) as 0 | 1 };
  if (col === CHORD_COL) return { kind: "chord" };
  const k = col - CMD_COL;
  const page = Math.floor(k / 4), r = k % 4;
  return { kind: r < 2 ? "cmd" : "val", page, digit: (r % 2) as 0 | 1 };
}

/** A rectangle of a block: lines and tracks, both ends included. */
export interface Selection {
  block: number;
  line0: number;
  line1: number;
  track0: number;
  track1: number;
}

/** What copy keeps: cells, [line][track]. */
export interface Clip {
  cells: Cell[][];
}

interface Step {
  label: string;
  undo: () => void;
  redo: () => void;
  /** steps with the same key, close together, make one undo (a setting nudged step by step) */
  merge?: string;
  at?: number;
  /** changes only how it plays here (mute, solo): not the song, so not "unsaved" */
  view?: boolean;
}

/** nudges of one setting closer than this (ms) are one undo: ←→ held, the wheel, ‹ › clicked */
export const MERGE_MS = 1000;

/** the song's own settings (what the SONG screen and med tempo / echo / swing… change) */
interface Settings {
  title: string;
  tempoMode: Song["tempoMode"];
  tempo: number;
  speed: number;
  lpb: number;
  transpose: number;
  masterVolume: number;
  flags: Song["flags"];
  chordColumn?: boolean;
  echo?: Song["echo"];
  swing?: number;
}

const clone = (c: Cell): Cell => ({ note: c.note, inst: c.inst, ...(c.chord ? { chord: c.chord } : {}), cmd: [...c.cmd], val: [...c.val] });
const cloneBlock = (b: Block): Block => ({ ...b, cells: b.cells.map((row) => row.map(clone)) });
const setNibble = (v: number, digit: 0 | 1, n: number) => (digit === 0 ? ((n & 15) << 4) | (v & 15) : (v & 0xf0) | (n & 15));

export class Editor {
  private done: Step[] = [];
  private undone: Step[] = [];
  /** something changed (the title shows ●, `med save` clears it) */
  dirty = false;
  onChange?: () => void;
  /** the clock merging uses (tests set it) */
  now: () => number = () => Date.now();

  constructor(public song: Song) {}

  // ── history ─────────────────────────────────────────────────────────────

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  undo(): string | null {
    const s = this.done.pop();
    if (!s) return null;
    s.undo();
    this.undone.push(s);
    this.changed(s);
    return s.label;
  }

  redo(): string | null {
    const s = this.undone.pop();
    if (!s) return null;
    s.redo();
    s.at = 0; // a redone step never merges with the next one
    this.done.push(s);
    this.changed(s);
    return s.label;
  }

  private changed(s?: Step): void {
    if (!s?.view) this.dirty = true;
    this.onChange?.();
  }

  /** a change as a snapshot of what it touches, before and after */
  private snap<T>(label: string, take: () => T, put: (v: T) => void, fn: () => void, merge?: string): void {
    const before = take();
    fn();
    const after = take();
    this.record({ label, undo: () => put(before), redo: () => put(after), merge });
  }

  /** change some cells of a block, undoably */
  private cells(label: string, block: number, at: [number, number][], fn: (c: Cell, line: number, track: number) => void): void {
    const b = this.song.blocks[block];
    if (!b) return;
    const spots = at.filter(([l, t]) => l >= 0 && l < b.lines && t >= 0 && t < this.song.tracks);
    if (!spots.length) return;
    const before = spots.map(([l, t]) => clone(b.cells[l][t]));
    for (const [l, t] of spots) fn(b.cells[l][t], l, t);
    const after = spots.map(([l, t]) => clone(b.cells[l][t]));
    const put = (cells: Cell[]) => spots.forEach(([l, t], i) => (b.cells[l][t] = clone(cells[i])));
    this.record({ label, undo: () => put(before), redo: () => put(after) });
  }

  /** change the song's shape (blocks, lines, the sequence, the tracks), undoably */
  private shape(label: string, fn: () => void, merge?: string): void {
    const take = () => ({ blocks: this.song.blocks.map(cloneBlock), sequence: [...this.song.sequence], tracks: this.song.tracks, vol: [...this.song.trackVolume], pan: [...this.song.trackPan], names: [...this.song.trackNames], strum: this.song.trackStrum ? [...this.song.trackStrum] : undefined, insts: [...this.song.instruments], chords: this.song.chords });
    const put = (s: ReturnType<typeof take>) => {
      this.song.blocks = s.blocks.map(cloneBlock);
      this.song.sequence = [...s.sequence];
      this.song.tracks = s.tracks;
      this.song.trackVolume = [...s.vol];
      this.song.trackPan = [...s.pan];
      this.song.trackNames = [...s.names];
      if (s.strum) this.song.trackStrum = [...s.strum];
      else delete this.song.trackStrum;
      this.song.instruments = [...s.insts];
      if (s.chords) this.song.chords = s.chords;
      else delete this.song.chords;
    };
    this.snap(label, take, put, fn, merge);
  }

  private record(s: Step): void {
    const last = this.done[this.done.length - 1];
    const now = this.now();
    // the same setting again, just after (and nothing undone since): the last step grows
    if (s.merge && last?.merge === s.merge && !this.undone.length && now - (last.at ?? 0) <= MERGE_MS) {
      last.redo = s.redo;
      last.at = now;
      return this.changed(s);
    }
    s.at = now;
    this.done.push(s);
    if (this.done.length > 500) this.done.shift();
    this.undone = [];
    this.changed(s);
  }

  /**
   * A change the editor can't snapshot itself (the engine's mutes): `apply` does it,
   * `revert` takes it back. `view`: it changes only how the song plays here.
   */
  act(label: string, apply: () => void, revert: () => void, o: { view?: boolean } = {}): void {
    apply();
    this.record({ label, undo: revert, redo: apply, view: o.view });
  }

  /** the song's settings (tempo, speed, swing, echo, the LED filter, the title…), undoably; `merge`: a nudge */
  settings(label: string, fn: (s: Song) => void, merge = false): void {
    const s = this.song;
    const take = (): Settings => ({
      title: s.title, tempoMode: s.tempoMode, tempo: s.tempo, speed: s.speed, lpb: s.lpb, transpose: s.transpose, masterVolume: s.masterVolume,
      flags: { ...s.flags }, chordColumn: s.chordColumn, echo: s.echo ? { ...s.echo } : undefined, swing: s.swing,
    });
    const put = (v: Settings) => {
      Object.assign(s, { title: v.title, tempoMode: v.tempoMode, tempo: v.tempo, speed: v.speed, lpb: v.lpb, transpose: v.transpose, masterVolume: v.masterVolume, flags: { ...v.flags } });
      for (const k of ["chordColumn", "swing"] as const) v[k] === undefined ? delete s[k] : ((s as unknown as Record<string, unknown>)[k] = v[k]);
      if (v.echo) s.echo = { ...v.echo };
      else delete s.echo;
    };
    this.snap(label, take, put, () => fn(s), merge ? `settings ${label}` : undefined);
  }

  // ── cells ───────────────────────────────────────────────────────────────

  /** a note (and the instrument, when one is given) */
  writeNote(block: number, line: number, track: number, note: number, inst = 0): void {
    const n = note === NOTE_OFF ? NOTE_OFF : Math.max(1, Math.min(127, note));
    this.cells("note", block, [[line, track]], (c) => {
      c.note = n;
      if (inst && n !== NOTE_OFF) c.inst = inst;
    });
  }

  /** one hex digit in the instrument, a command or a parameter */
  writeHex(block: number, line: number, track: number, col: number, digit: number): void {
    const k = colKind(col);
    if (k.kind === "note") return;
    this.cells("digit", block, [[line, track]], (c) => {
      if (k.kind === "inst") c.inst = Math.min(63, setNibble(c.inst, k.digit, digit));
      else if (k.kind === "chord") {
        if (digit) c.chord = digit & 15;
        else delete c.chord;
      } else {
        while (c.cmd.length <= k.page) (c.cmd.push(0), c.val.push(0));
        if (k.kind === "cmd") c.cmd[k.page] = setNibble(c.cmd[k.page], k.digit, digit);
        else c.val[k.page] = setNibble(c.val[k.page], k.digit, digit);
      }
    });
  }

  /** empty what a column holds: the note (and its instrument), the instrument, or a page's command */
  clear(block: number, line: number, track: number, col: number): void {
    const k = colKind(col);
    this.cells("clear", block, [[line, track]], (c) => {
      if (k.kind === "note") (c.note = 0), (c.inst = 0), delete c.chord;
      else if (k.kind === "inst") c.inst = 0;
      else if (k.kind === "chord") delete c.chord;
      else (c.cmd[k.page] = 0), (c.val[k.page] = 0);
    });
  }

  /** a selection's cells emptied */
  clearSelection(sel: Selection): void {
    this.cells("clear", sel.block, spotsOf(sel), (c) => Object.assign(c, emptyCell(c.cmd.length)));
  }

  /** an empty line at `line` in these tracks: what's below moves down (the last line falls off) */
  insertLine(block: number, line: number, tracks: number[]): void {
    const b = this.song.blocks[block];
    if (!b) return;
    const spots: [number, number][] = [];
    for (let l = line; l < b.lines; l++) for (const t of tracks) spots.push([l, t]);
    const old = b.cells.map((r) => r.map(clone));
    this.cells("insert line", block, spots, (c, l, t) => Object.assign(c, l === line ? emptyCell(b.pages) : clone(old[l - 1][t])));
  }

  /** the line at `line` goes in these tracks: what's below moves up (an empty line comes in at the bottom) */
  deleteLine(block: number, line: number, tracks: number[]): void {
    const b = this.song.blocks[block];
    if (!b) return;
    const spots: [number, number][] = [];
    for (let l = line; l < b.lines; l++) for (const t of tracks) spots.push([l, t]);
    const old = b.cells.map((r) => r.map(clone));
    this.cells("delete line", block, spots, (c, l, t) => Object.assign(c, l === b.lines - 1 ? emptyCell(b.pages) : clone(old[l + 1][t])));
  }

  copy(sel: Selection): Clip {
    const b = this.song.blocks[sel.block];
    const cells: Cell[][] = [];
    for (let l = sel.line0; l <= sel.line1; l++) {
      const row: Cell[] = [];
      for (let t = sel.track0; t <= sel.track1; t++) row.push(clone(b?.cells[l]?.[t] ?? emptyCell()));
      cells.push(row);
    }
    return { cells };
  }

  cut(sel: Selection): Clip {
    const clip = this.copy(sel);
    this.clearSelection(sel);
    return clip;
  }

  /** a clip's cells from (line, track): what doesn't fit is left out */
  paste(block: number, line: number, track: number, clip: Clip): void {
    const spots: [number, number][] = [];
    clip.cells.forEach((row, i) => row.forEach((_, j) => spots.push([line + i, track + j])));
    this.cells("paste", block, spots, (c, l, t) => {
      const src = clip.cells[l - line][t - track];
      c.note = src.note;
      c.inst = src.inst;
      for (let p = 0; p < Math.max(c.cmd.length, src.cmd.length); p++) {
        if (p >= c.cmd.length) break; // a page this block hasn't got
        c.cmd[p] = src.cmd[p] ?? 0;
        c.val[p] = src.val[p] ?? 0;
      }
    });
  }

  /** the notes of a selection, up or down (semitones); note offs and empty cells stay */
  transpose(sel: Selection, semis: number): void {
    this.cells("transpose", sel.block, spotsOf(sel), (c) => {
      if (c.note && c.note !== NOTE_OFF) c.note = Math.max(1, Math.min(127, c.note + semis));
    });
  }

  // ── the song's shape ────────────────────────────────────────────────────

  /** a new empty block (returns its number) */
  newBlock(lines = 64): number {
    let n = 0;
    this.shape("new block", () => {
      this.song.blocks.push(newBlock(this.song.tracks, Math.max(1, Math.min(3200, lines)), 1));
      n = this.song.blocks.length - 1;
    });
    return n;
  }

  /** a copy of a block (returns the new one's number) */
  cloneBlock(block: number): number {
    let n = block;
    const b = this.song.blocks[block];
    if (!b) return n;
    this.shape("copy block", () => {
      this.song.blocks.push({ ...cloneBlock(b), name: b.name });
      n = this.song.blocks.length - 1;
    });
    return n;
  }

  /** a block's length in lines (1–3200): new lines are empty, cut ones go */
  setLines(block: number, lines: number): void {
    const b = this.song.blocks[block];
    if (!b) return;
    const n = Math.max(1, Math.min(3200, Math.floor(lines)));
    this.shape("block length", () => {
      if (n < b.lines) b.cells.length = n;
      while (b.cells.length < n) b.cells.push(Array.from({ length: this.song.tracks }, () => emptyCell(b.pages)));
      b.lines = n;
    });
  }

  /** how many tracks every block has (1–16; a song read with more keeps what it has) */
  setTracks(n: number): void {
    const tracks = Math.max(1, Math.min(Math.max(MAX_TRACKS, this.song.tracks), Math.floor(n)));
    this.shape("tracks", () => {
      for (const b of this.song.blocks)
        for (const row of b.cells) {
          if (row.length > tracks) row.length = tracks;
          while (row.length < tracks) row.push(emptyCell(b.pages));
        }
      const s = this.song;
      s.trackVolume = Array.from({ length: tracks }, (_, i) => s.trackVolume[i] ?? 64);
      s.trackPan = Array.from({ length: tracks }, (_, i) => s.trackPan[i] ?? ((i & 3) === 0 || (i & 3) === 3 ? -0.6 : 0.6));
      s.trackNames = Array.from({ length: tracks }, (_, i) => s.trackNames[i] ?? "");
      if (s.trackStrum) s.trackStrum = Array.from({ length: tracks }, (_, i) => s.trackStrum![i] ?? 0);
      s.tracks = tracks;
    });
  }

  /** a track's name, volume (0–64), pan (-1…1) and chord strum (ms) */
  setTrack(track: number, what: { name?: string; volume?: number; pan?: number; strum?: number }, merge = false): void {
    if (track < 0 || track >= this.song.tracks) return;
    const s = this.song;
    // only the tracks' settings change: no need to keep the blocks
    const take = () => ({ vol: [...s.trackVolume], pan: [...s.trackPan], names: [...s.trackNames], strum: s.trackStrum ? [...s.trackStrum] : undefined });
    const put = (v: ReturnType<typeof take>) => {
      s.trackVolume = [...v.vol];
      s.trackPan = [...v.pan];
      s.trackNames = [...v.names];
      if (v.strum) s.trackStrum = [...v.strum];
      else delete s.trackStrum;
    };
    this.snap("track", take, put, () => {
      if (what.name !== undefined) s.trackNames[track] = what.name.replace(/[\u0000-\u001f]/g, "").slice(0, 24);
      if (what.volume !== undefined) s.trackVolume[track] = Math.max(0, Math.min(64, Math.round(what.volume)));
      if (what.pan !== undefined) s.trackPan[track] = Math.max(-1, Math.min(1, what.pan));
      if (what.strum !== undefined) {
        s.trackStrum ??= new Array(s.tracks).fill(0);
        s.trackStrum[track] = Math.max(0, Math.min(MAX_STRUM_MS, Math.round(what.strum)));
        if (s.trackStrum.every((x) => !x)) delete s.trackStrum;
      }
    }, merge ? `track ${track} ${Object.keys(what).join(",")}` : undefined);
  }

  /**
   * Change an instrument (its sound, its loop, its settings), undoably: `fn` gets a copy
   * (the sound arrays are replaced, never changed in place, so ⌘Z brings the old ones back).
   */
  instrument(index: number, label: string, fn: (ins: Instrument) => void, merge = false): void {
    const old = this.song.instruments[index];
    if (!old) return;
    // only this slot changes: the snapshot is the instrument itself (a new object each change)
    const take = () => this.song.instruments[index];
    const put = (v: Instrument) => (this.song.instruments[index] = v);
    this.snap(label, take, put, () => {
      const copy: Instrument = { ...old };
      if (old.synth) copy.synth = structuredClone(old.synth); // a synth's settings are changed in place
      if (old.drums) copy.drums = structuredClone(old.drums);
      if (old.fm) copy.fm = structuredClone(old.fm);
      if (old.chip) copy.chip = structuredClone(old.chip);
      fn(copy);
      if (copy.loopStart + copy.loopLength > copy.data.length) copy.loopLength = Math.max(0, copy.data.length - copy.loopStart);
      if (copy.loopLength <= 2) (copy.loopStart = 0), (copy.loopLength = 0);
      if (!computed(copy)) copy.kind = copy.data.length ? (copy.kind === "empty" ? "sample" : copy.kind) : "empty";
      this.song.instruments[index] = copy;
    }, merge ? `instrument ${index} ${label}` : undefined);
  }

  /** put instruments in the first free slots (or at `at`): their numbers (0-based), as many as fit */
  addInstruments(list: Instrument[], at?: number): number[] {
    const placed: number[] = [];
    this.shape("instruments", () => {
      const s = this.song;
      for (const ins of list) {
        let i = at !== undefined && placed.length === 0 ? at : s.instruments.findIndex((x, k) => x.kind === "empty" && !placed.includes(k));
        if (i < 0) i = s.instruments.length;
        if (i >= MAX_INSTRUMENTS) break;
        while (s.instruments.length < i) s.instruments.push({ ...ins, name: "", kind: "empty", data: new Float32Array(0), loopStart: 0, loopLength: 0 });
        s.instruments[i] = ins;
        placed.push(i);
      }
    });
    return placed;
  }

  /** one line of the song's chord table (1–15), or the default table back (`def` null) */
  chords(n: number, def: ChordDef | null): void {
    this.shape("chords", () => {
      const s = this.song;
      if (!def) return void delete s.chords;
      s.chords = (s.chords ?? DEFAULT_CHORDS).map((c) => ({ name: c.name, notes: [...c.notes] }));
      s.chords[n - 1] = def;
    });
  }

  /** put a block in the sequence at `pos` (before what's there) */
  seqInsert(pos: number, block: number): void {
    if (!this.song.blocks[block]) return;
    this.shape("sequence", () => this.song.sequence.splice(Math.max(0, Math.min(this.song.sequence.length, pos)), 0, block));
  }

  /** take a position out of the sequence (one always stays) */
  seqDelete(pos: number): void {
    if (this.song.sequence.length <= 1 || pos < 0 || pos >= this.song.sequence.length) return;
    this.shape("sequence", () => this.song.sequence.splice(pos, 1));
  }

  /** which block a position plays */
  seqSet(pos: number, block: number): void {
    if (!this.song.blocks[block] || pos < 0 || pos >= this.song.sequence.length) return;
    this.shape("sequence", () => (this.song.sequence[pos] = block));
  }
}

function spotsOf(sel: Selection): [number, number][] {
  const out: [number, number][] = [];
  for (let l = Math.min(sel.line0, sel.line1); l <= Math.max(sel.line0, sel.line1); l++)
    for (let t = Math.min(sel.track0, sel.track1); t <= Math.max(sel.track0, sel.track1); t++) out.push([l, t]);
  return out;
}

/** "C-3" "c#2" "D3" → the note number (1 = C-1), "^^^" / "off" → note off, "---" → 0; null when it isn't a note */
export function parseNote(s: string): number | null {
  const t = s.trim().toUpperCase();
  if (t === "---" || t === "0") return 0;
  if (t === "^^^" || t === "OFF") return NOTE_OFF;
  const m = /^([A-G])([#-]?)(\d)$/.exec(t);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"];
  const n = (+m[3] - 1) * 12 + base + (m[2] === "#" ? 1 : 0) + 1;
  return n >= 1 && n <= 127 ? n : null;
}
