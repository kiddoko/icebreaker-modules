/**
 * breakerMED — what a song is, in memory. One model for .med (MMD0–MMD3) and
 * .mod: tracks, blocks (patterns) of any length, a play sequence, instruments,
 * the tempo. Commands are kept in OctaMED's numbering (00–FF, hex parameter),
 * whatever file they came from: a .mod's effects are translated when it's read
 * (format/mod.ts) and back when it's written.
 *
 * No UI, no sound here: plain data, tested on its own.
 */

/** "C-1" is note 1; 0 is an empty cell, NOTE_OFF stops the note (MMD1+). */
export const NOTE_OFF = 0x80;
export const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];

/** How a song's tempo is read (OctaMED's three ways, and ProTracker's). */
export type TempoMode =
  /** ProTracker: `tempo` is BPM (a tick lasts 2.5 / BPM s), 0F with ≥ 0x20 sets it */
  | "pt"
  /** OctaMED "SPD": `tempo` 1–240, a tick lasts 0.66 / tempo s (33 ≈ 50 Hz); 1–10 are SoundTracker speeds */
  | "spd"
  /** OctaMED "BPM": `tempo` beats a minute, `lpb` lines a beat */
  | "bpm";

export interface Song {
  title: string;
  /** what it was read from ("MMD2", "MOD M.K."…) — written back the same way when it can */
  format: string;
  tracks: number;
  blocks: Block[];
  /** the play sequence: block numbers */
  sequence: number[];
  /** where the song starts again after its end (a .mod's restart byte) */
  restart: number;
  /** 63 slots at most (index 0 = instrument 01) */
  instruments: Instrument[];
  tempoMode: TempoMode;
  /** see TempoMode */
  tempo: number;
  /** ticks a line ("secondary tempo", ProTracker's speed) */
  speed: number;
  /** lines a beat (BPM mode; also the editor's highlight) */
  lpb: number;
  /** semitones added to every note (OctaMED's play transpose) */
  transpose: number;
  /** semitones between the file's note numbers and ours (MMD3 counts two octaves lower: -24) */
  noteShift: number;
  /** 1–64 */
  masterVolume: number;
  /** each track's volume 1–64 */
  trackVolume: number[];
  /** each track's pan -1…1 */
  trackPan: number[];
  /** each track's name ("" = "track 3") */
  trackNames: string[];
  flags: SongFlags;
  /** the chord table (1–F in the chord column); none = the default one */
  chords?: ChordDef[];
  /** the block shows the chord column (it comes on by itself when a chord is written) */
  chordColumn?: boolean;
  /** OctaMED's echo on the whole mix (none: off) */
  echo?: Echo;
  /** swing 0–100: every other line longer, the next shorter (100 = a triplet feel, 2:1); none = straight */
  swing?: number;
  /** each track's chord strum, in ms between the chord's notes (none or 0: all at once) */
  trackStrum?: number[];
}

/** the longest strum between two notes of a chord, in ms */
export const MAX_STRUM_MS = 200;

/** how long a line lasts with swing, as a factor (even lines longer, odd lines shorter; a pair stays the same) */
export const swingFactor = (swing: number | undefined, line: number): number => {
  const s = Math.max(0, Math.min(100, swing ?? 0)) / 300;
  return line % 2 === 0 ? 1 + s : 1 - s;
};

/**
 * A chord turned over `k` times (1, 2, 3): its lowest note goes up an octave each time,
 * then the whole is moved so the written note is still one of them. maj (+4 +7) once:
 * -8 -5 (E G under the C: the third in the bass); twice: -5 +4 (G under, E over).
 */
export function invertChord(notes: number[], k: number): number[] {
  // the written note is the one marked `root`; it moves with the others
  let all = [{ v: 0, root: true }, ...notes.map((v) => ({ v, root: false }))].sort((a, b) => a.v - b.v);
  for (let i = 0; i < k; i++) {
    const [low, ...rest] = all;
    all = [...rest, { ...low, v: low.v + 12 }];
  }
  const root = all.find((x) => x.root)!.v;
  return all.filter((x) => !x.root).map((x) => x.v - root);
}

/**
 * OctaMED's mix echo: the sound comes back after `ms`, softer each time:
 * `depth` 1–6 (each repeat at 1/2^depth: 1 rings long, 6 is a short slap).
 * "cross" bounces it from one side to the other.
 */
export interface Echo {
  type: "normal" | "cross";
  ms: number;
  depth: number;
}

export const ECHO_MAX_MS = 2000;
/** an echo checked and clamped (from a file, a command) */
export function cleanEcho(x: unknown): Echo | undefined {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
  if (!o || (o.type !== "normal" && o.type !== "cross")) return undefined;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  return { type: o.type, ms: num(o.ms, 250, 1, ECHO_MAX_MS), depth: num(o.depth, 2, 1, 6) };
}

/** a chord: the notes it adds over the one written, in semitones */
export interface ChordDef {
  name: string;
  notes: number[];
}

/** our default chord table: 1–F in the chord column */
export const DEFAULT_CHORDS: readonly ChordDef[] = [
  { name: "maj", notes: [4, 7] },
  { name: "min", notes: [3, 7] },
  { name: "7", notes: [4, 7, 10] },
  { name: "m7", notes: [3, 7, 10] },
  { name: "maj7", notes: [4, 7, 11] },
  { name: "sus2", notes: [2, 7] },
  { name: "sus4", notes: [5, 7] },
  { name: "dim", notes: [3, 6] },
  { name: "aug", notes: [4, 8] },
  { name: "5", notes: [7] },
  { name: "6", notes: [4, 7, 9] },
  { name: "m6", notes: [3, 7, 9] },
  { name: "add9", notes: [4, 7, 14] },
  { name: "m9", notes: [3, 7, 10, 14] },
  { name: "oct", notes: [12] },
];

export const chordsOf = (s: Song): readonly ChordDef[] => s.chords ?? DEFAULT_CHORDS;
/** the notes chord `n` (1–15) adds; none for 0 */
export const chordNotes = (s: Song, n: number | undefined): number[] => (n ? chordsOf(s)[n - 1]?.notes ?? [] : []);
/** at most this many notes a chord adds (over the one written) */
export const MAX_CHORD_NOTES = 5;

export interface SongFlags {
  /** 0C's parameter is hex (else decimal, OctaMED's old default) */
  volHex: boolean;
  /** MMD3 / 7-bit volumes: 0C goes to 0x7F */
  vol7bit: boolean;
  /** ProTracker-compatible slides: nothing slides on a line's first tick */
  ptSlides: boolean;
  /** OctaMED 5–8 channel mode (its own tempo table) */
  eightChannel: boolean;
  /** the Amiga's own four voices (notes above B-3 fold an octave down) */
  hardwareMix: boolean;
  /** the Amiga's low-pass filter ("LED"), 0FF9 / 0FF8 switch it */
  filter: boolean;
}

export interface Cell {
  /** 0 empty, 1 = C-1 … , NOTE_OFF */
  note: number;
  /** 0 none, 1–63 */
  inst: number;
  /** 0 none, 1–15: a chord of the song's table played over the note */
  chord?: number;
  /** one command a page (OctaMED can have several pages) */
  cmd: number[];
  val: number[];
}

export interface Block {
  name: string;
  lines: number;
  /** command pages (1 for MMD0 and .mod) */
  pages: number;
  /** [line][track] */
  cells: Cell[][];
}

/** sample: a sound read at the note's speed · analog / fm: our synths · drums: our drum machine · synth / hybrid: OctaMED's (read from .med) */
export type InstrumentKind = "empty" | "sample" | "synth" | "hybrid" | "analog" | "fm" | "drums" | "chip";

/** our own instruments: computed, no sound data */
export const computed = (i: Instrument | undefined) => i?.kind === "analog" || i?.kind === "fm" || i?.kind === "drums" || i?.kind === "chip";

/** an instrument that makes sound (a sample with frames, or one of our synths) */
export const playable = (i: Instrument | undefined) => !!i && (computed(i) || (i.kind !== "empty" && i.data.length > 0));

export interface Instrument {
  name: string;
  kind: InstrumentKind;
  /** mono, -1…1 (stereo files keep their left channel here, the right one in `right`) */
  data: Float32Array;
  right?: Float32Array;
  /** written back as 16 bits (else 8) */
  bits16: boolean;
  /** loop in frames; loopLength 0 = none */
  loopStart: number;
  loopLength: number;
  pingPong: boolean;
  /** 0–64 */
  volume: number;
  /** the instrument's own level 0–1 (OctaMED's instrument volume, above the notes') */
  gain: number;
  /** -8…7 (eighths of a semitone) */
  finetune: number;
  /** semitones */
  transpose: number;
  /** OctaMED's hold / decay (ticks, speed): 0 = none */
  hold: number;
  decay: number;
  /** synth / hybrid: the waveforms (the first is a hybrid's sample) and the two little programs */
  waves?: Float32Array[];
  volTable?: number[];
  waveTable?: number[];
  volSpeed?: number;
  waveSpeed?: number;
  /** the analog synth's settings (kind "analog") */
  synth?: import("./dsp/analog").AnalogParams;
  /** the FM synth's settings (kind "fm") */
  fm?: import("./dsp/fm").FmParams;
  /** the drum machine's kit (kind "drums") */
  drums?: import("./dsp/drums").DrumKit;
  /** the chip synth's settings (kind "chip") */
  chip?: import("./dsp/chip").ChipParams;
}

export function emptyCell(pages = 1): Cell {
  return { note: 0, inst: 0, cmd: new Array(pages).fill(0), val: new Array(pages).fill(0) };
}

export function newBlock(tracks: number, lines = 64, pages = 1, name = ""): Block {
  return { name, lines, pages, cells: Array.from({ length: lines }, () => Array.from({ length: tracks }, () => emptyCell(pages))) };
}

export function emptyInstrument(): Instrument {
  return { name: "", kind: "empty", data: new Float32Array(0), bits16: false, loopStart: 0, loopLength: 0, pingPong: false, volume: 64, gain: 1, finetune: 0, transpose: 0, hold: 0, decay: 0 };
}

/** a new song's tracks, and how many a song may have (a light tracker: OctaMED went to 64) */
export const DEFAULT_TRACKS = 8;
export const MAX_TRACKS = 16;

/** A track's name as shown. */
export const trackName = (s: Song, t: number) => s.trackNames[t]?.trim() || `track ${t + 1}`;

export function newSong(tracks = DEFAULT_TRACKS): Song {
  return {
    title: "",
    format: "MMD1",
    tracks,
    blocks: [newBlock(tracks)],
    sequence: [0],
    restart: 0,
    instruments: [],
    tempoMode: "bpm",
    tempo: 125,
    speed: 6,
    lpb: 4,
    transpose: 0,
    noteShift: 0,
    masterVolume: 64,
    trackVolume: new Array(tracks).fill(64),
    trackPan: amigaPan(tracks),
    trackNames: new Array(tracks).fill(""),
    // mixing mode: a new song's notes play where they're written (the Amiga voices fold C-4 and up an octave down)
    flags: { volHex: true, vol7bit: false, ptSlides: false, eightChannel: false, hardwareMix: false, filter: false },
  };
}

/** The Amiga's voices: left, right, right, left (again for more tracks), not quite hard. */
export function amigaPan(tracks: number, width = 0.6): number[] {
  return Array.from({ length: tracks }, (_, i) => ((i & 3) === 0 || (i & 3) === 3 ? -width : width));
}

/** "C-3", "D#1", "---", "^^^" (note off) */
export function noteName(n: number): string {
  if (!n) return "---";
  if (n === NOTE_OFF) return "^^^";
  const i = n - 1;
  return `${NOTE_NAMES[i % 12]}${Math.floor(i / 12) + 1}`.slice(0, 3);
}

/** a line number, in decimal like OctaMED's (the commands' values stay hex): 000, 063, 1024 */
export const lineNo = (v: number, digits = 3) => String(v).padStart(digits, "0");
export const hex = (v: number, digits = 2) => v.toString(16).toUpperCase().padStart(digits, "0");

// ── pitch ──────────────────────────────────────────────────────────────────

/** The Amiga's clock (PAL): a period of P plays PAULA_CLOCK / P frames a second. */
export const PAULA_CLOCK = 3546895;

/**
 * ProTracker's periods for finetune 0, C-1 … B-3 (its exact table; the
 * other finetunes and the octaves past it follow the same curve).
 */
const PT_PERIODS = [856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113];

/** The period of a note (0 = C-1, may be negative or past B-3) with a finetune -8…7. */
export function periodOf(semi: number, finetune = 0): number {
  if (finetune === 0 && semi >= 0 && semi < PT_PERIODS.length) return PT_PERIODS[semi];
  return 856 * Math.pow(2, -(semi + finetune / 8) / 12);
}

/** The note (0 = C-1) closest to a period — for a .mod's cells. */
export function semiOfPeriod(period: number): number {
  let best = 0;
  let dist = Infinity;
  for (let s = -24; s < 72; s++) {
    const d = Math.abs(periodOf(s) - period);
    if (d < dist) (dist = d), (best = s);
  }
  return best;
}

// ── tempo ──────────────────────────────────────────────────────────────────

/**
 * How long a tick lasts, in seconds. OctaMED's tempos follow what its own
 * players do (checked against libopenmpt's reading of them, docs/CREDITS.md):
 * SPD tempo T ticks at T / 0.66 Hz (1–10: SoundTracker speeds), BPM mode
 * at tempo × lines-a-beat / 4 "BPM", the 8-channel mode its own table.
 */
export function tickSeconds(mode: TempoMode, tempo: number, lpb: number, eightChannel = false, hardwareMix = true): number {
  return 2.5 / ptBpmOf(mode, tempo, lpb, eightChannel, hardwareMix);
}

/** The tempo as ProTracker's BPM (ticks at BPM × 2 / 5 Hz). */
export function ptBpmOf(mode: TempoMode, tempo: number, lpb: number, eightChannel = false, hardwareMix = true): number {
  const t = Math.max(1, tempo);
  if (mode === "pt") return Math.max(32, Math.min(255, t));
  if (mode === "bpm" && !eightChannel) return t < 7 ? 111.5 : (t * Math.max(1, lpb)) / 4;
  if (eightChannel) return [179, 164, 152, 141, 131, 123, 116, 110, 104, 99][Math.min(10, t) - 1];
  if (hardwareMix && t <= 10) return (6 * 1773447) / 14500 / t;
  if (!hardwareMix && t < 8) return 157.86;
  return t / 0.264;
}
