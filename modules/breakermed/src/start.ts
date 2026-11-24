/**
 * BreakerMED — the page with no song: the logo (it builds itself when the module
 * starts), then START: new · open · demo · guide, and a chiptune song or the
 * sampler. A click, a letter (N O D ?) or ↑↓ ⏎ runs the `med` command each shows.
 */
import type { IcebreakerAPI, KeyInput, Rect, UI } from "./icebreaker";

/** the logo, in half blocks: our own letters, 3 rows high */
const FONT: Record<string, string[]> = {
  B: ["█▀▄", "█▀▄", "▀▀ "],
  R: ["█▀▄", "█▀▄", "▀ ▀"],
  E: ["█▀▀", "█▀▀", "▀▀▀"],
  A: ["▄▀▄", "█▀█", "▀ ▀"],
  K: ["█ █", "█▀▄", "▀ ▀"],
  M: ["█▄ ▄█", "█ ▀ █", "▀   ▀"],
  D: ["█▀▄", "█ █", "▀▀ "],
};
const WORD = "BREAKERMED";
/** the logo's 3 rows */
export const LOGO: string[] = [0, 1, 2].map((row) => [...WORD].map((ch) => FONT[ch][row]).join(" "));

/** how long the logo takes to build itself (ms) */
const INTRO_MS = 1100;
const NOISE = "░▒▓█▚▞";

export interface StartChoice {
  key: string;
  label: string;
  cmd: string;
  tip: string;
}
export const START: StartChoice[] = [
  { key: "N", label: "new song", cmd: "med new", tip: "8 tracks, drums and synths, a beat ready: ⏎ plays it, space to write" },
  { key: "O", label: "open…", cmd: "med open", tip: "a .med, .mod or .bmed in songs/" },
  { key: "D", label: "demo", cmd: "med demo", tip: "listen to the demo song" },
  { key: "?", label: "guide", cmd: "med guide", tip: "the keys, the edit mode, the effects in hex, the sampler" },
  { key: "C", label: "chiptune song", cmd: "med new --chip", tip: "2 pulses, a triangle, a noise: an old console's sound" },
  { key: "S", label: "sampler", cmd: "med sampler", tip: "your own sounds: load one into an instrument" },
];

export function makeStart(ib: IcebreakerAPI) {
  const { BOLD, t, mix } = ib.lib;
  const run = (line: string) => void ib.shell.run(line);
  /** when the logo started building (the first time the page is drawn) */
  let since = 0;
  let row = 0;

  /** the newest autosaved copy never saved (R: back on the page) */
  let rescue: { title: string; at: number } | null = null;
  const setRescue = (r: { title: string; at: number } | null) => (rescue = r);
  /** the song still in memory after the page was closed (L: continue it) */
  let song: { title: string; dirty: boolean } | null = null;
  const setSong = (s: { title: string; dirty: boolean } | null) => (song = s);

  const draw = (ui: UI, r: Rect, error: string) => {
    const c = ui.c;
    const now = performance.now();
    if (!since) since = now;
    const p = Math.min(1, (now - since) / INTRO_MS);
    if (p < 1) ui.animate(33);
    const w = LOGO[0].length;
    const boxW = Math.min(r.w - 2, 46), boxH = 8;
    const tall = r.h >= LOGO.length + boxH + 5;
    let y = r.y + Math.max(1, Math.floor((r.h - (tall ? LOGO.length + 3 : 0) - boxH) / 2));
    // the logo: each column lands in turn (noise first), from the left, colours sliding accent → accentAlt
    if (tall && w <= r.w - 2) {
      const x0 = r.x + Math.floor((r.w - w) / 2);
      for (let k = 0; k < LOGO.length; k++)
        [...LOGO[k]].forEach((ch, i) => {
          if (ch === " ") return;
          const at = (i / w) * 0.75; // when this column lands (0–0.75 of the intro)
          if (p < at) return;
          const settled = p >= at + 0.25;
          const glyph = settled ? ch : NOISE[(i * 7 + k * 3 + Math.floor(now / 40)) % NOISE.length];
          ui.text(x0 + i, y + k, glyph, { fg: mix(c.accent, c.accentAlt, i / w), attrs: settled ? BOLD : 0 });
        });
      const sub = `β · ${t("tracker: notes, samples, synths, chiptune")}`;
      const shown = sub.slice(0, Math.max(0, Math.round(((p - 0.6) / 0.4) * sub.length)));
      ui.textCenter(r, y + LOGO.length + 1, shown, { fg: c.muted });
      y += LOGO.length + 3;
    } else ui.textCenter(r, y++, "BreakerMED β", { fg: c.accent, attrs: BOLD });
    // START: four big choices, two more below
    const box = { x: r.x + Math.floor((r.w - boxW) / 2), y, w: boxW, h: boxH };
    const inner = ui.box(box, { title: t("START"), focused: true });
    const colW = Math.floor((inner.w - 2) / 2);
    row = Math.max(0, Math.min(START.length - 1, row));
    START.forEach((ch, i) => {
      const col = i % 2, line = Math.floor(i / 2);
      const bx = inner.x + 1 + col * colW, by = inner.y + line * 2 + (i >= 4 ? 1 : 0);
      if (by >= inner.y + inner.h) return;
      const label = `${ch.key}  ${t(ch.label)}`.padEnd(Math.max(0, colW - 3));
      ui.button(bx, by, label, () => run(ch.cmd), { cmd: ch.cmd, tip: t(ch.tip), selected: i === row, quiet: i >= 4 && i !== row });
    });
    let below = box.y + box.h + 1;
    if (song && below < r.y + r.h) {
      // the song of before: continue it, or save it
      const label = `L  ${t("continue")} “${song.title}”${song.dirty ? " ●" : ""}`;
      const extra = [[t("save"), "med save"], [t("save as…"), "med saveas"]] as const;
      const w = label.length + 2 + extra.reduce((n, [l]) => n + l.length + 3, 0);
      let x = r.x + Math.max(0, Math.floor((r.w - w) / 2));
      x += ui.button(x, below, label, () => run("med continue"), { cmd: "med continue", selected: true }) + 1;
      for (const [l, cmd] of extra) if (x + l.length + 2 < r.x + r.w) x += ui.button(x, below, l, () => run(cmd), { cmd, quiet: true }) + 1;
      below += 2;
    }
    if (rescue && below < r.y + r.h) {
      const label = `R  ${t("recover")} “${rescue.title}” · ${t("autosaved")} ${new Date(rescue.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
      const w = Math.min(r.w - 2, label.length + 2);
      ui.button(r.x + Math.floor((r.w - w) / 2), below, label, () => run("med recover"), { cmd: "med recover", tip: t("changes that were never saved, kept by the autosave") });
      below += 2;
    }
    if (error) ui.textCenter(r, below, t(error), { fg: c.error });
  };

  const key = (k: KeyInput): boolean => {
    const letter = k.key.length === 1 ? k.key.toUpperCase() : "";
    if (letter === "R" && rescue && !k.alt && !k.ctrl && !k.meta) return run("med recover"), true;
    if (letter === "L" && song && !k.alt && !k.ctrl && !k.meta) return run("med continue"), true;
    if (song && k.ctrl && k.code === "KeyS") return run(k.shift ? "med saveas" : "med save"), true;
    const hit = START.find((ch) => ch.key === letter);
    if (hit && !k.alt && !k.ctrl && !k.meta) return run(hit.cmd), true;
    switch (k.key) {
      case "up": return (row = Math.max(0, row - 2)), true;
      case "down": return (row = Math.min(START.length - 1, row + 2)), true;
      case "left": return (row = Math.max(0, row - 1)), true;
      case "right": return (row = Math.min(START.length - 1, row + 1)), true;
      case "enter": return run(START[row].cmd), true;
    }
    return false;
  };

  return { draw, key, setRescue, setSong };
}
