/**
 * BreakerMED — the SONG and EXPORT screens, and the tabs over the right side
 * (BLOCK · INSTRUMENT · SONG · EXPORT, or alt B / I / S / E).
 *
 * SONG: the song's settings (tempo, speed, lines a beat, swing, tracks, echo, the
 * LED filter), then the tracks (name, volume, pan, chord strum, mute, solo).
 *   ↑↓ a row · ←→ a value (on a track: a column; ⇧←→ its value) · ⏎ rename / switch
 * EXPORT: one window for `med export`: the file, the format, the rate, the bits
 * or the quality, the stems, normalize, the tail, and the button. It runs the
 * command (the LOG shows it: the same line works in the shell).
 *   ↑↓ a row · ←→ a value · ⏎ on the button (or on the file: rename it)
 *
 * The mouse does the same: a click picks, the wheel or ‹ › change a value.
 */
import type { Engine } from "./engine";
import { describe, extOf, isLossy, QUALITIES, RATES, type ExportFormat } from "./export";
import type { IcebreakerAPI, KeyInput, Rect, UI } from "./icebreaker";
import { cleanEcho, ECHO_MAX_MS, MAX_TRACKS, ptBpmOf, trackName, type Song } from "./song";
import type { State } from "./app";

export type Screen = "block" | "instrument" | "song" | "export";
export const SCREENS: { id: Screen; label: string; key: string }[] = [
  { id: "block", label: "BLOCK", key: "B" },
  { id: "instrument", label: "INSTRUMENT", key: "I" },
  { id: "song", label: "SONG", key: "S" },
  { id: "export", label: "EXPORT", key: "E" },
];

const FORMATS: ExportFormat[] = ["wav", "aiff", "flac", "mp3", "m4a", "ogg", "opus"];
const WHAT = ["master", "master + stems", "stems only"] as const;

/** the EXPORT screen's choices (kept while the module runs) */
export interface ExportChoices {
  path: string;
  format: ExportFormat;
  rate: number;
  bits: 16 | 24 | 32;
  quality: string;
  what: (typeof WHAT)[number];
  normalize: boolean;
  tail: number;
}
export const newExportChoices = (): ExportChoices => ({ path: "", format: "wav", rate: 48000, bits: 24, quality: "", what: "master + stems", normalize: false, tail: 1.5 });

/** the `med export` line the choices make */
export function exportLine(x: ExportChoices, q: (s: string) => string): string {
  const lossy = isLossy(x.format);
  const path = `${(x.path.trim() || "songs/untitled").replace(/\.(wav|aiff?|flac|mp3|m4a|ogg|opus)$/i, "")}.${extOf(x.format)}`;
  const parts = ["med export", q(path)];
  if (x.format !== "opus" && x.rate !== 48000) parts.push(`--rate ${x.rate}`);
  if (lossy) {
    if (x.quality && x.quality !== QUALITIES[x.format as keyof typeof QUALITIES][0]) parts.push(`--quality ${x.quality}`);
  } else if (x.bits !== (x.format === "flac" ? 16 : 24)) parts.push(`--bits ${x.bits}`);
  if (x.what === "master + stems") parts.push("--stems");
  if (x.what === "stems only") parts.push("--only-stems");
  if (x.normalize) parts.push("--normalize");
  if (x.tail !== 1.5) parts.push(`--tail ${x.tail}`);
  return parts.join(" ");
}

/** keep the choices possible: FLAC has no 32 bits, lossy formats stop at 48 kHz, Opus is 48 kHz, a quality of the format */
export function fixChoices(x: ExportChoices): void {
  if (x.format === "flac" && x.bits === 32) x.bits = 24;
  if (isLossy(x.format)) {
    if (x.rate > 48000) x.rate = 48000;
    if (x.format === "opus") x.rate = 48000;
    const qs = QUALITIES[x.format];
    if (!qs.includes(x.quality)) x.quality = qs[0];
  }
}

const cycle = <T,>(list: readonly T[], v: T, d: number): T => list[(((list.indexOf(v) + d) % list.length) + list.length) % list.length];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Row {
  label: string;
  value: () => string;
  nudge?: (d: 1 | -1, big: boolean) => void;
  activate?: () => void;
  warn?: () => boolean;
  tip?: string;
}

export function makeScreens(ib: IcebreakerAPI, engine: Engine, st: State) {
  const { BOLD, t, q, truncate } = ib.lib;
  const run = (line: string) => void ib.shell.run(line);
  /** is the encoder pack there? asked once in a while (the EXPORT screen says so for MP3…) */
  let encoders: "unknown" | "ready" | "missing" | "old" | "none" = "unknown";
  let askedAt = 0;
  const askEncoders = () => {
    if (Date.now() - askedAt < 5000) return;
    askedAt = Date.now();
    const a = ib.audio;
    if (!a.encoders || !a.encode) return void (encoders = "old");
    void a.encoders().then((e) => ((encoders = e.installed ? "ready" : e.supported ? "missing" : "none"), ib.ui.redraw())).catch(() => (encoders = "unknown"));
  };

  const dirty = () => st.editor && (st.editor.dirty = true);
  const rename = async (tr: number) => {
    const s = st.song!;
    const name = await ib.ui.prompt(t("track name"), { initial: s.trackNames[tr] ?? "", placeholder: `${t("track")} ${tr + 1}` });
    if (name !== null) run(`med track ${tr + 1} name ${q(name.trim())}`);
  };

  // ── SONG ──────────────────────────────────────────────────────────────────

  const songRows = (s: Song): Row[] => {
    const f = s.flags;
    const echo = s.echo;
    return [
      { label: t("title"), value: () => s.title || "—", activate: () => void ib.ui.prompt(t("the song's title"), { initial: s.title }).then((v) => v !== null && ((s.title = v.replace(/[\u0000-\u001f]/g, "").slice(0, 60)), dirty(), ib.ui.redraw())) },
      {
        label: t("tempo"),
        value: () => `${s.tempoMode === "spd" ? `SPD ${s.tempo}` : `${s.tempo} BPM`} (${ptBpmOf(s.tempoMode, s.tempo, s.lpb, f.eightChannel, f.hardwareMix).toFixed(0)})`,
        nudge: (d, big) => ((s.tempo = clamp(s.tempo + d * (big ? 10 : 1), 1, 255)), dirty()),
      },
      { label: t("speed"), value: () => `${s.speed} ${t("ticks a line")}`, nudge: (d) => ((s.speed = clamp(s.speed + d, 1, 32)), dirty()) },
      { label: t("lines a beat"), value: () => String(s.lpb), nudge: (d) => ((s.lpb = clamp(s.lpb + d, 1, 32)), dirty()) },
      {
        label: t("swing"),
        value: () => (s.swing ? `${s.swing}` : t("straight")),
        nudge: (d, big) => {
          const v = clamp((s.swing ?? 0) + d * (big ? 25 : 5), 0, 100);
          if (v) s.swing = v;
          else delete s.swing;
          dirty();
        },
        tip: t("every other line longer: 50 a lazy shuffle, 100 triplets"),
      },
      { label: t("tracks"), value: () => `${s.tracks}`, nudge: (d) => s.tracks + d >= 1 && s.tracks + d <= MAX_TRACKS && run(`med tracks ${s.tracks + d}`) },
      {
        label: t("echo"),
        value: () => (echo ? t(echo.type) : t("off")),
        nudge: (d) => {
          const next = cycle(["off", "normal", "cross"], echo?.type ?? "off", d);
          if (next === "off") delete s.echo;
          else s.echo = cleanEcho({ type: next, ms: echo?.ms ?? 250, depth: echo?.depth ?? 2 })!;
          dirty();
        },
      },
      ...(echo
        ? [
            { label: `  ${t("delay")}`, value: () => `${echo.ms} ms`, nudge: (d: 1 | -1, big: boolean) => ((echo.ms = clamp(echo.ms + d * (big ? 100 : 10), 1, ECHO_MAX_MS)), dirty()) },
            { label: `  ${t("depth")}`, value: () => `${echo.depth} (${echo.depth <= 2 ? t("long") : echo.depth >= 5 ? t("short") : t("medium")})`, nudge: (d: 1 | -1) => ((echo.depth = clamp(echo.depth + d, 1, 6)), dirty()) },
          ]
        : []),
      { label: t("LED filter"), value: () => (f.filter ? t("on") : t("off")), nudge: () => ((f.filter = !f.filter), dirty()), activate: () => ((f.filter = !f.filter), dirty()) },
    ];
  };

  /** the tracks table's columns */
  const COLS = ["name", "vol", "pan", "strum", "mute", "solo"] as const;
  const nudgeTrack = (tr: number, col: number, d: 1 | -1, big: boolean) => {
    const s = st.song!, e = st.editor!;
    const key = COLS[col];
    if (key === "vol") e.setTrack(tr, { volume: (s.trackVolume[tr] ?? 64) + d * (big ? 8 : 1) });
    else if (key === "pan") e.setTrack(tr, { pan: (s.trackPan[tr] ?? 0) + d * (big ? 0.25 : 0.05) });
    else if (key === "strum") e.setTrack(tr, { strum: (s.trackStrum?.[tr] ?? 0) + d * (big ? 50 : 5) });
    else if (key === "mute" || key === "solo") run(`med ${key} ${tr + 1}`);
  };
  const activateTrack = (tr: number, col: number) => {
    const key = COLS[col];
    if (key === "name") void rename(tr);
    else if (key === "mute" || key === "solo") run(`med ${key} ${tr + 1}`);
  };

  const drawSong = (ui: UI, r: Rect, focused: boolean) => {
    const c = ui.c;
    const s = st.song!;
    const count = (n: number, one: string, many: string) => `${n} ${t(n === 1 ? one : many)}`;
    const inner = ui.box(r, { title: `${t("SONG")} · ${count(s.sequence.length, "position", "positions")} · ${count(s.blocks.length, "block", "blocks")}`, focused });
    const rows = songRows(s);
    const total = rows.length + s.tracks;
    st.songRow = clamp(st.songRow, 0, total - 1);
    st.songCol = clamp(st.songCol, 0, COLS.length - 1);
    const labelW = 14;
    // the settings: label, ‹ value ›
    let y = inner.y;
    const top = inner.y + inner.h;
    rows.forEach((row, i) => {
      if (y >= top) return;
      const on = i === st.songRow;
      ui.text(inner.x + 1, y, truncate(row.label, labelW - 1), { fg: on ? c.fg : c.muted });
      let x = inner.x + 1 + labelW;
      if (row.nudge) x += ui.button(x, y, "‹", () => ((st.songRow = i), row.nudge!(-1, false)), { quiet: true });
      x = ui.text(x, y, ` ${row.value()} `, { fg: on ? c.accent : c.fg, attrs: on ? BOLD : 0 });
      if (row.nudge) ui.button(x, y, "›", () => ((st.songRow = i), row.nudge!(1, false)), { quiet: true });
      if (on && focused) ui.tint({ x: inner.x, y, w: labelW, h: 1 }, undefined, c.highlight);
      ui.hit({ x: inner.x, y, w: labelW, h: 1 }, { onClick: () => (st.songRow = i), onDouble: () => row.activate?.(), onWheel: (d) => row.nudge?.(d > 0 ? -1 : 1, false), tip: row.tip });
      y++;
    });
    // the tracks
    y++;
    if (y >= top) return;
    const nameW = Math.max(8, Math.min(18, inner.w - 40));
    const colX = [inner.x + 4, inner.x + 5 + nameW, inner.x + 11 + nameW, inner.x + 18 + nameW, inner.x + 26 + nameW, inner.x + 31 + nameW];
    COLS.forEach((k, i) => ui.text(colX[i], y, t(k), { fg: st.songRow >= rows.length && st.songCol === i ? c.accent : c.subtle }));
    y++;
    const rowsLeft = top - y;
    const cur = st.songRow - rows.length;
    const scroll = Math.max(0, Math.min(s.tracks - rowsLeft, cur - rowsLeft + 1));
    for (let tr = scroll; tr < s.tracks && y < top; tr++, y++) {
      const here = tr === cur;
      const muted = engine.muted.has(tr);
      const solo = engine.muted.size === s.tracks - 1 && !muted;
      const pan = s.trackPan[tr] ?? 0;
      const cells = [
        truncate(trackName(s, tr), nameW),
        String(s.trackVolume[tr] ?? 64),
        pan === 0 ? "C" : `${pan < 0 ? "L" : "R"}${Math.round(Math.abs(pan) * 100)}`,
        s.trackStrum?.[tr] ? `${s.trackStrum[tr]} ms` : "—",
        muted ? "×" : "·",
        solo ? "S" : "·",
      ];
      ui.text(inner.x + 1, y, String(tr + 1).padStart(2), { fg: c.faint });
      cells.forEach((v, i) => {
        const on = here && st.songCol === i;
        const fg = i === 0 ? (muted ? c.faint : c.fg) : i === 4 && muted ? c.warning : i === 5 && solo ? c.success : c.muted;
        ui.text(colX[i], y, v, { fg: on ? c.accent : fg, attrs: on ? BOLD : 0 }, (colX[i + 1] ?? inner.x + inner.w) - colX[i] - 1);
        if (on && focused) ui.tint({ x: colX[i] - 1, y, w: (colX[i + 1] ?? colX[i] + 6) - colX[i], h: 1 }, undefined, c.highlight);
        ui.hit({ x: colX[i] - 1, y, w: (colX[i + 1] ?? colX[i] + 6) - colX[i], h: 1 }, {
          onClick: () => ((st.songRow = rows.length + tr), (st.songCol = i), i >= 4 && activateTrack(tr, i)),
          onDouble: () => i === 0 && activateTrack(tr, 0),
          onWheel: (d) => i >= 1 && i <= 3 && nudgeTrack(tr, i, d > 0 ? -1 : 1, false),
          tip: i === 0 ? t("double-click: rename") : i <= 3 ? t("wheel or ⇧←→: change") : t("click: switch"),
        });
      });
    }
  };

  const keySong = (k: KeyInput): boolean => {
    const s = st.song!;
    const rows = songRows(s);
    const total = rows.length + s.tracks;
    const tr = st.songRow - rows.length;
    switch (k.key) {
      case "up": return (st.songRow = Math.max(0, st.songRow - 1)), true;
      case "down": return (st.songRow = Math.min(total - 1, st.songRow + 1)), true;
      case "left":
      case "right": {
        const d = k.key === "left" ? -1 : 1;
        if (tr < 0) return rows[st.songRow].nudge?.(d, k.shift), true;
        if (k.shift) return nudgeTrack(tr, st.songCol, d, false), true;
        return (st.songCol = clamp(st.songCol + d, 0, COLS.length - 1)), true;
      }
      case "enter":
        if (tr < 0) rows[st.songRow].activate?.();
        else activateTrack(tr, st.songCol);
        return true;
    }
    return false;
  };

  // ── EXPORT ────────────────────────────────────────────────────────────────

  /** the file: the song's own name (its folder too) until you choose another */
  const ensurePath = () => {
    const x = st.exp;
    if (!x.path.trim()) x.path = (st.path || "songs/untitled").replace(/\.(bmed|med|mod)$/i, "").replace(/\.[^./]+$/, "") || "songs/untitled";
  };
  const expRows = (): Row[] => {
    ensurePath();
    const x = st.exp;
    const lossy = isLossy(x.format);
    const rows: Row[] = [
      { label: t("file"), value: () => `${x.path.replace(/\.[a-z0-9]+$/i, "")}.${extOf(x.format)}`, activate: () => void ib.ui.prompt(t("export to"), { initial: x.path }).then((v) => v && ((x.path = v.trim()), ib.ui.redraw())) },
      { label: t("format"), value: () => x.format.toUpperCase() + (lossy ? ` (${t("encoder pack")})` : ""), nudge: (d) => ((x.format = cycle(FORMATS, x.format, d)), fixChoices(x)) },
      {
        label: t("rate"),
        value: () => `${x.rate} Hz`,
        nudge: (d) => {
          if (x.format === "opus") return;
          const ok = lossy ? RATES.filter((r) => r <= 48000) : RATES;
          x.rate = cycle(ok, ok.includes(x.rate) ? x.rate : 48000, d);
        },
      },
      lossy
        ? { label: t("quality"), value: () => describe(x.format, x.bits, x.rate, x.quality).split(" · ")[1], nudge: (d) => (x.quality = cycle(QUALITIES[x.format as keyof typeof QUALITIES], x.quality, d)) }
        : { label: t("bits"), value: () => (x.bits === 32 ? t("32-bit float") : `${x.bits} bits`), nudge: (d) => (x.bits = cycle(x.format === "flac" ? [16, 24] : [16, 24, 32], x.bits, d) as 16 | 24 | 32) },
      { label: t("tracks"), value: () => t(x.what), nudge: (d) => (x.what = cycle(WHAT, x.what, d)) },
      { label: t("normalize"), value: () => (x.normalize ? t("on (-0.3 dB)") : t("off")), nudge: () => (x.normalize = !x.normalize), activate: () => (x.normalize = !x.normalize) },
      { label: t("tail"), value: () => `${x.tail} s`, nudge: (d) => (x.tail = clamp(Math.round((x.tail + d * 0.5) * 2) / 2, 0, 10)) },
    ];
    return rows;
  };

  /** what the last export did, shown under the button */
  let last: { text: string; kind: "busy" | "ok" | "error"; line: string } | null = null;
  const doExport = () => {
    const x = st.exp;
    if (last?.kind === "busy") return;
    if (isLossy(x.format) && encoders !== "ready") {
      askedAt = 0;
      askEncoders();
    }
    const line = exportLine(x, q);
    last = { text: t("exporting… (the LOG shows each file)"), kind: "busy", line };
    void ib.shell
      .run(line)
      .then((code) => (last = code === 0 ? { text: `✓ ${t("exported")}: ${line.replace(/^med export /, "")}`, kind: "ok", line } : { text: t("✗ the export failed: the LOG says why"), kind: "error", line }))
      .catch((e) => (last = { text: `✗ ${String(e?.message ?? e)}`, kind: "error", line }))
      .finally(() => ib.ui.redraw());
  };

  const drawExport = (ui: UI, r: Rect, focused: boolean) => {
    const c = ui.c;
    ensurePath();
    const x = st.exp;
    fixChoices(x);
    if (isLossy(x.format)) askEncoders();
    const inner = ui.box(r, { title: t("EXPORT"), focused });
    const rows = expRows();
    st.expRow = clamp(st.expRow, 0, rows.length);
    const labelW = 12;
    let y = inner.y;
    rows.forEach((row, i) => {
      const on = i === st.expRow;
      ui.text(inner.x + 1, y, row.label, { fg: on ? c.fg : c.muted });
      let xx = inner.x + 1 + labelW;
      if (row.nudge) xx += ui.button(xx, y, "‹", () => ((st.expRow = i), row.nudge!(-1, false)), { quiet: true });
      xx = ui.text(xx, y, ` ${row.value()} `, { fg: on ? c.accent : c.fg, attrs: on ? BOLD : 0 }, inner.x + inner.w - xx - 2);
      if (row.nudge) ui.button(xx, y, "›", () => ((st.expRow = i), row.nudge!(1, false)), { quiet: true });
      if (on && focused) ui.tint({ x: inner.x, y, w: labelW, h: 1 }, undefined, c.highlight);
      ui.hit({ x: inner.x, y, w: labelW, h: 1 }, { onClick: () => (st.expRow = i), onDouble: () => row.activate?.(), onWheel: (d) => row.nudge?.(d > 0 ? -1 : 1, false) });
      y++;
    });
    // what it makes, and the button
    y++;
    ui.text(inner.x + 1, y++, describe(x.format, x.bits, x.rate, x.quality) + (x.normalize ? ` · ${t("normalized")}` : ""), { fg: c.subtle });
    if (isLossy(x.format) && encoders !== "ready" && encoders !== "unknown") {
      const why =
        encoders === "missing" ? t("needs the encoder pack: run `encoders install` in the shell (once, ~3 MB)") : encoders === "old" ? t("needs a newer ICEBREAKER (0.5.5+): WAV, AIFF and FLAC work here") : t("no encoder pack for this computer yet");
      ui.text(inner.x + 1, y++, truncate(why, inner.w - 2), { fg: c.warning });
    }
    y++;
    const bx = inner.x + 1;
    const on = st.expRow === rows.length;
    ui.button(bx, y, ` ▶ ${t("EXPORT")} `, doExport, { cmd: exportLine(x, q), selected: on && focused, tip: exportLine(x, q) });
    y += 2;
    // what the last export did, while the choices are still those (a new choice: a new export to come)
    if (last && last.kind !== "busy" && last.line !== exportLine(x, q)) last = null;
    if (last && y < inner.y + inner.h) ui.text(inner.x + 1, y++, truncate(last.text, inner.w - 2), { fg: last.kind === "ok" ? c.success : last.kind === "error" ? c.error : c.accent });
    if (y < inner.y + inner.h) ui.text(inner.x + 1, y, truncate(exportLine(x, q), inner.w - 2), { fg: c.faint });
  };

  const keyExport = (k: KeyInput): boolean => {
    const rows = expRows();
    switch (k.key) {
      case "up": return (st.expRow = Math.max(0, st.expRow - 1)), true;
      case "down": return (st.expRow = Math.min(rows.length, st.expRow + 1)), true;
      case "left":
      case "right":
        if (st.expRow < rows.length) rows[st.expRow].nudge?.(k.key === "left" ? -1 : 1, k.shift), fixChoices(st.exp);
        return true;
      case "enter":
        if (st.expRow === rows.length) doExport();
        else rows[st.expRow].activate?.();
        return true;
    }
    return false;
  };

  /** the tabs over the right side: one line */
  const drawTabs = (ui: UI, x: number, y: number, w: number) => {
    const c = ui.c;
    let xx = x;
    for (const s of SCREENS) {
      const label = ` ${t(s.label)} `;
      if (xx + label.length > x + w) break;
      xx += ui.button(xx, y, label, () => (st.screen = s.id), { selected: st.screen === s.id, quiet: st.screen !== s.id, tip: `alt ${s.key}` });
    }
    if (xx + 18 < x + w) ui.textRight(x + w - 1, y, "alt B · I · S · E", { fg: c.faint });
  };

  return { drawSong, keySong, drawExport, keyExport, drawTabs };
}

