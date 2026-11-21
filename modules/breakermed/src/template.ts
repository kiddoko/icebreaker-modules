/**
 * breakerMED — the "new song" template: 8 named tracks, a drum machine, an analog
 * bass, a lead, a pad and an FM e-piano for the chords, and a first bar written so
 * that ▶ plays something at once. Everything is computed (no sample to load).
 */
import { drumKit } from "./dsp/drums";
import { SYNTHS } from "./synths";
import { chipPreset } from "./dsp/chip";
import { emptyInstrument, MAX_TRACKS, newSong, type Instrument, type Song } from "./song";

/** the template's tracks, in order (a 9th track and more stay unnamed) */
export const TEMPLATE_TRACKS = ["kick", "snare", "hats", "bass", "lead", "pad", "chords", "fx"];

/** C-1 = 1: a note's number from its name in octave n ("C", 3) */
const note = (name: string, octave: number) => 1 + (octave - 1) * 12 + ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(name);

function synth(kind: "analog" | "fm", preset: string): Instrument {
  const sk = SYNTHS.find((s) => s.kind === kind)!;
  const i: Instrument = { ...emptyInstrument(), kind, name: `${sk.cmd} ${preset}` };
  (i as unknown as Record<string, object>)[sk.field] = sk.preset(preset);
  return i;
}

/** the chiptune template's tracks: the NES-style layout */
export const CHIP_TRACKS = ["pulse 1", "pulse 2", "triangle", "noise"];

function chip(preset: string): Instrument {
  const i: Instrument = { ...emptyInstrument(), kind: "chip", name: `chip ${preset}` };
  i.chip = chipPreset(preset);
  return i;
}

/**
 * The chiptune template (`med new --chip`): 4 tracks laid out like the NES's
 * (two pulses, a triangle, a noise), its instruments, and a bar written 4 times:
 * a lead, an arpeggio carrying the chords, a triangle bass, hats and snares.
 */
export function chipSong(): Song {
  const s = newSong(4);
  s.title = "untitled";
  s.chordColumn = true;
  s.trackNames = [...CHIP_TRACKS];
  s.tempo = 150;
  // 01 lead · 02 arp · 03 triangle bass · 04 snare · 05 hat · 06 kick
  s.instruments = ["2a03-lead", "2a03-arp", "2a03-bass", "2a03-snare", "2a03-hat", "2a03-kick"].map(chip);
  const b = s.blocks[0];
  const put = (line: number, track: number, n: number, inst: number, chord?: number) => {
    for (let at = line; at < b.lines; at += 16) {
      const c = b.cells[at][track];
      (c.note = n), (c.inst = inst);
      if (chord) c.chord = chord;
    }
  };
  for (const [l, nm, o] of [[0, "E", 4], [2, "G", 4], [4, "A", 4], [7, "G", 4], [8, "E", 4], [10, "D", 4], [12, "C", 4], [14, "D", 4]] as const) put(l, 0, note(nm, o), 1);
  put(0, 1, note("A", 3), 2, 2); // A minor, arpeggiated
  put(8, 1, note("F", 3), 2, 1); // F major
  for (const [l, nm] of [[0, "A"], [4, "A"], [8, "F"], [12, "G"]] as const) put(l, 2, note(nm, 2), 3);
  for (let l = 0; l < 16; l += 2) put(l, 3, note("C", 5), 5); // hats
  for (const l of [4, 12]) put(l, 3, note("C", 4), 4); // snares
  put(0, 3, note("C", 3), 6); // a kick on the one
  return s;
}

/** A new song ready to play: `tracks` tracks (8 by default), the template's instruments and a first bar. */
export function templateSong(tracks = TEMPLATE_TRACKS.length): Song {
  const n = Math.max(1, Math.min(MAX_TRACKS, tracks));
  const s = newSong(n);
  s.title = "untitled";
  s.chordColumn = true;
  s.trackNames = Array.from({ length: n }, (_, t) => TEMPLATE_TRACKS[t] ?? "");
  // 01 drums · 02 bass · 03 lead · 04 pad · 05 e-piano
  s.instruments = [
    { ...emptyInstrument(), kind: "drums", name: "drums classic", drums: drumKit("classic") },
    synth("analog", "bass"),
    synth("analog", "lead"),
    synth("analog", "pad"),
    synth("fm", "epiano"),
  ];
  // a bar (16 lines at 4 lines a beat): a beat, a bass line, two chords
  const b = s.blocks[0];
  // written in each of the block's 4 bars
  const put = (line: number, track: number, n: number, inst: number, chord?: number) => {
    if (track >= s.tracks) return;
    for (let at = line; at < b.lines; at += 16) {
      const c = b.cells[at][track];
      (c.note = n), (c.inst = inst);
      if (chord) c.chord = chord;
    }
  };
  for (const l of [0, 6, 8]) put(l, 0, note("C", 3), 1); // kick
  for (const l of [4, 12]) put(l, 1, note("D", 3), 1); // snare
  for (let l = 0; l < 16; l += 2) put(l, 2, note("E", 3), 1); // closed hats
  put(10, 2, note("F#", 3), 1); // an open hat
  for (const [l, nm] of [[0, "C"], [3, "C"], [6, "D#"], [8, "F"], [11, "G"], [14, "D#"]] as const) put(l, 3, note(nm, 2), 2);
  put(0, 6, note("C", 3), 5, 2); // C minor on the e-piano (chord 2)
  put(8, 6, note("G#", 2), 5, 1); // A♭ major
  return s;
}
