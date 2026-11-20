/**
 * breakerMED — editing a song: what the page's keys and the `med` commands
 * change, in one place, each change undoable. No UI here (tests/edit.test.ts).
 *
 * A cell has columns: 0 the note, 1–2 the instrument (two hex digits), then per
 * command page 4 more: the command's two digits, the parameter's two.
 */
import { emptyCell, newBlock, NOTE_OFF, type Block, type Cell, type Song } from "./song";

export const NOTE_COL = 0;
/** how many columns a cell has */
export const colsOf = (pages: number) => 3 + 4 * pages;
/** what a column is: the note, the instrument, or a page's command / parameter (and which digit) */
export function colKind(col: number): { kind: "note" } | { kind: "inst"; digit: 0 | 1 } | { kind: "cmd" | "val"; page: number; digit: 0 | 1 } {
  if (col === 0) return { kind: "note" };
  if (col <= 2) return { kind: "inst", digit: (col - 1) as 0 | 1 };
  const k = col - 3;
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
}

const clone = (c: Cell): Cell => ({ note: c.note, inst: c.inst, cmd: [...c.cmd], val: [...c.val] });
const cloneBlock = (b: Block): Block => ({ ...b, cells: b.cells.map((row) => row.map(clone)) });
const setNibble = (v: number, digit: 0 | 1, n: number) => (digit === 0 ? ((n & 15) << 4) | (v & 15) : (v & 0xf0) | (n & 15));

export class Editor {
  private done: Step[] = [];
  private undone: Step[] = [];
  /** something changed (the title shows ●, `med save` clears it) */
  dirty = false;
  onChange?: () => void;

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
    this.changed();
    return s.label;
  }

  redo(): string | null {
    const s = this.undone.pop();
    if (!s) return null;
    s.redo();
    this.done.push(s);
    this.changed();
    return s.label;
  }

  private changed(): void {
    this.dirty = true;
    this.onChange?.();
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
  private shape(label: string, fn: () => void): void {
    const take = () => ({ blocks: this.song.blocks.map(cloneBlock), sequence: [...this.song.sequence], tracks: this.song.tracks, vol: [...this.song.trackVolume], pan: [...this.song.trackPan] });
    const put = (s: ReturnType<typeof take>) => {
      this.song.blocks = s.blocks.map(cloneBlock);
      this.song.sequence = [...s.sequence];
      this.song.tracks = s.tracks;
      this.song.trackVolume = [...s.vol];
      this.song.trackPan = [...s.pan];
    };
    const before = take();
    fn();
    const after = take();
    this.record({ label, undo: () => put(before), redo: () => put(after) });
  }

  private record(s: Step): void {
    this.done.push(s);
    if (this.done.length > 500) this.done.shift();
    this.undone = [];
    this.changed();
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
      else {
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
      if (k.kind === "note") (c.note = 0), (c.inst = 0);
      else if (k.kind === "inst") c.inst = 0;
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

  /** how many tracks every block has (1–64) */
  setTracks(n: number): void {
    const tracks = Math.max(1, Math.min(64, Math.floor(n)));
    this.shape("tracks", () => {
      for (const b of this.song.blocks)
        for (const row of b.cells) {
          if (row.length > tracks) row.length = tracks;
          while (row.length < tracks) row.push(emptyCell(b.pages));
        }
      const s = this.song;
      s.trackVolume = Array.from({ length: tracks }, (_, i) => s.trackVolume[i] ?? 64);
      s.trackPan = Array.from({ length: tracks }, (_, i) => s.trackPan[i] ?? ((i & 3) === 0 || (i & 3) === 3 ? -0.6 : 0.6));
      s.tracks = tracks;
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
