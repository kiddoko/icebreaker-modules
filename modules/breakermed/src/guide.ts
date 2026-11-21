/**
 * BreakerMED — the guide: what a first song needs (how to start, the edit mode,
 * the keys), the effect commands in hex, the sampler. The GUIDE screen (the ?
 * tab, the ? key, `med guide`) shows it; `med effects` prints the effects.
 * Edit the lists here: the screen and the commands follow.
 */
import type { IcebreakerAPI, KeyInput, Rect, UI } from "./icebreaker";

/** the effect commands, as the replayer plays them (replayer.ts) */
export const EFFECTS: [string, string][] = [
  ["00xy", "arpeggio: the note, +x, +y semitones, very fast (a chord on one track)"],
  ["01xx / 02xx", "slide the pitch up / down (xx: how fast)"],
  ["03xx", "slide to the note written (xx: speed) — a portamento"],
  ["04xy", "vibrato (x speed, y depth, twice ProTracker's)"],
  ["05xy / 06xy", "03 / 04 going on, with a volume slide"],
  ["07xy", "tremolo: the volume wobbles (x speed, y depth)"],
  ["09xx", "speed: ticks a line (01–20)"],
  ["0Axy / 0Dxy", "volume slide (x up, y down)"],
  ["0Bxx", "jump to position xx of the sequence"],
  ["0Cxx", "volume (decimal 00–64, or hex in hex mode)"],
  ["0Fxx", "tempo · 0F00 next block · F1 note twice · F2 half a line late · F3 three times · FE stop · FF note off"],
  ["11x / 12x", "fine slide up / down"],
  ["14xy", "vibrato, ProTracker's depth"],
  ["15x", "finetune (-8…7)"],
  ["16x", "loop: 1600 marks the start, 16x plays it x more times"],
  ["18x", "cut the note at tick x"],
  ["19xx", "start xx × 256 frames into the sample"],
  ["1Ax / 1Bx", "fine volume up / down"],
  ["1Dxx", "next block, at line xx"],
  ["1Ex", "play the line x more times"],
  ["1Fxy", "note x ticks late · y: again every y ticks"],
  ["2Exx", "pan (F0 left … 00 middle … 10 right)"],
];

export interface GuidePart {
  title: string;
  rows: [string, string][];
}

/** the guide, part by part: [what you press or type, what it does] */
export const GUIDE: GuidePart[] = [
  {
    title: "START",
    rows: [
      ["med new", "a new song: 8 tracks, drums and synths, a beat ready to play"],
      ["med new --chip", "a chiptune song: 2 pulses, a triangle, a noise (NES-style)"],
      ["med open", "open a .med, .mod or .bmed of the vault"],
      ["med demo", "the demo song"],
      ["med save", "save (a new song becomes a .bmed in songs/)"],
      ["med autosave", "on by default: a copy 1.5 s after each change, in songs/.recovery/ (never over the song)"],
      ["med recover", "changes never saved (a quit, a crash): back on the page · START offers them too (R)"],
      ["enter", "play the song from the cursor · ⇧enter: this block, again and again"],
      ["space", "stop · when stopped: EDIT MODE on / off"],
    ],
  },
  {
    title: "EDIT MODE (space: the line turns red, ● EDIT at the top)",
    rows: [
      ["the letter keys", "a piano: Z S X D C V… (bottom row) and Q 2 W 3 E R… (top row), by place"],
      ["`", "note off (^^^): the note stops, a synth releases"],
      ["0–9 A–F", "the hex columns: the instrument (2 digits), the chord, the command (4)"],
      ["delete · ⌫", "clear the column · delete the line (⇧: in every track)"],
      ["alt enter", "insert a line (⇧: in every track)"],
      ["alt ↑↓ · alt ←→", "the octave · the instrument the keys play"],
      ["alt 0–9", "the step: lines the cursor moves after a note"],
      ["⇧ arrows · drag", "select · alt C / X / V copy cut paste · alt Q / A transpose"],
      ["⌘Z · ⌘⇧Z", "undo · redo (notes, instruments, settings, mutes)"],
    ],
  },
  {
    title: "A CELL: C-3 01 . 0C20",
    rows: [
      ["C-3", "the note (C-1 … B-7) · ^^^ a note off"],
      ["01", "the instrument (01–3F, the list on the left)"],
      [".", "the chord (1–F of the song's table: med chords), when the song has chords"],
      ["0C20", "an effect: the command (0C) and its value (20) — the list below"],
    ],
  },
  { title: "EFFECTS (the last 4 hex digits of a cell: command, value)", rows: EFFECTS },
  {
    title: "THE SAMPLER (your own sounds)",
    rows: [
      ["med sampler", "load a sound into a free instrument (a list of the vault's sounds)"],
      ["INSTRUMENT tab", "on a free slot: “sampler · load a sound…”; on a sound: chop, stretch, fade, loop…"],
      ["med sample <n> load", "a .wav .aif .iff .mp3 .m4a .ogg… of the vault into instrument n"],
      ["med sample <n> chop 8", "8 slices, each a new instrument · chop onsets: a slice an attack"],
      ["med bounce", "this block, rendered into a new instrument"],
      ["med pack", "the starter sounds, recorded by people: which are there (med pack load <name>)"],
    ],
  },
  {
    title: "SCREENS (the tabs, or alt B I S E, ? for this guide)",
    rows: [
      ["BLOCK", "the notes, track by track"],
      ["INSTRUMENT", "the instrument the keys play: a sound's tools, a synth's settings, a drum kit"],
      ["SONG", "tempo, swing, echo, tracks: name, volume, pan, strum, mute, solo"],
      ["EXPORT", "WAV, AIFF, FLAC, MP3, M4A, OGG, Opus, with each track apart"],
      ["right-click", "a menu on a cell, a track's name, a position, an instrument"],
      ["med -h", "every command (all the mouse does, the shell does too)"],
    ],
  },
];

/** every row of the guide, flat: a part's title, then its rows */
const lines = (): ({ title: string } | { keys: string; what: string })[] =>
  GUIDE.flatMap((p, i) => [...(i ? [{ title: "" }] : []), { title: p.title }, ...p.rows.map(([keys, what]) => ({ keys, what }))]);

export function makeGuide(ib: IcebreakerAPI) {
  const { BOLD, t, truncate } = ib.lib;
  let scroll = 0;
  let height = 10;

  const draw = (ui: UI, r: Rect, focused: boolean) => {
    const c = ui.c;
    const inner = ui.box(r, { title: t("GUIDE"), focused });
    const all = lines();
    height = Math.max(1, inner.h - 1);
    scroll = Math.max(0, Math.min(scroll, all.length - height));
    const keyW = Math.min(22, Math.max(10, Math.floor(inner.w / 3)));
    for (let k = 0; k < height && scroll + k < all.length; k++) {
      const row = all[scroll + k], y = inner.y + k;
      if ("title" in row) ui.text(inner.x + 1, y, row.title ? t(row.title) : "", { fg: c.accent, attrs: BOLD }, inner.w - 2);
      else {
        ui.text(inner.x + 2, y, truncate(row.keys, keyW - 1), { fg: /^[0-9A-F]{2}/.test(row.keys) ? c.accentAlt : c.fg });
        ui.text(inner.x + 2 + keyW, y, t(row.what), { fg: c.muted }, inner.w - keyW - 3);
      }
    }
    ui.hit(inner, { onWheel: (d) => (scroll += Math.sign(d) * 3) });
    const more = all.length > height ? ` ${scroll + 1}–${Math.min(all.length, scroll + height)}/${all.length} · ↑↓ ` : " ";
    ui.text(inner.x + 1, inner.y + inner.h - 1, `${t("? or esc: back")} ·${more}· med guide · med effects`, { fg: c.subtle }, inner.w - 2);
  };

  const key = (k: KeyInput): boolean => {
    switch (k.key) {
      case "up": return (scroll = Math.max(0, scroll - 1)), true;
      case "down": return (scroll += 1), true;
      case "pageup": return (scroll = Math.max(0, scroll - height)), true;
      case "pagedown": case "space": return (scroll += height), true;
      case "home": return (scroll = 0), true;
      case "end": return (scroll = 9999), true;
    }
    return false;
  };

  /** the guide as text, for the shell */
  const text = () => GUIDE.map((p) => `${p.title}\n${p.rows.map(([a, b]) => `  ${a.padEnd(22)} ${b}`).join("\n")}`).join("\n\n") + "\n";

  return { draw, key, text, top: () => (scroll = 0) };
}
