/**
 * BreakerMED's own format: a song is a folder you can read.
 *
 *   my-song.bmed/
 *     song.json          the settings, the tracks, the sequence, the instruments,
 *                        and every block line by line, the way the page shows it:
 *                        "C-3 01 0C20 | --- .. .... | E-3 04 0000"
 *     samples/01.wav …   each instrument's sound (16-bit WAV; a synth's waveforms too)
 *
 * Everything a .med / .mod can't hold (8–16 tracks, names, our synths' and kits' settings,
 * chords later) lives here; .med and .mod stay for sharing with other trackers.
 */
import { cleanEcho, DEFAULT_CHORDS, MAX_STRUM_MS, emptyCell, emptyInstrument, hex, MAX_CHORD_NOTES, newBlock, NOTE_NAMES, NOTE_OFF, amigaPan, type Instrument, type Song, type TempoMode } from "../song";
import { cleanVintage, type VintageSettings } from "../dsp/vintage";
import { readWav, writeWav } from "./wav";
import { sanitizeAnalog, type AnalogParams } from "../dsp/analog";
import { sanitizeKit, type DrumKit } from "../dsp/drums";
import { sanitizeFm, type FmParams } from "../dsp/fm";
import { sanitizeChip, type ChipParams } from "../dsp/chip";

export const BMED_VERSION = 1;

/** A file to write, relative to the song's folder. */
export interface SongFile {
  path: string;
  data: Uint8Array | string;
}

interface InstrumentJson {
  name: string;
  kind: Instrument["kind"];
  file?: string;
  right?: string;
  waves?: string[];
  loopStart: number;
  loopLength: number;
  pingPong?: boolean;
  volume: number;
  gain?: number;
  finetune?: number;
  transpose?: number;
  hold?: number;
  decay?: number;
  bits16?: boolean;
  volTable?: number[];
  waveTable?: number[];
  volSpeed?: number;
  waveSpeed?: number;
  /** an analog synth's settings */
  synth?: AnalogParams;
  /** an FM synth's settings */
  fm?: FmParams;
  chip?: ChipParams;
  /** a drum machine's kit */
  drums?: DrumKit;
  /** a sample's own rate (Hz at C-3); none: the Amiga's way */
  rate?: number;
  /** the vintage mode */
  vintage?: VintageSettings;
}

/** a note as text: "C-3", "^^^" (off), "---" (none); past octave 9, "N7F" (hex) */
function noteText(n: number): string {
  if (!n) return "---";
  if (n === NOTE_OFF) return "^^^";
  const oct = Math.floor((n - 1) / 12) + 1;
  return oct <= 9 ? `${NOTE_NAMES[(n - 1) % 12]}${oct}` : `N${hex(n)}`;
}

function parseNoteText(s: string): number {
  if (s === "---") return 0;
  if (s === "^^^") return NOTE_OFF;
  if (/^N[0-9A-F]{2}$/i.test(s)) return parseInt(s.slice(1), 16);
  const m = /^([A-G])([#-])(\d)$/.exec(s.toUpperCase());
  if (!m) throw new Error(`song.json: "${s}" isn't a note`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"];
  return (+m[3] - 1) * 12 + base + (m[2] === "#" ? 1 : 0) + 1;
}

/**
 * The files of a song saved as .bmed (paths relative to its folder). `written`: a
 * sound already in the folder as it is (the autosave) — named, not written again.
 */
export function writeBmed(song: Song, written?: (path: string, data: Float32Array) => boolean): SongFile[] {
  const files: SongFile[] = [];
  const sampleRate = 8363; // a sample has no rate of its own in a tracker: its notes give the pitch
  // a sound with its own rate is written at that rate (a WAV that opens anywhere as it sounds)
  const wav = (path: string, data: Float32Array, rate = sampleRate) => {
    if (!written?.(path, data)) files.push({ path, data: writeWav({ rate: Math.round(rate), channels: [data] }, 16) });
    return path;
  };
  const instruments: InstrumentJson[] = song.instruments.map((ins, i) => {
    const n = String(i + 1).padStart(2, "0");
    const j: InstrumentJson = { name: ins.name, kind: ins.kind, loopStart: ins.loopStart, loopLength: ins.loopLength, volume: ins.volume };
    if (ins.kind !== "empty" && ins.data.length) j.file = wav(`samples/${n}.wav`, ins.data, ins.rate);
    if (ins.right?.length) j.right = wav(`samples/${n}-right.wav`, ins.right, ins.rate);
    if (ins.rate) j.rate = ins.rate;
    if (ins.vintage) j.vintage = { ...ins.vintage };
    if (ins.waves?.length) j.waves = ins.waves.map((w, k) => wav(`samples/${n}-wave${k}.wav`, w));
    if (ins.pingPong) j.pingPong = true;
    if (ins.gain !== 1) j.gain = ins.gain;
    if (ins.finetune) j.finetune = ins.finetune;
    if (ins.transpose) j.transpose = ins.transpose;
    if (ins.hold) j.hold = ins.hold;
    if (ins.decay) j.decay = ins.decay;
    if (ins.bits16) j.bits16 = true;
    if (ins.kind === "analog") j.synth = ins.synth;
    if (ins.kind === "drums") j.drums = ins.drums;
    if (ins.kind === "fm") j.fm = ins.fm;
    if (ins.kind === "chip") j.chip = ins.chip;
    if (ins.volTable) (j.volTable = ins.volTable), (j.waveTable = ins.waveTable), (j.volSpeed = ins.volSpeed), (j.waveSpeed = ins.waveSpeed);
    return j;
  });
  const blocks = song.blocks.map((b) => ({
    name: b.name,
    lines: b.lines,
    pages: b.pages,
    rows: b.cells.map((row) =>
      row
        .map((c) => {
          // the chord, when there is one, rides on the instrument: "C-3 01:3 0C20"
          let s = `${noteText(c.note)} ${c.inst ? hex(c.inst) : ".."}${c.chord ? `:${c.chord.toString(16).toUpperCase()}` : ""}`;
          for (let p = 0; p < b.pages; p++) s += c.cmd[p] || c.val[p] ? ` ${hex(c.cmd[p])}${hex(c.val[p])}` : " ....";
          return s;
        })
        .join(" | "),
    ),
  }));
  const json = {
    breakermed: BMED_VERSION,
    title: song.title,
    from: song.format,
    tempo: { mode: song.tempoMode, tempo: song.tempo, speed: song.speed, lpb: song.lpb },
    transpose: song.transpose,
    noteShift: song.noteShift,
    masterVolume: song.masterVolume,
    restart: song.restart,
    flags: song.flags,
    tracks: Array.from({ length: song.tracks }, (_, t) => ({ name: song.trackNames[t] ?? "", volume: song.trackVolume[t] ?? 64, pan: song.trackPan[t] ?? 0, ...(song.trackStrum?.[t] ? { strum: song.trackStrum[t] } : {}) })),
    sequence: song.sequence,
    ...(song.chords ? { chords: song.chords } : {}),
    ...(song.chordColumn ? { chordColumn: true } : {}),
    ...(song.echo ? { echo: song.echo } : {}),
    ...(song.swing ? { swing: song.swing } : {}),
    instruments,
    blocks,
  };
  files.unshift({ path: "song.json", data: JSON.stringify(json, null, 1) });
  return files;
}

/** Read a .bmed song: its song.json, and a way to read the files next to it. */
export async function readBmed(jsonText: string, readFile: (path: string) => Promise<Uint8Array>): Promise<Song> {
  let j: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    j = JSON.parse(jsonText);
  } catch {
    throw new Error("song.json isn't valid JSON");
  }
  if (typeof j.breakermed !== "number") throw new Error("song.json isn't a BreakerMED song");
  if (j.breakermed > BMED_VERSION) throw new Error("this song was saved by a newer BreakerMED: update the module");
  const tracks = Math.max(1, Math.min(64, (j.tracks ?? []).length || 4));
  const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const sample = async (path?: string) => {
    if (!path || typeof path !== "string" || path.includes("..")) return new Float32Array(0);
    const pcm = readWav(await readFile(path));
    return pcm?.channels[0] ?? new Float32Array(0);
  };
  const instruments: Instrument[] = [];
  for (const ij of (j.instruments ?? []).slice(0, 63)) {
    const ins = emptyInstrument();
    ins.name = String(ij.name ?? "").slice(0, 40);
    ins.kind = ["sample", "synth", "hybrid", "analog", "fm", "drums", "chip", "empty"].includes(ij.kind) ? ij.kind : "empty";
    ins.data = await sample(ij.file);
    if (ij.right) ins.right = await sample(ij.right);
    if (Array.isArray(ij.waves)) ins.waves = await Promise.all(ij.waves.slice(0, 64).map((w: string) => sample(w)));
    ins.loopStart = num(ij.loopStart, 0, 0);
    ins.loopLength = num(ij.loopLength, 0, 0);
    ins.pingPong = !!ij.pingPong;
    ins.volume = num(ij.volume, 64, 0, 64);
    ins.gain = num(ij.gain, 1, 0, 1);
    ins.finetune = num(ij.finetune, 0, -8, 7);
    ins.transpose = num(ij.transpose, 0, -48, 48);
    ins.hold = num(ij.hold, 0, 0, 255);
    ins.decay = num(ij.decay, 0, 0, 255);
    ins.bits16 = !!ij.bits16;
    if (typeof ij.rate === "number" && ij.rate >= 1000 && ij.rate <= 192000) ins.rate = ij.rate;
    const vintage = cleanVintage(ij.vintage);
    if (vintage) ins.vintage = vintage;
    if (Array.isArray(ij.volTable)) (ins.volTable = ij.volTable), (ins.waveTable = ij.waveTable ?? []), (ins.volSpeed = ij.volSpeed), (ins.waveSpeed = ij.waveSpeed);
    if (ins.kind === "analog") ins.synth = sanitizeAnalog(ij.synth);
    else if (ins.kind === "drums") ins.drums = sanitizeKit(ij.drums);
    else if (ins.kind === "fm") ins.fm = sanitizeFm(ij.fm);
    else if (ins.kind === "chip") ins.chip = sanitizeChip(ij.chip);
    else if (ins.kind !== "empty" && !ins.data.length) ins.kind = "empty";
    instruments.push(ins);
  }
  const blocks = (j.blocks ?? []).map((bj: Record<string, any>, n: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const lines = num(bj.lines, 64, 1, 3200);
    const pages = num(bj.pages, 1, 1, 16);
    const b = newBlock(tracks, lines, pages, String(bj.name ?? ""));
    (bj.rows ?? []).slice(0, lines).forEach((row: string, l: number) => {
      String(row).split("|").slice(0, tracks).forEach((cellText, t) => {
        const parts = cellText.trim().split(/\s+/);
        const c = emptyCell(pages);
        c.note = parseNoteText(parts[0] ?? "---");
        const [instText, chordText] = (parts[1] ?? "..").split(":");
        c.inst = instText && instText !== ".." ? Math.min(63, parseInt(instText, 16) || 0) : 0;
        const chord = chordText ? parseInt(chordText, 16) : 0;
        if (chord >= 1 && chord <= 15) c.chord = chord;
        for (let p = 0; p < pages; p++) {
          const x = parts[2 + p];
          if (x && x !== "....") {
            if (!/^[0-9a-f]{4}$/i.test(x)) throw new Error(`song.json: block ${n}, line ${l}: "${x}" isn't a command`);
            c.cmd[p] = parseInt(x.slice(0, 2), 16);
            c.val[p] = parseInt(x.slice(2), 16);
          }
        }
        b.cells[l][t] = c;
      });
    });
    return b;
  });
  const modes: TempoMode[] = ["pt", "spd", "bpm"];
  const song: Song = {
    title: String(j.title ?? ""),
    // where it first came from: the replayer keeps that tracker's habits (an MMD's octave folding)
    format: typeof j.from === "string" && /^(MMD[0-3]|MOD .{1,6}|BMED)$/.test(j.from) ? j.from : "BMED",
    tracks,
    blocks: blocks.length ? blocks : [newBlock(tracks)],
    sequence: (Array.isArray(j.sequence) ? j.sequence : [0]).map((x: unknown) => num(x, 0, 0)).filter((x: number) => x < Math.max(1, blocks.length)),
    restart: num(j.restart, 0, 0),
    instruments,
    tempoMode: modes.includes(j.tempo?.mode) ? j.tempo.mode : "bpm",
    tempo: num(j.tempo?.tempo, 125, 1, 999),
    speed: num(j.tempo?.speed, 6, 1, 32),
    lpb: num(j.tempo?.lpb, 4, 1, 32),
    transpose: num(j.transpose, 0, -48, 48),
    noteShift: num(j.noteShift, 0, -48, 48),
    masterVolume: num(j.masterVolume, 64, 0, 64),
    trackVolume: Array.from({ length: tracks }, (_, t) => num(j.tracks?.[t]?.volume, 64, 0, 64)),
    trackPan: Array.from({ length: tracks }, (_, t) => num(j.tracks?.[t]?.pan, amigaPan(tracks)[t], -1, 1)),
    trackNames: Array.from({ length: tracks }, (_, t) => String(j.tracks?.[t]?.name ?? "").slice(0, 24)),
    flags: Object.fromEntries(
      Object.entries({ volHex: true, vol7bit: false, ptSlides: false, eightChannel: false, hardwareMix: true, filter: false }).map(([k, d]) => [k, typeof j.flags?.[k] === "boolean" ? j.flags[k] : d]),
    ) as unknown as Song["flags"],
  };
  if (!song.sequence.length) song.sequence = [0];
  if (j.chordColumn === true) song.chordColumn = true;
  const echo = cleanEcho(j.echo);
  if (echo) song.echo = echo;
  const swing = num(j.swing, 0, 0, 100);
  if (swing) song.swing = swing;
  const strum = Array.from({ length: tracks }, (_, t) => num(j.tracks?.[t]?.strum, 0, 0, MAX_STRUM_MS));
  if (strum.some((x) => x)) song.trackStrum = strum;
  if (Array.isArray(j.chords)) {
    // the song's own chord table: each line checked, a wrong one → the default's
    song.chords = DEFAULT_CHORDS.map((d, i) => {
      const x = j.chords[i];
      const notes = Array.isArray(x?.notes) ? x.notes.filter((n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= -24 && n <= 24 && n !== 0).slice(0, MAX_CHORD_NOTES) : [];
      return notes.length ? { name: String(x.name ?? "").slice(0, 8), notes } : { name: d.name, notes: [...d.notes] };
    });
  }
  return song;
}
