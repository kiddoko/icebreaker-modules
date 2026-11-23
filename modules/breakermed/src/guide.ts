/**
 * BreakerMED — the guide: what a first song needs (how to start, the edit mode,
 * the keys), the effect commands in hex, the sampler. The GUIDE screen (the ?
 * tab, the ? key, `med guide`) shows it; `med effects` prints the effects.
 * Edit the lists here: the screen and the commands follow.
 */
import type { IcebreakerAPI, KeyInput, Rect, UI } from "./icebreaker";
import { hex, type Song } from "./song";

/** the effect commands, as the replayer plays them (replayer.ts) */
export const EFFECTS: [string, string][] = [
  ["00xy", "arpeggio: the note, +x, +y semitones, very fast (a chord on one track)"],
  ["01xx / 02xx", "slide the pitch up / down (xx: how fast)"],
  ["03xx", "slide to the note written (xx: speed) — a portamento"],
  ["04xy", "vibrato (x speed, y depth, twice ProTracker's)"],
  ["05xy / 06xy", "03 / 04 going on, with a volume slide"],
  ["07xy", "tremolo: the volume wobbles (x speed, y depth)"],
  ["09xx", "speed: ticks a line (01–20) · ProTracker's Fxx below 20"],
  ["0Axy / 0Dxy", "volume slide (x up, y down)"],
  ["0Bxx", "jump to position xx of the sequence"],
  ["0Cxx", "volume: 00–40 hex in a new song, 0C40 the loudest (old OctaMED songs: decimal 00–64)"],
  ["0Fxx", "tempo in BPM (the speed is 09xx) · 0F00 next block · F1 note twice · F2 half a line late · F3 three times · F8 / F9 LED filter off / on · FE stop · FF note off"],
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

const n2 = (v: number) => hex(v);
/**
 * A command in words, as the replayer plays it in this song (the status line
 * says it under the cursor): "0C20 · volume 32 of 64", "0F06 · tempo 6 BPM
 * (the speed is 09xx)". Line numbers are said in decimal, like the block's.
 */
export function describe(cmd: number, v: number, song: Pick<Song, "tempoMode" | "flags">, t: (s: string) => string = (s) => s): string {
  const code = `${n2(cmd)}${n2(v)}`;
  const x = v >> 4, y = v & 15;
  const said = (() => {
    switch (cmd) {
      case 0x00: return v ? `${t("arpeggio")} +${x} +${y}` : "";
      case 0x01: return `${t("slide up")} ${v}`;
      case 0x02: return `${t("slide down")} ${v}`;
      case 0x03: return `${t("slide to the note")}${v ? `, ${t("speed")} ${v}` : ""}`;
      case 0x04: return `${t("vibrato")} ${t("speed")} ${x} ${t("depth")} ${y}`;
      case 0x05: return `${t("slide to the note + volume slide")}`;
      case 0x06: return `${t("vibrato + volume slide")}`;
      case 0x07: return `${t("tremolo")} ${t("speed")} ${x} ${t("depth")} ${y}`;
      case 0x09: return v > 0 && v <= 0x20 ? `${t("speed")}: ${v} ${t("ticks a line")}` : `${t("speed")}: ${t("01–20 only")}`;
      case 0x0a: case 0x0d: return x ? `${t("volume up")} ${x} ${t("a tick")}` : `${t("volume down")} ${y} ${t("a tick")}`;
      case 0x0b: return `${t("jump to position")} ${n2(v)}`;
      case 0x0c: {
        const vol = song.flags.vol7bit ? ((v & 0x7f) + 1) >> 1 : song.flags.volHex ? Math.min(64, v & 0x7f) : v < 0x99 ? Math.min(64, x * 10 + y) : 64;
        return `${t("volume")} ${vol} ${t("of 64")}`;
      }
      case 0x0f: {
        if (v === 0) return t("next block");
        if (v === 0xf1) return t("the note twice");
        if (v === 0xf2) return t("the note half a line late");
        if (v === 0xf3) return t("the note three times");
        if (v === 0xf8) return t("LED filter off");
        if (v === 0xf9) return t("LED filter on");
        if (v === 0xfe) return t("the song stops");
        if (v === 0xff) return t("note off");
        if (v > 0xf0) return t("nothing (0FF1–F3, F8, F9, FE, FF)");
        if (song.tempoMode === "pt") return v >= 0x20 ? `${t("tempo")} ${v} BPM` : `${t("nothing here: the speed is 09xx")}`;
        return `${t("tempo")} ${v}${song.tempoMode === "spd" ? "" : " BPM"} (${t("the speed is 09xx")})`;
      }
      case 0x11: return `${t("fine slide up")} ${y}`;
      case 0x12: return `${t("fine slide down")} ${y}`;
      case 0x14: return `${t("vibrato (ProTracker's depth)")} ${t("speed")} ${x} ${t("depth")} ${y}`;
      case 0x15: return `${t("finetune")} ${y > 7 ? y - 16 : y}`;
      case 0x16: return y ? `${t("loop: back to the mark")} ×${y}` : t("loop: the start mark");
      case 0x18: return `${t("cut the note at tick")} ${v}`;
      case 0x19: return `${t("start")} ${v * 256} ${t("frames into the sample")}`;
      case 0x1a: return `${t("fine volume up")} ${y}`;
      case 0x1b: return `${t("fine volume down")} ${y}`;
      case 0x1d: return `${t("next block, at line")} ${v}`;
      case 0x1e: return `${t("the line")} ${Math.min(15, v)} ${t("more times")}`;
      case 0x1f: return `${t("the note")} ${x} ${t("ticks late")}${y ? `, ${t("again every")} ${y}` : ""}`;
      case 0x2e: {
        const p = v > 127 ? v - 256 : v;
        return p >= -16 && p <= 16 ? `${t("pan")} ${p < 0 ? `${t("left")} ${-p}` : p > 0 ? `${t("right")} ${p}` : t("middle")}` : `${t("pan")}: F0–10 ${t("only")}`;
      }
    }
    return "";
  })();
  return `${code} · ${said || `${t("no such command here")} (med effects)`}`;
}

export interface GuidePart {
  title: string;
  rows: [string, string][];
}

/** the guide, part by part: [what you press or type, what it does] */
export const GUIDE: GuidePart[] = [
  {
    title: "START",
    rows: [
      ["med new", "a new song: 8 tracks, drums and synths, a beat ready to play (med new 12: 12 tracks · --empty: a blank page)"],
      ["med new --chip", "a chiptune song: 2 pulses, a triangle, a noise (NES-style)"],
      ["med open", "open a .med, .mod or .bmed in songs/"],
      ["med demo", "the demo song"],
      ["med save · ⌘S", "save (a new song asks for its name: never over another song)"],
      ["med saveas · ⌘⇧S", "save under another name"],
      ["med continue", "back to the song in memory, after the page was closed"],
      ["med autosave", "on by default: a copy 1.5 s after each change, in songs/.recovery/ (never over the song)"],
      ["med recover", "changes never saved (a quit, a crash): back on the page · START offers them too (R)"],
      ["⏎", "play the song from the top of this block · again while it plays: the block starts over"],
      ["⇧⏎", "this block, looped, from its top"],
      ["⇧space", "play from the cursor's line"],
      ["space", "stop · when stopped: EDIT MODE on / off (or click “edit” at the top)"],
      ["med new, open, demo", "a song with changes asks first: save, don't save, cancel"],
    ],
  },
  {
    title: "EDIT MODE (space: the line turns red, ● edit at the top)",
    rows: [
      ["the letter keys", "a piano: Z S X D C V… (bottom row) and Q 2 W 3 E R… (top row), by place"],
      ["F1–F8", "the octave the keys play (alt ↑↓ too)"],
      ["` · 1 · caps lock", "note off (^^^): the note stops, a synth releases"],
      ["0–9 A–F", "the hex columns: the instrument (2 digits), the chord, the command (4)"],
      ["delete · ⌫", "clear the column · delete the line (⇧: in every track) — in edit mode only"],
      ["alt ⏎ · insert", "insert a line (⇧: in every track)"],
      ["alt ↑↓ · alt ←→", "the octave · the instrument the keys play"],
      ["alt 0–9", "the step: lines the cursor moves after a note"],
      ["⇧ arrows · drag", "select · alt L the track · alt K the block · alt C / X / V copy cut paste"],
      ["alt PgUp · alt PgDn", "transpose a semitone (⇧: an octave) — the same on every keyboard (alt Q / A too)"],
      ["⌘Z · ⌘⇧Z", "undo · redo (the cursor goes where it changed back)"],
      ["playing, edit mode on", "● REC: the keys record where the song is"],
      ["the status line", "says the command under the cursor in words (0C20 · volume 32 of 64)"],
    ],
  },
  {
    title: "MOVING AROUND",
    rows: [
      ["↑↓ ←→ · PgUp PgDn", "the cursor · 16 lines · home / end: the block's first / last line"],
      ["the line numbers", "in decimal, like OctaMED (the commands' values are hex)"],
      ["the wheel on the block", "2 lines a notch"],
      ["tab · ⇧tab", "the next track · the one before (←→ walk the columns into the next one too)"],
      ["⌘←→ · ⇧ alt ←→", "the position before · after in the sequence"],
      ["alt F · scroll lock", "follow the song while it plays, or not (the cursor stays where you edit)"],
      ["med view center|edges", "the cursor's line in the middle (the default), or a view that scrolls at its edges"],
      ["med click on", "the metronome: a click on each beat while playing"],
      ["the sequence", "‹ › or the wheel: another block · drag: move it · right-click: use block…, move, insert"],
      ["alt N · alt D · alt ⌫", "a new block after this position · a copy of this block after it · remove this position"],
      ["alt M · ⇧ alt M", "mute the cursor's track · solo it (again: back)"],
      ["the track's ■", "mute (lit while it plays) · right-click the name: solo, rename"],
      ["the top line", "each part clicks (▶ play, edit, the tempo, stepped / smooth, follow…), the wheel changes them"],
      ["? · alt G", "this guide"],
    ],
  },
  {
    title: "A CELL: C-3 01 . 0C20",
    rows: [
      ["C-3", "the note (C-1 … B-9) · ^^^ a note off"],
      ["01", "the instrument (01–3F, the list on the left)"],
      [".", "the chord (1–F of the song's table: med chords), when the song has chords"],
      ["0C20", "an effect: the command (0C) and its value (20) — the list below"],
    ],
  },
  { title: "EFFECTS (the last 4 hex digits of a cell: command, value)", rows: EFFECTS },
  {
    title: "THE SAMPLER (your own sounds)",
    rows: [
      ["med sampler", "load a sound into a free instrument (a list of the sounds in songs/)"],
      ["INSTRUMENT tab", "on a free slot: “sampler · load a sound…”; on a sound: chop, stretch, fade, loop…"],
      ["med sample <n> load", "a .wav .aif .iff .mp3 .m4a .ogg… in songs/ into instrument n: it keeps its own rate (--amiga: the Amiga's)"],
      ["med sample <n> chop 8", "8 slices, each a new instrument · chop onsets: a slice an attack"],
      ["med bounce", "this block, rendered into a new instrument"],
      ["med pack", "the starter sounds: recorded by people, computed placeholders until then (med pack load <name>)"],
      ["alt R · med vintage", "the instrument heard through an Amiga (8 bits, the A500's filter) or an Akai S900 / S950-style sampler (12 bits, aliasing)"],
    ],
  },
  {
    title: "SCREENS (the tabs, or alt B I S E, ? for this guide)",
    rows: [
      ["BLOCK", "the notes, track by track"],
      ["INSTRUMENT", "the instrument the keys play: a sound's tools, a synth's settings, a drum kit, its vintage mode"],
      ["SONG", "tempo, swing, echo, tracks: name, volume, pan, strum, mute, solo"],
      ["EXPORT", "WAV, AIFF, FLAC, MP3, M4A, OGG, Opus, with each track apart"],
      ["right-click", "a menu on a cell, a track's name, a position, an instrument"],
      ["med -h · med help", "every command (all the mouse does, the shell does too)"],
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
    ui.text(inner.x + 1, inner.y + inner.h - 1, `${t("? or ⌫: back")} ·${more}· med guide · med effects`, { fg: c.subtle }, inner.w - 2);
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
