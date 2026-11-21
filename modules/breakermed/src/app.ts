/**
 * BreakerMED — the page. Left: the play sequence and the instruments; right:
 * the block, its tracks side by side, one line a step, the cursor's line in the
 * middle (the line being heard, while the song plays).
 *
 * Playing, the sequence, the song's shape go through `med` commands (the LOG
 * shows them, keys and macros reuse them). What you type in the block (notes,
 * hex digits, blocks of cells) is edited right here, through the Editor
 * (edit.ts, undoable): a command a keystroke would flood the LOG and lag the
 * keys. `med note` / `med block…` do the same from the shell.
 *
 * The page plays the keyboard (rawKeys): every key comes with its place, and
 * ⌥ / alt combinations are its own on every system. Esc gives the keys back to
 * the deck (the tree takes the focus), a click brings them back.
 *
 *   enter play the song · ⇧enter play the block · space stop / edit mode
 *   ↑↓ ←→ PgUp PgDn the cursor · ⇧ + arrows select
 *   the keys: a piano (keys.ts) · 0–9 A–F the hex columns · ` note off
 *   delete clear · ⌫ delete the line · alt enter insert a line (⇧: in every track)
 *   alt ↑↓ octave · alt ←→ instrument · alt 0–9 edit step
 *   alt C / X / V copy cut paste · alt Q / A transpose (⇧: an octave) · ⌘Z ⌘⇧Z undo redo
 *   the chord column (when the song has chords): one digit, 1–F of the song's table
 *
 * The tabs over the right side (or alt B / I / S / E): the BLOCK; the INSTRUMENT
 * (a sample's tools, a synth's settings ↑↓ ←→, a kit's drums: ↑↓ a drum, ←→ a
 * setting, ⇧←→ its value, or a free slot's choices); the SONG (its settings and
 * tracks) and EXPORT (one window for med export): screens.ts.
 */
import type { Action, App, IcebreakerAPI, KeyInput, MenuEntry, Rect, UI } from "./icebreaker";
import { CHORD_COL, CMD_COL, colKind, colsOf, Editor, type Clip, type Selection } from "./edit";
import type { Engine } from "./engine";
import { pianoKey } from "./keys";
import { nudgeIn, showIn } from "./dsp/params";
import { settingsOf, synthOf, type SynthKind } from "./synths";
import { DRUM_KITS, DRUM_NAMES, DRUM_NOTES, DRUM_SETTINGS, nudgeDrum } from "./dsp/drums";
import { makeScreens, newExportChoices, type ExportChoices, type Screen } from "./screens";
import { chordsOf, hex, noteName, NOTE_OFF, PAULA_CLOCK, periodOf, ptBpmOf, type Song } from "./song";

export interface State {
  song: Song | null;
  editor: Editor | null;
  path: string;
  /** the cursor (and where "play" starts) */
  seq: number;
  line: number;
  track: number;
  col: number;
  /** the instrument the keyboard plays (index) */
  inst: number;
  /** 0 = the piano's bottom row is C-1 */
  octave: number;
  /** typing writes in the block (else the keys only play) */
  edit: boolean;
  /** lines the cursor moves after a note */
  step: number;
  sel: Selection | null;
  clip: Clip | null;
  error: string;
  /** what the right side shows (the tabs, alt B / I / S / E) */
  screen: Screen;
  /** the SONG screen's cursor: a setting or a track (past the settings), a track's column */
  songRow: number;
  songCol: number;
  /** the EXPORT screen: its choices, and its cursor (one past the rows: the button) */
  exp: ExportChoices;
  expRow: number;
  /** the synth setting the INSTRUMENT screen's cursor is on */
  synthRow: number;
  /** the drum machine's cursor: a drum (0–11), a setting (0–3) */
  drumRow: number;
  drumCol: number;
}

/**
 * ⌘Z / ⌘⇧Z (and med undo / redo): if it takes away the instrument the keys
 * play (a load, a chop, a bounce undone), the keys go to the nearest one left.
 */
export function undoRedo(st: State, redo: boolean): string | null {
  const s = st.song, e = st.editor;
  if (!s || !e) return null;
  const had = s.instruments[st.inst] && s.instruments[st.inst].kind !== "empty";
  const label = redo ? e.redo() : e.undo();
  const now = s.instruments[st.inst];
  if (had && (!now || now.kind === "empty")) {
    let k = Math.min(st.inst, s.instruments.length - 1);
    while (k > 0 && s.instruments[k]?.kind === "empty") k--;
    st.inst = Math.max(0, k);
  }
  return label;
}

export function newState(): State {
  return { song: null, editor: null, path: "", seq: 0, line: 0, track: 0, col: 0, inst: 0, octave: 2, edit: false, step: 1, sel: null, clip: null, error: "", screen: "block", songRow: 0, songCol: 0, exp: newExportChoices(), expRow: 0, synthRow: 0, drumRow: 0, drumCol: 0 };
}

/** a cell's width: "C-3 01 0C20" and 5 more a command page; where each column starts in it */
/** a cell's width: "C-3 01 0C20", and " 3" when the chord column shows */
const cellW = (pages: number, chords: boolean) => 3 + 1 + 2 + (chords ? 2 : 0) + pages * 5;
/** where a column sits in its cell */
const colX = (col: number, chords: boolean) =>
  col === 0 ? 0 : col <= 2 ? 3 + col : col === CHORD_COL ? 7 : (chords ? 9 : 7) + Math.floor((col - CMD_COL) / 4) * 5 + ((col - CMD_COL) % 4);
const colW = (col: number) => (col === 0 ? 3 : 1);
const LEFT = 22;
const HEX = "0123456789abcdef";

export function makeApp(ib: IcebreakerAPI, engine: Engine, st: State): App {
  const { BOLD, t, truncate, ListView, mix, q } = ib.lib;
  const run = (line: string) => void ib.shell.run(line);
  const seqList = new ListView<number>();
  const instList = new ListView<number>();
  seqList.cmdOf = (i) => `med pos ${hex(i)}`;
  seqList.onActivate = (i) => run(`med play song ${hex(i)}`);
  seqList.menuOf = (i) => [
    { label: t("play from here"), cmd: `med play song ${hex(i)}` },
    "-",
    { label: t("insert a new block here"), cmd: `med seq new ${hex(i)}` },
    { label: t("insert a copy of this block"), cmd: `med seq copy ${hex(i)}` },
    { label: t("remove this position"), cmd: `med seq rm ${hex(i)}`, danger: true },
  ];
  const screens = makeScreens(ib, engine, st);
  instList.onSelect = (i) => (st.inst = i);
  instList.onActivate = (i) => preview(st.octave * 12, i);
  /** first track shown (the page scrolls sideways when they don't fit) */
  let firstTrack = 0;
  /** where the block was drawn (mouse → cell) */
  let geo: { x: number; y: number; w: number; h: number; numW: number; cw: number; top: number; fits: number } | null = null;
  let anchor: { line: number; track: number } | null = null;

  const song = () => st.song;
  const blockNo = () => st.song?.sequence[st.seq] ?? 0;
  const block = () => st.song?.blocks[blockNo()];
  const ed = () => st.editor;

  const preview = (semi: number, inst = st.inst) => {
    const s = st.song;
    const ins = s?.instruments[inst];
    if (!s || !ins || ins.kind === "empty") return;
    if (ins.kind === "drums") st.drumRow = (((semi + ins.transpose + s.transpose) % 12) + 12) % 12; // the screen follows the drum played
    const rate = PAULA_CLOCK / periodOf(semi + ins.transpose + s.transpose, ins.finetune);
    void engine.preview(inst, rate).catch((e) => ib.ui.notify(String(e?.message ?? e), "error"));
  };

  const clampCursor = () => {
    const s = song(), b = block();
    if (!s || !b) return;
    st.line = Math.max(0, Math.min(b.lines - 1, st.line));
    st.track = Math.max(0, Math.min(s.tracks - 1, st.track));
    st.col = Math.max(0, Math.min(colsOf(b.pages) - 1, st.col));
  };
  const moveLine = (d: number) => ((st.line += d), clampCursor());
  /** ←→ go column by column, into the next track at a cell's edge */
  const moveCol = (d: number) => {
    const s = song(), b = block();
    if (!s || !b) return;
    const n = colsOf(b.pages);
    let c = st.col + d, tr = st.track;
    if (c === CHORD_COL && !s.chordColumn) c += d; // the chord column, hidden: stepped over
    if (c < 0) (tr = (tr - 1 + s.tracks) % s.tracks), (c = n - 1);
    else if (c >= n) (tr = (tr + 1) % s.tracks), (c = 0);
    st.col = c;
    st.track = tr;
  };
  /** ⇧ + arrows: the selection grows from where it started */
  const extend = (dl: number, dt: number) => {
    anchor ??= { line: st.line, track: st.track };
    st.line += dl;
    st.track += dt;
    clampCursor();
    st.sel = { block: blockNo(), line0: Math.min(anchor.line, st.line), line1: Math.max(anchor.line, st.line), track0: Math.min(anchor.track, st.track), track1: Math.max(anchor.track, st.track) };
  };
  const unselect = () => ((st.sel = null), (anchor = null));
  /** what an operation works on: the selection, or the cell under the cursor */
  const target = (): Selection => st.sel && st.sel.block === blockNo() ? st.sel : { block: blockNo(), line0: st.line, line1: st.line, track0: st.track, track1: st.track };
  const advance = () => moveLine(st.step);

  const typeNote = (note: number) => {
    const e = ed();
    if (!e) return;
    e.writeNote(blockNo(), st.line, st.track, note, note === NOTE_OFF ? 0 : st.inst + 1);
    advance();
  };

  const copy = () => {
    const e = ed();
    if (e) (st.clip = e.copy(target())), ib.ui.notify(t("copied"));
  };
  const cut = () => {
    const e = ed();
    if (e) (st.clip = e.cut(target())), unselect();
  };
  const paste = () => {
    const e = ed();
    if (e && st.clip) e.paste(blockNo(), st.line, st.track, st.clip);
  };
  /** the chord under the cursor, named (the column shows only its digit) */
  const chordHere = () => {
    const s = st.song, cell = block()?.cells[st.line]?.[st.track];
    if (!s?.chordColumn || !cell) return "";
    const n = cell.chord ?? 0;
    return n ? ` · ${t("chord")} ${n.toString(16).toUpperCase()} ${chordsOf(s)[n - 1]?.name ?? ""}` : st.col === CHORD_COL ? ` · ${t("chord")}: 1–F (med chords)` : "";
  };
  const transpose = (semis: number) => ed()?.transpose(target(), semis);
  const say = (label: string | null, what: string) => ib.ui.notify(label ? `${what}: ${t(label)}` : t("nothing to undo"));

  /** The INSTRUMENT screen: the sound drawn in braille dots (the loop lit), what it is, a button a tool. */
  const drawInstrument = (ui: UI, r: Rect, focused: boolean) => {
    const c = ui.c;
    const s = st.song!;
    const ins = s.instruments[st.inst];
    const n = hex(st.inst + 1);
    const inner = ui.box(r, { title: `${t("INSTRUMENT")} ${n}${ins?.name ? ` · ${ins.name}` : ""}`, focused });
    const sk = synthOf(ins);
    if (sk && ins && settingsOf(ins, sk)) return drawSynth(ui, inner, focused, sk);
    if (ins?.kind === "drums" && ins.drums) return drawDrums(ui, inner, focused);
    if (!ins || ins.kind === "empty" || !ins.data.length) {
      ui.text(inner.x + 1, inner.y + 1, t("empty — load a sound, or make a synth:"), { fg: c.muted }, inner.w - 2);
      const choices: [string, string, string][] = [
        ["load…", `med sample ${n} load`, "a .wav, .aif, .iff, .mp3, .m4a, .ogg… of the vault"],
        ["analog synth", `med synth ${n} new`, "two oscillators, a filter, two envelopes, an LFO"],
        ["FM synth", `med fm ${n} new`, "two sine waves, one bending the other: pianos, bells, basses"],
        ["chip synth", `med chip ${n} new 2a03-lead`, "old consoles' sound chips, for chiptune: NES, Game Boy, C64, AY, SN76489, PC Engine-style"],
        ["drum machine", `med drums ${n} new`, "twelve drums, one a note: C kick, D snare, E hat…"],
      ];
      let x = inner.x + 1, y = inner.y + 3;
      for (const [label, cmd, tip] of choices) {
        if (x + t(label).length + 2 > inner.x + inner.w - 1) (x = inner.x + 1), (y += 2); // no room: the next line
        x += ui.button(x, y, t(label), () => {}, { cmd, tip: t(tip) }) + 1;
      }
      return;
    }
    // the wave: each cell is 2 × 4 dots; each dot column the min…max of its part of the sound
    const waveH = Math.max(3, Math.min(10, inner.h - 9));
    const W = inner.w - 2;
    const d = ins.data;
    const cols = W * 2, rows = waveH * 4;
    const loopA = ins.loopLength ? ins.loopStart : -1, loopB = ins.loopLength ? ins.loopStart + ins.loopLength : -1;
    for (let cx = 0; cx < W; cx++) {
      const cells = new Array(waveH).fill(0);
      let inLoop = false;
      for (let sub = 0; sub < 2; sub++) {
        const col = cx * 2 + sub;
        const a = Math.floor((col / cols) * d.length), b = Math.max(a + 1, Math.floor(((col + 1) / cols) * d.length));
        let lo = 1, hi = -1;
        for (let i = a; i < b && i < d.length; i++) (lo = Math.min(lo, d[i])), (hi = Math.max(hi, d[i]));
        if (a >= loopA && a < loopB) inLoop = true;
        const top = Math.max(0, Math.min(rows - 1, Math.floor(((1 - hi) / 2) * rows)));
        const bot = Math.max(0, Math.min(rows - 1, Math.floor(((1 - lo) / 2) * rows)));
        for (let y = top; y <= bot; y++) {
          const row = y % 4;
          const bit = row === 3 ? (sub ? 7 : 6) : sub ? 3 + row : row;
          cells[Math.floor(y / 4)] |= 1 << bit;
        }
      }
      cells.forEach((bits, k) => bits && ui.text(inner.x + 1 + cx, inner.y + k, String.fromCharCode(0x2800 + bits), { fg: inLoop ? c.accentAlt : c.accent }));
    }
    let y = inner.y + waveH;
    const secs = d.length / (16574 * (ins.transpose >= 12 ? 2 : 1));
    ui.text(inner.x + 1, y++, `${d.length} ${t("frames")} · ~${secs.toFixed(2)} s ${t("at C-3")} · vol ${ins.volume} · fine ${ins.finetune} · ${t("transpose")} ${ins.transpose}${ins.loopLength ? ` · ${t("loop")} ${ins.loopStart}+${ins.loopLength}${ins.pingPong ? " ↔" : ""}` : ""}${s.flags.filter ? ` · ${t("LED filter")}` : ""}`, { fg: c.muted }, inner.w - 2);
    y++;
    const tools: [string, string, string][] = [
      ["load…", `med sample ${n} load`, "replace this sound with a file of the vault"],
      ["chop 4", `med sample ${n} chop 4`, "4 equal slices → new instruments"],
      ["chop 8", `med sample ${n} chop 8`, "8 equal slices → new instruments"],
      ["chop at attacks", `med sample ${n} chop onsets`, "a slice at each attack"],
      ["stretch ×2", `med sample ${n} stretch 2`, "twice as long, same pitch (Amiga grains)"],
      ["stretch ×½", `med sample ${n} stretch 0.5`, "half as long, same pitch"],
      ["fade in", `med sample ${n} fade in`, ""],
      ["fade out", `med sample ${n} fade out`, ""],
      ["pitch +12", `med sample ${n} pitch 12`, "an octave up (half the frames)"],
      ["pitch −12", `med sample ${n} pitch -12`, "an octave down"],
      ["reverse", `med sample ${n} reverse`, ""],
      ["8-bit", `med sample ${n} crush 8`, "destructive 8 bits: the grit"],
      ["4-bit ×2", `med sample ${n} crush 4 2`, "4 bits, half the rate: more grit"],
      ["normalize", `med sample ${n} normalize`, ""],
      ["trim", `med sample ${n} trim`, "remove the silence at both ends"],
      ["loop off", `med sample ${n} loop off`, ""],
      ["ping-pong", `med sample ${n} loop pingpong`, "the loop goes back and forth"],
      ["bounce block", "med bounce", "this block, rendered into a new instrument"],
      [s.flags.filter ? "LED filter off" : "LED filter on", `med filter ${s.flags.filter ? "off" : "on"}`, "the A500's low-pass (0FF9 / 0FF8)"],
    ];
    let x = inner.x + 1;
    for (const [label, cmd, tip] of tools) {
      const w = label.length + 2;
      if (x + w > inner.x + inner.w - 1) (x = inner.x + 1), y++;
      if (y >= inner.y + inner.h) break;
      x += ui.button(x, y, t(label), () => {}, { cmd, tip: tip ? t(tip) : undefined }) + 1;
    }
    ui.text(inner.x + 1, inner.y + inner.h - 1, t("the keys play it · alt ←→ another · alt B the block · med sample -h"), { fg: c.subtle }, inner.w - 2);
  };

  /** one step of a synth setting (←→, the ‹ › buttons, the wheel): straight to the editor, undoable */
  const nudge = (row: number, dir: 1 | -1, big = false) => {
    const sk = synthOf(st.song?.instruments[st.inst]);
    const def = sk?.params[row];
    if (sk && def) ed()?.instrument(st.inst, def.label, (i) => {
      const p = settingsOf(i, sk);
      if (p) nudgeIn(sk.params, p, def.key, dir, big);
    });
  };

  /** A synth's settings (analog or FM): a row each (‹ value ›), the presets above. */
  const drawSynth = (ui: UI, inner: Rect, focused: boolean, sk: SynthKind) => {
    const c = ui.c;
    const n = hex(st.inst + 1);
    const p = settingsOf(st.song!.instruments[st.inst], sk)!;
    const PARAMS = sk.params;
    let x = inner.x + 1;
    ui.text(x, inner.y, t("preset"), { fg: c.muted });
    x += t("preset").length + 1;
    for (const name of sk.presetsFor?.(p) ?? sk.presets) {
      if (x + name.length + 2 > inner.x + inner.w - 1) break;
      x += ui.button(x, inner.y, name, () => {}, { cmd: `med ${sk.cmd} ${n} preset ${name}`, quiet: true }) + 1;
    }
    const top = inner.y + 2;
    const h = Math.max(1, inner.h - 3);
    const colW = 36;
    const cols = Math.max(1, Math.min(2, Math.floor((inner.w - 1) / colW)));
    const perCol = Math.ceil(PARAMS.length / cols);
    // too many rows for the height: the column scrolls with the cursor
    const scroll = perCol > h ? Math.max(0, Math.min(perCol - h, (st.synthRow % perCol) - Math.floor(h / 2))) : 0;
    st.synthRow = Math.max(0, Math.min(PARAMS.length - 1, st.synthRow));
    PARAMS.forEach((def, i) => {
      const col = Math.floor(i / perCol), row = (i % perCol) - scroll;
      if (row < 0 || row >= h) return;
      const x0 = inner.x + 1 + col * colW, y = top + row;
      const on = i === st.synthRow;
      ui.text(x0, y, t(def.label).padEnd(18).slice(0, 18), { fg: on ? c.fg : c.muted });
      ui.button(x0 + 19, y, "‹", () => ((st.synthRow = i), nudge(i, -1)), { quiet: !on });
      ui.text(x0 + 23, y, showIn(p, def).padEnd(9).slice(0, 9), { fg: on ? c.accent : c.fg });
      ui.button(x0 + 32, y, "›", () => ((st.synthRow = i), nudge(i, 1)), { quiet: !on });
      ui.hit({ x: x0, y, w: 18, h: 1 }, { onClick: () => (st.synthRow = i), onWheel: (d: number) => nudge(i, d < 0 ? 1 : -1) });
      ui.hit({ x: x0 + 22, y, w: 10, h: 1 }, { onClick: () => (st.synthRow = i), onWheel: (d: number) => nudge(i, d < 0 ? 1 : -1) });
      if (on && focused) ui.tint({ x: x0, y, w: 18, h: 1 }, undefined, c.highlight);
    });
    ui.text(inner.x + 1, inner.y + inner.h - 1, t("the keys play it · ↑↓ a setting · ←→ change it (⇧ more) · med -h"), { fg: c.subtle }, inner.w - 2);
  };

  /** one step of a drum's setting (⇧←→, the ‹ › buttons, the wheel); the kit's grit */
  const nudgeKit = (drum: number, col: number, dir: 1 | -1, big = false) => {
    const key = DRUM_SETTINGS[col]?.key;
    if (key) ed()?.instrument(st.inst, `${DRUM_NAMES[drum]} ${key}`, (i) => i.drums && nudgeDrum(i.drums, drum, key, dir, big));
  };
  const nudgeGrit = (what: "bits" | "hold", dir: 1 | -1) =>
    ed()?.instrument(st.inst, "grit", (i) => {
      if (!i.drums) return;
      i.drums[what] = Math.max(1, Math.min(16, i.drums[what] + dir));
    });

  /** The drum machine: its kits above, then a row a drum (its note, its name, four settings). */
  const drawDrums = (ui: UI, inner: Rect, focused: boolean) => {
    const c = ui.c;
    const n = hex(st.inst + 1);
    const kit = st.song!.instruments[st.inst].drums!;
    let x = inner.x + 1;
    ui.text(x, inner.y, t("kit"), { fg: c.muted });
    x += t("kit").length + 1;
    for (const name of Object.keys(DRUM_KITS)) x += ui.button(x, inner.y, name, () => {}, { cmd: `med drums ${n} kit ${name}`, quiet: true }) + 1;
    // the grit: after the kits, or on the line below when the page is narrow
    let gy = inner.y;
    x += 2;
    if (x + 30 >= inner.x + inner.w) (x = inner.x + 1), (gy = inner.y + 1);
    ui.text(x, gy, t("grit"), { fg: c.muted });
    x += t("grit").length + 1;
    x += ui.button(x, gy, "‹", () => nudgeGrit("bits", -1), { quiet: true });
    x = ui.text(x, gy, ` ${kit.bits >= 16 ? t("clean") : `${kit.bits} bits`} `, { fg: kit.bits < 16 ? c.warning : c.fg });
    x += ui.button(x, gy, "›", () => nudgeGrit("bits", 1), { quiet: true }) + 1;
    x += ui.button(x, gy, "‹", () => nudgeGrit("hold", -1), { quiet: true });
    x = ui.text(x, gy, ` ×${kit.hold} `, { fg: kit.hold > 1 ? c.warning : c.fg });
    ui.button(x, gy, "›", () => nudgeGrit("hold", 1), { quiet: true });
    const wide = inner.w >= 66;
    const cellW = wide ? 12 : 7;
    const x0 = inner.x + 1, valX = x0 + 16;
    ui.text(x0, inner.y + 2, "♪", { fg: c.subtle });
    ui.text(x0 + 4, inner.y + 2, t("drum"), { fg: c.subtle });
    DRUM_SETTINGS.forEach((s, k) => ui.text(valX + k * cellW + (wide ? 3 : 0), inner.y + 2, t(s.key), { fg: k === st.drumCol ? c.accent : c.subtle }));
    st.drumRow = Math.max(0, Math.min(11, st.drumRow));
    st.drumCol = Math.max(0, Math.min(3, st.drumCol));
    // too low for twelve rows: they scroll with the cursor
    const rows = Math.max(1, inner.h - 4);
    const scroll = Math.max(0, Math.min(12 - rows, st.drumRow - rows + 1));
    kit.drums.forEach((d, i) => {
      const y = inner.y + 3 + i - scroll;
      if (y < inner.y + 3 || y >= inner.y + inner.h - 1) return;
      const on = i === st.drumRow;
      ui.text(x0, y, DRUM_NOTES[i], { fg: c.muted });
      ui.text(x0 + 4, y, t(DRUM_NAMES[i]).padEnd(11).slice(0, 11), { fg: on ? c.fg : c.muted });
      if (on && focused) ui.tint({ x: x0, y, w: 15, h: 1 }, undefined, c.highlight);
      DRUM_SETTINGS.forEach((s, k) => {
        const v = d[s.key];
        const text = s.key === "tune" ? `${v > 0 ? "+" : ""}${v}` : s.key === "decay" ? v.toFixed(1) : v.toFixed(2);
        const cx = valX + k * cellW;
        const sel = on && k === st.drumCol;
        if (wide) {
          ui.button(cx, y, "‹", () => ((st.drumRow = i), (st.drumCol = k), nudgeKit(i, k, -1)), { quiet: !sel });
          ui.text(cx + 3, y, text.padStart(5), { fg: sel ? c.accent : c.fg });
          ui.button(cx + 8, y, "›", () => ((st.drumRow = i), (st.drumCol = k), nudgeKit(i, k, 1)), { quiet: !sel });
        } else ui.text(cx, y, text.padStart(5), { fg: sel ? c.accent : c.fg, bg: sel ? c.highlight : undefined });
        ui.hit({ x: cx + (wide ? 3 : 0), y, w: 5, h: 1 }, { onClick: () => ((st.drumRow = i), (st.drumCol = k)), onWheel: (dl: number) => nudgeKit(i, k, dl < 0 ? 1 : -1) });
      });
      ui.hit({ x: x0, y, w: 15, h: 1 }, { onClick: () => (st.drumRow = i) });
    });
    ui.text(inner.x + 1, inner.y + inner.h - 1, t("keys: one drum a note · ↑↓ a drum · ←→ a setting · ⇧←→ change it"), { fg: c.subtle }, inner.w - 2);
  };

  /** a track's new name, asked in a window (the command does it) */
  const rename = async (tr: number) => {
    const s = song();
    if (!s) return;
    const name = await ib.ui.prompt(t("TRACK NAME"), { initial: s.trackNames[tr] ?? "", placeholder: `${t("track")} ${tr + 1}` });
    if (name !== null) run(`med track ${tr + 1} name ${q(name.trim())}`);
  };

  /** the right-click menu on a cell: the cursor goes there first (a selection holding it stays) */
  const cellMenu = (line: number, track: number): MenuEntry[] => {
    const inSel = !!st.sel && st.sel.block === blockNo() && line >= st.sel.line0 && line <= st.sel.line1 && track >= st.sel.track0 && track <= st.sel.track1;
    if (!inSel) unselect();
    st.line = line;
    st.track = track;
    return menuEntries(line, track);
  };
  const menuEntries = (line: number, track: number): MenuEntry[] => [
    { label: t("play from here"), run: () => run(`med play song ${hex(st.seq)} ${hex(line)}`) },
    "-",
    { label: t("copy"), hint: "alt C", run: copy },
    { label: t("cut"), hint: "alt X", run: cut },
    { label: t("paste"), hint: "alt V", run: () => ((st.line = line), (st.track = track), paste()), disabled: !st.clip },
    { label: t("clear"), hint: "del", run: () => ed()?.clearSelection(target()) },
    "-",
    { label: t("transpose up"), hint: "alt Q", run: () => transpose(1) },
    { label: t("transpose down"), hint: "alt A", run: () => transpose(-1) },
    { label: t("an octave up"), hint: "⇧ alt Q", run: () => transpose(12) },
    { label: t("an octave down"), hint: "⇧ alt A", run: () => transpose(-12) },
    "-",
    { label: t("insert a line"), hint: "alt ⏎", run: () => ed()?.insertLine(blockNo(), line, [track]) },
    { label: t("delete the line"), hint: "⌫", run: () => ed()?.deleteLine(blockNo(), line, [track]) },
    { label: t("mute / unmute this track"), cmd: `med mute ${track + 1}` },
    "-",
    { label: t("save"), hint: "med save", cmd: "med save" },
    { label: t("export (WAV + tracks)"), hint: "med export", cmd: "med export --stems" },
    { label: t("export…"), hint: "alt E", run: () => (st.screen = "export") },
    { label: t("the song's settings"), hint: "alt S", run: () => (st.screen = "song") },
  ];

  /** the cell (and column) under the mouse, from where the block was drawn */
  const cellAt = (mx: number, my: number): { line: number; track: number; col: number } | null => {
    const g = geo, b = block();
    if (!g || !b) return null;
    const k = Math.floor((mx - g.x - g.numW) / g.cw);
    const line = g.top + (my - g.y);
    if (k < 0 || k >= g.fits || line < 0 || line >= b.lines) return null;
    const inCell = mx - g.x - g.numW - k * g.cw;
    let col = 0;
    const chords = !!st.song?.chordColumn;
    for (let c = 0; c < colsOf(b.pages); c++) if ((c !== CHORD_COL || chords) && inCell >= colX(c, chords)) col = c;
    return { line, track: firstTrack + k, col };
  };

  return {
    kind: "breakermed",
    key: "breakermed",
    rawKeys: true,
    title: () => (st.song ? `♫ ${st.path.split("/").pop()}${st.editor?.dirty ? " ●" : ""}` : "BreakerMED"),
    dirty: () => !!st.editor?.dirty,
    status: () =>
      st.song
        ? `${t("ins")} ${hex(st.inst + 1)} · ${t("oct")} ${st.octave + 1} · ${t("step")} ${st.step}${chordHere()} ${engine.playing ? "" : ` · ⏎ ${t("play")}`} · ${t("space")} ${engine.playing ? t("stop") : t("edit")} · esc ${t("leave")}`
        : t("med open <file.med|.mod> — or med demo"),

    render(ui: UI, r: Rect, focused: boolean) {
      const c = ui.c;
      const s = st.song;
      const now = engine.current();
      if (engine.playing) ui.animate(16);
      // follow the song as it's heard
      if (now) {
        st.seq = now.seq;
        st.line = now.line;
      }
      // ── the top line ──
      const name = s ? s.title || st.path.split("/").pop() || "" : "";
      let x = ui.text(r.x + 1, r.y, "BreakerMED", { fg: c.accent, attrs: BOLD });
      x = ui.text(x + 1, r.y, "β", { fg: c.warning });
      if (s) {
        const f = s.flags;
        const bpm = ptBpmOf(s.tempoMode, s.tempo, s.lpb, f.eightChannel, f.hardwareMix);
        // the state: playing, stopped, or stopped in edit mode (red: typing writes in the block)
        const state = engine.playing ? (engine.mode === "block" ? "▶ BLOCK" : "▶ SONG") : st.edit ? ` ● ${t("EDIT")} ` : "■ STOP";
        // the song's settings, the least useful left out first when the line is short
        const parts: [number, string][] = [
          [0, `${s.tempoMode === "spd" ? `SPD ${s.tempo}` : `${s.tempo} BPM`} (${bpm.toFixed(0)})`],
          [3, `${t("speed")} ${hex(s.speed)}`],
          [2, `${t("oct")} ${st.octave + 1}`],
          [4, `${t("step")} ${st.step}`],
          [6, s.format],
          [5, engine.paula ? "PAULA" : "SMOOTH"],
          ...(s.echo ? [[1, `${t("ECHO")} ${s.echo.ms}`] as [number, string]] : []),
        ];
        const space = r.w - 2 - (x - r.x) - state.length - 6;
        let shown = parts;
        const width = (list: [number, string][]) => list.reduce((n, [, p]) => n + p.length + 2, 0);
        for (let drop = 6; drop >= 0 && width(shown) > space; drop--) shown = shown.filter(([k]) => k < drop);
        const rest = shown.length ? `  ${shown.map(([, p]) => p).join("  ")}` : "";
        const rx = rest ? ui.textRight(r.x + r.w - 1, r.y, rest, { fg: engine.playing ? c.success : c.muted }) : r.x + r.w - 1;
        const sx = ui.textRight(rx, r.y, state, st.edit && !engine.playing ? { fg: c.bg, bg: c.error, attrs: BOLD } : { fg: engine.playing ? c.success : c.muted });
        // the song's name in what's left between, a space each side
        const room = sx - (x + 2) - 1;
        if (room >= 3) ui.text(x + 2, r.y, truncate(name, room), { fg: c.fg }, room);
      }
      if (!s) {
        ui.textCenter(r, r.y + Math.floor(r.h / 2) - 1, t("no song loaded"), { fg: c.muted });
        ui.textCenter(r, r.y + Math.floor(r.h / 2) + 1, st.error || "med open <file.med | file.mod> · med demo", { fg: st.error ? c.error : c.subtle });
        return;
      }
      clampCursor();
      const body = { x: r.x, y: r.y + 1, w: r.w, h: r.h - 1 };
      // ── left: sequence, instruments ──
      const leftW = Math.min(LEFT, Math.floor(body.w / 3));
      const seqH = Math.max(5, Math.floor(body.h * 0.45));
      const seqBox = ui.box({ x: body.x, y: body.y, w: leftW, h: seqH }, { title: t("SEQUENCE"), focused: false });
      seqList.items = s.sequence.map((_, i) => i);
      if (seqList.selected !== st.seq) seqList.select(st.seq);
      seqList.render(ui, seqBox, false, (i, row, sel) => {
        const b = s.blocks[s.sequence[i]];
        ui.text(row.x, row.y, `${hex(i)} ${hex(s.sequence[i], 3)} ${b?.name ?? ""}`, { fg: sel ? c.accent : c.muted, attrs: sel ? BOLD : 0 }, row.w);
      });
      const instBox = ui.box({ x: body.x, y: body.y + seqH, w: leftW, h: body.h - seqH }, { title: t("INSTRUMENTS"), focused: false });
      // the instruments, and the free slot past them when the keys are on it (alt →)
      instList.items = Array.from({ length: Math.max(s.instruments.length, st.inst + 1) }, (_, i) => i);
      if (instList.selected !== st.inst) instList.select(st.inst);
      instList.render(ui, instBox, false, (i, row, sel) => {
        const ins = s.instruments[i] ?? { kind: "empty", name: "" };
        const empty = ins.kind === "empty";
        const tag = ins.kind === "chip" ? "▚" : ins.kind === "synth" || ins.kind === "analog" || ins.kind === "fm" ? "∿" : ins.kind === "drums" ? "▪" : ins.kind === "hybrid" ? "≈" : "";
        ui.text(row.x, row.y, `${hex(i + 1)} ${tag}${ins.name || (empty ? "·" : t("(no name)"))}`, { fg: sel ? c.accent : empty ? c.faint : c.fg, attrs: sel ? BOLD : 0 }, row.w);
      });

      // ── right: the tabs, then the screen ──
      screens.drawTabs(ui, body.x + leftW, body.y, body.w - leftW);
      const right = { x: body.x + leftW, y: body.y + 1, w: body.w - leftW, h: body.h - 1 };
      if (st.screen === "instrument") return drawInstrument(ui, right, focused);
      if (st.screen === "song") return screens.drawSong(ui, right, focused);
      if (st.screen === "export") return screens.drawExport(ui, right, focused);

      // ── the block ──
      const bn = blockNo();
      const b = s.blocks[bn];
      const inner = ui.box(right, { title: `${t("BLOCK")} ${hex(bn, 3)}${b?.name ? ` · ${b.name}` : ""} · ${t("line")} ${hex(st.line)}/${hex((b?.lines ?? 1) - 1)}`, focused });
      if (!b) return;
      const chords = !!s.chordColumn;
      if (!chords && st.col === CHORD_COL) st.col = CMD_COL;
      const cw = cellW(b.pages, chords) + 1;
      const numW = 4;
      const fits = Math.max(1, Math.floor((inner.w - numW) / cw));
      if (st.track < firstTrack) firstTrack = st.track;
      if (st.track >= firstTrack + fits) firstTrack = st.track - fits + 1;
      firstTrack = Math.max(0, Math.min(firstTrack, Math.max(0, s.tracks - fits)));
      // the page's own click area first: the cells and headers drawn after it win (the last one registered)
      ui.hit(inner, { onWheel: (d) => moveLine(Math.sign(d) * 2) });
      // track headers
      for (let k = 0; k < fits && firstTrack + k < s.tracks; k++) {
        const tr = firstTrack + k;
        const muted = engine.muted.has(tr);
        const hx = inner.x + numW + k * cw;
        const name = s.trackNames[tr]?.trim() || `${t("track")} ${tr + 1}`;
        ui.text(hx, inner.y, `${muted ? "×" : "▪"} ${truncate(name, cw - 3)}`, { fg: muted ? c.faint : tr === st.track ? c.accent : c.subtle, attrs: tr === st.track ? BOLD : 0 }, cw - 1);
        ui.hit({ x: hx, y: inner.y, w: cw - 1, h: 1 }, {
          onClick: () => (st.track = tr),
          onDouble: () => void rename(tr),
          tip: t("double-click: rename · right-click: mute, solo"),
          menu: () => [
            { label: t("rename…"), run: () => void rename(tr) },
            { label: muted ? t("unmute") : t("mute"), cmd: `med mute ${tr + 1}` },
            { label: t("solo"), cmd: `med solo ${tr + 1}` },
          ],
        });
      }
      // the lines: the cursor's line in the middle
      const rows = inner.h - 1;
      const mid = Math.floor(rows / 2);
      geo = { x: inner.x, y: inner.y + 1, w: inner.w, h: rows, numW, cw, top: st.line - mid, fits };
      const sel = st.sel && st.sel.block === bn ? st.sel : null;
      for (let k = 0; k < rows; k++) {
        const line = st.line - mid + k;
        const y = inner.y + 1 + k;
        if (line < 0 || line >= b.lines) continue;
        const here = line === st.line;
        const beat = line % Math.max(1, s.lpb) === 0;
        const bg = here ? (engine.playing ? mix(c.panel, c.accent, 0.28) : st.edit ? mix(c.panel, c.error, 0.22) : c.highlight) : beat ? c.panelAlt : undefined;
        if (bg !== undefined) ui.fill({ x: inner.x, y, w: inner.w, h: 1 }, { bg });
        ui.text(inner.x, y, hex(line, 3), { fg: here ? c.accent : beat ? c.muted : c.faint, bg });
        for (let j = 0; j < fits && firstTrack + j < s.tracks; j++) {
          const tr = firstTrack + j;
          const cell = b.cells[line][tr];
          const cx = inner.x + numW + j * cw;
          const dim = engine.muted.has(tr);
          const inSel = !!sel && line >= sel.line0 && line <= sel.line1 && tr >= sel.track0 && tr <= sel.track1;
          const cbg = inSel ? mix(c.panel, c.accentAlt, 0.35) : bg;
          if (inSel) ui.fill({ x: cx, y, w: cw - 1, h: 1 }, { bg: cbg });
          let xx = ui.text(cx, y, noteName(cell.note), { fg: dim ? c.faint : cell.note === NOTE_OFF ? c.warning : cell.note ? c.fg : c.faint, bg: cbg, attrs: cell.note ? BOLD : 0 });
          xx = ui.text(xx + 1, y, cell.inst ? hex(cell.inst) : "..", { fg: dim ? c.faint : cell.inst ? c.accent : c.faint, bg: cbg });
          if (chords) xx = ui.text(xx + 1, y, cell.chord ? cell.chord.toString(16).toUpperCase() : ".", { fg: dim ? c.faint : cell.chord ? c.warning : c.faint, bg: cbg });
          for (let p = 0; p < b.pages; p++) {
            const has = cell.cmd[p] || cell.val[p];
            xx = ui.text(xx + 1, y, has ? `${hex(cell.cmd[p])}${hex(cell.val[p])}` : "....", { fg: dim ? c.faint : has ? c.accentAlt : c.faint, bg: cbg });
          }
          if (here && tr === st.track && focused) ui.tint({ x: cx + colX(st.col, chords), y, w: colW(st.col), h: 1 }, c.bg, st.edit ? c.error : c.accent);
          ui.hit({ x: cx, y, w: cw - 1, h: 1 }, {
            onClick: (m) => {
              const at = cellAt(m.x, m.y);
              unselect();
              st.line = line;
              st.track = tr;
              if (at) st.col = at.col;
              anchor = { line, track: tr };
            },
            onDrag: (m) => {
              const at = cellAt(m.x, m.y);
              if (!at || !anchor) return;
              st.line = at.line;
              st.track = at.track;
              st.sel = { block: bn, line0: Math.min(anchor.line, at.line), line1: Math.max(anchor.line, at.line), track0: Math.min(anchor.track, at.track), track1: Math.max(anchor.track, at.track) };
            },
            onWheel: (d) => moveLine(Math.sign(d) * 2),
            menu: () => cellMenu(line, tr),
          });
        }
      }
    },

    onKey(k: KeyInput) {
      const s = st.song;
      const e = ed();
      // SONG and EXPORT: their own arrows and ⏎; the piano keys only play there
      if (s && (st.screen === "song" || st.screen === "export") && !k.alt && !k.ctrl && !k.meta) {
        if (st.screen === "song" ? screens.keySong(k) : screens.keyExport(k)) return true;
        const semi = k.key === "space" ? null : pianoKey(k.code);
        if (semi !== null) return !k.repeat && preview(st.octave * 12 + semi), true;
      }
      if (k.key === "enter" && !k.alt) return run(k.shift ? `med play block ${hex(st.seq)} ${hex(st.line)}` : `med play song ${hex(st.seq)} ${hex(st.line)}`), true;
      if (k.key === "space") {
        if (engine.playing) run("med stop");
        else run(`med edit ${st.edit ? "off" : "on"}`);
        return true;
      }
      if (!s || !e) return false;
      // ⌘Z / ⌘⇧Z: the block's own history
      if (k.ctrl && (k.key === "z" || k.code === "KeyZ")) return say(undoRedo(st, k.shift), t(k.shift ? "redone" : "undone")), true;
      if (k.alt) {
        const digit = /^Digit(\d)$/.exec(k.code);
        if (digit) return (st.step = +digit[1]), true;
        switch (k.code) {
          case "KeyI": return (st.screen = "instrument"), true;
          case "KeyB": return (st.screen = "block"), true;
          case "KeyS": return (st.screen = "song"), true;
          case "KeyE": return (st.screen = "export"), true;
          case "ArrowUp": return (st.octave = Math.min(7, st.octave + 1)), true;
          case "ArrowDown": return (st.octave = Math.max(0, st.octave - 1)), true;
          case "ArrowLeft": return (st.inst = Math.max(0, st.inst - 1)), true;
          // one past the last: a free slot, to load a sound or make a synth in
          case "ArrowRight": return (st.inst = Math.min(62, s.instruments.length, st.inst + 1)), true;
          case "KeyC": return copy(), true;
          case "KeyX": return cut(), true;
          case "KeyV": return paste(), true;
          case "KeyQ": return transpose(k.shift ? 12 : 1), true;
          case "KeyA": return transpose(k.shift ? -12 : -1), true;
          case "Enter": return e.insertLine(blockNo(), st.line, k.shift ? [...Array(s.tracks).keys()] : [st.track]), true;
        }
        return false;
      }
      // the drum machine: ↑↓ a drum, ←→ a setting, ⇧←→ its value
      if (st.screen === "instrument" && s.instruments[st.inst]?.kind === "drums" && !k.ctrl && !k.meta) {
        switch (k.key) {
          case "up": return (st.drumRow = Math.max(0, st.drumRow - 1)), true;
          case "down": return (st.drumRow = Math.min(11, st.drumRow + 1)), true;
          case "left": return k.shift ? nudgeKit(st.drumRow, st.drumCol, -1) : (st.drumCol = Math.max(0, st.drumCol - 1)), true;
          case "right": return k.shift ? nudgeKit(st.drumRow, st.drumCol, 1) : (st.drumCol = Math.min(3, st.drumCol + 1)), true;
        }
      }
      // the synth's settings: the arrows walk them (the piano keys still play)
      const sk = st.screen === "instrument" ? synthOf(s.instruments[st.inst]) : undefined;
      if (sk && !k.ctrl && !k.meta) {
        switch (k.key) {
          case "up": return (st.synthRow = Math.max(0, st.synthRow - 1)), true;
          case "down": return (st.synthRow = Math.min(sk.params.length - 1, st.synthRow + 1)), true;
          case "left": return nudge(st.synthRow, -1, k.shift), true;
          case "right": return nudge(st.synthRow, 1, k.shift), true;
        }
      }
      if (k.shift) {
        switch (k.key) {
          case "up": return extend(-1, 0), true;
          case "down": return extend(1, 0), true;
          case "left": return extend(0, -1), true;
          case "right": return extend(0, 1), true;
        }
      }
      switch (k.key) {
        case "up": return unselect(), moveLine(-1), true;
        case "down": return unselect(), moveLine(1), true;
        case "pageup": return moveLine(-16), true;
        case "pagedown": return moveLine(16), true;
        case "home": return (st.line = 0), true;
        case "end": return moveLine(9999), true;
        case "left": return unselect(), moveCol(-1), true;
        case "right": return unselect(), moveCol(1), true;
        case "delete":
          if (st.sel) e.clearSelection(st.sel), unselect();
          else e.clear(blockNo(), st.line, st.track, st.col), st.edit && advance();
          return true;
        case "backspace":
          e.deleteLine(blockNo(), st.line, k.shift ? [...Array(s.tracks).keys()] : [st.track]);
          return true;
      }
      if (k.ctrl || k.meta) return false;
      const kind = colKind(st.col).kind;
      // the hex columns: 0–9, A–F (the letters by their name, the digits by their place)
      if (st.edit && kind !== "note") {
        const d = /^Digit(\d)$/.exec(k.code)?.[1] ?? (k.key.length === 1 && HEX.includes(k.key.toLowerCase()) ? k.key.toLowerCase() : null);
        if (d !== null) {
          e.writeHex(blockNo(), st.line, st.track, st.col, HEX.indexOf(d));
          // the instrument: two digits; a command: four (0C20); after the last, back to the first and down
          const k = colKind(st.col);
          if (k.kind === "chord") {
            if (HEX.indexOf(d)) s.chordColumn = true;
            advance(); // one digit: down to the next line
          } else if (k.kind === "inst") {
            if (k.digit === 0) st.col++;
            else (st.col--, advance()); // two digits: back to the first, and down
          } else if (k.kind === "cmd" || (k.kind === "val" && k.digit === 0)) st.col++; // the command's 4 digits, left to right
          else (st.col -= 3, advance()); // the last one: back to the command's first digit, and down
          return true;
        }
      }
      // note off: the key left of 1 (or the one left of Z)
      if (st.edit && kind === "note" && (k.code === "Backquote" || k.code === "IntlBackslash")) return typeNote(NOTE_OFF), true;
      const semi = pianoKey(k.code);
      if (semi !== null) {
        if (k.repeat) return true;
        preview(st.octave * 12 + semi);
        if (st.edit && kind === "note") typeNote(st.octave * 12 + semi + 1);
        return true;
      }
      return false;
    },

    // the gamepad (and what the keys above didn't take)
    onAction(a: Action) {
      switch (a) {
        case "up": return moveLine(-1), true;
        case "down": return moveLine(1), true;
        case "left": return moveCol(-1), true;
        case "right": return moveCol(1), true;
        case "page-up": return moveLine(-16), true;
        case "page-down": return moveLine(16), true;
        case "confirm": return run(engine.playing ? "med stop" : `med play song ${hex(st.seq)} ${hex(st.line)}`), true;
      }
      return false;
    },

    menu: () => (st.song ? cellMenu(st.line, st.track) : [{ label: t("open a song…"), cmd: "med open" }, { label: t("a new song"), cmd: "med new" }, { label: t("the demo song"), cmd: "med demo" }]),
  };
}
