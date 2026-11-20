/**
 * breakerMED — the page. Left: the play sequence and the instruments; right:
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
 */
import type { Action, App, IcebreakerAPI, KeyInput, MenuEntry, Rect, UI } from "./icebreaker";
import { colKind, colsOf, Editor, type Clip, type Selection } from "./edit";
import type { Engine } from "./engine";
import { pianoKey } from "./keys";
import { hex, noteName, NOTE_OFF, PAULA_CLOCK, periodOf, ptBpmOf, type Song } from "./song";

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
  /** what the right side shows: the block, or the instrument's tools (alt I / alt B) */
  screen: "block" | "instrument";
}

export function newState(): State {
  return { song: null, editor: null, path: "", seq: 0, line: 0, track: 0, col: 0, inst: 0, octave: 2, edit: false, step: 1, sel: null, clip: null, error: "", screen: "block" };
}

/** a cell's width: "C-3 01 0C20" and 5 more a command page; where each column starts in it */
const cellW = (pages: number) => 3 + 1 + 2 + pages * 5;
const colX = (col: number) => (col === 0 ? 0 : col <= 2 ? 3 + col : 7 + Math.floor((col - 3) / 4) * 5 + ((col - 3) % 4));
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
  const transpose = (semis: number) => ed()?.transpose(target(), semis);
  const say = (label: string | null, what: string) => ib.ui.notify(label ? `${what}: ${t(label)}` : t("nothing to undo"));

  /** The INSTRUMENT screen: the sound drawn in braille dots (the loop lit), what it is, a button a tool. */
  const drawInstrument = (ui: UI, r: Rect, focused: boolean) => {
    const c = ui.c;
    const s = st.song!;
    const ins = s.instruments[st.inst];
    const n = hex(st.inst + 1);
    const inner = ui.box(r, { title: `${t("INSTRUMENT")} ${n}${ins?.name ? ` · ${ins.name}` : ""}`, focused });
    if (!ins || ins.kind === "empty" || !ins.data.length) {
      ui.text(inner.x + 1, inner.y + 1, t("empty — load a sound:"), { fg: c.muted }, inner.w - 2);
      ui.button(inner.x + 1, inner.y + 3, t("load…"), () => {}, { cmd: `med sample ${n} load`, tip: t("a .wav, .aif, .iff, .mp3, .m4a, .ogg… of the vault") });
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
    for (let c = 0; c < colsOf(b.pages); c++) if (inCell >= colX(c)) col = c;
    return { line, track: firstTrack + k, col };
  };

  return {
    kind: "breakermed",
    key: "breakermed",
    rawKeys: true,
    title: () => (st.song ? `♫ ${st.path.split("/").pop()}${st.editor?.dirty ? " ●" : ""}` : "breakerMED"),
    dirty: () => !!st.editor?.dirty,
    status: () =>
      st.song
        ? `${t("ins")} ${hex(st.inst + 1)} · ${t("oct")} ${st.octave + 1} · ${t("step")} ${st.step} · ⏎ ${t("play")} · ${t("space")} ${engine.playing ? t("stop") : t("edit")} · esc ${t("leave")}`
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
      let x = ui.text(r.x + 1, r.y, "breakerMED", { fg: c.accent, attrs: BOLD });
      if (s) x = ui.text(x + 2, r.y, truncate(name, Math.max(4, r.w - 70)), { fg: c.fg }, r.w - 70);
      if (s) {
        const f = s.flags;
        const bpm = ptBpmOf(s.tempoMode, s.tempo, s.lpb, f.eightChannel, f.hardwareMix);
        const rest = `  ${s.tempoMode === "spd" ? `SPD ${s.tempo}` : `${s.tempo} BPM`} (${bpm.toFixed(0)})  ${t("speed")} ${hex(s.speed)}  ${t("oct")} ${st.octave + 1}  ${t("step")} ${st.step}  ${s.format}  ${engine.paula ? "PAULA" : "SMOOTH"}`;
        const rx = ui.textRight(r.x + r.w - 1, r.y, rest, { fg: engine.playing ? c.success : c.muted });
        // the state: playing, stopped, or stopped in edit mode (red: typing writes in the block)
        const state = engine.playing ? (engine.mode === "block" ? "▶ BLOCK" : "▶ SONG") : st.edit ? ` ● ${t("EDIT")} ` : "■ STOP";
        ui.textRight(rx, r.y, state, st.edit && !engine.playing ? { fg: c.bg, bg: c.error, attrs: BOLD } : { fg: engine.playing ? c.success : c.muted });
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
      instList.items = s.instruments.map((_, i) => i);
      if (instList.selected !== st.inst && st.inst < s.instruments.length) instList.select(st.inst);
      instList.render(ui, instBox, false, (i, row, sel) => {
        const ins = s.instruments[i];
        const empty = ins.kind === "empty";
        const tag = ins.kind === "synth" ? "∿" : ins.kind === "hybrid" ? "≈" : "";
        ui.text(row.x, row.y, `${hex(i + 1)} ${tag}${ins.name || (empty ? "·" : t("(no name)"))}`, { fg: sel ? c.accent : empty ? c.faint : c.fg, attrs: sel ? BOLD : 0 }, row.w);
      });

      if (st.screen === "instrument") return drawInstrument(ui, { x: body.x + leftW, y: body.y, w: body.w - leftW, h: body.h }, focused);

      // ── right: the block ──
      const bn = blockNo();
      const b = s.blocks[bn];
      const px = body.x + leftW;
      const inner = ui.box({ x: px, y: body.y, w: body.w - leftW, h: body.h }, { title: `${t("BLOCK")} ${hex(bn, 3)}${b?.name ? ` · ${b.name}` : ""} · ${t("line")} ${hex(st.line)}/${hex((b?.lines ?? 1) - 1)}`, focused });
      if (!b) return;
      const cw = cellW(b.pages) + 1;
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
          for (let p = 0; p < b.pages; p++) {
            const has = cell.cmd[p] || cell.val[p];
            xx = ui.text(xx + 1, y, has ? `${hex(cell.cmd[p])}${hex(cell.val[p])}` : "....", { fg: dim ? c.faint : has ? c.accentAlt : c.faint, bg: cbg });
          }
          if (here && tr === st.track && focused) ui.tint({ x: cx + colX(st.col), y, w: colW(st.col), h: 1 }, c.bg, st.edit ? c.error : c.accent);
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
      if (k.key === "enter" && !k.alt) return run(k.shift ? `med play block ${hex(st.seq)} ${hex(st.line)}` : `med play song ${hex(st.seq)} ${hex(st.line)}`), true;
      if (k.key === "space") {
        if (engine.playing) run("med stop");
        else run(`med edit ${st.edit ? "off" : "on"}`);
        return true;
      }
      if (!s || !e) return false;
      // ⌘Z / ⌘⇧Z: the block's own history
      if (k.ctrl && (k.key === "z" || k.code === "KeyZ")) return say(k.shift ? e.redo() : e.undo(), t(k.shift ? "redone" : "undone")), true;
      if (k.alt) {
        const digit = /^Digit(\d)$/.exec(k.code);
        if (digit) return (st.step = +digit[1]), true;
        switch (k.code) {
          case "KeyI": return (st.screen = "instrument"), true;
          case "KeyB": return (st.screen = "block"), true;
          case "ArrowUp": return (st.octave = Math.min(7, st.octave + 1)), true;
          case "ArrowDown": return (st.octave = Math.max(0, st.octave - 1)), true;
          case "ArrowLeft": return (st.inst = Math.max(0, st.inst - 1)), true;
          case "ArrowRight": return (st.inst = Math.min(Math.max(0, s.instruments.length - 1), st.inst + 1)), true;
          case "KeyC": return copy(), true;
          case "KeyX": return cut(), true;
          case "KeyV": return paste(), true;
          case "KeyQ": return transpose(k.shift ? 12 : 1), true;
          case "KeyA": return transpose(k.shift ? -12 : -1), true;
          case "Enter": return e.insertLine(blockNo(), st.line, k.shift ? [...Array(s.tracks).keys()] : [st.track]), true;
        }
        return false;
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
          // a two-digit field: the first digit moves right, the second goes back to the first and down
          const k = colKind(st.col);
          if (k.kind !== "note" && k.digit === 0) st.col++;
          else (st.col--, advance());
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
