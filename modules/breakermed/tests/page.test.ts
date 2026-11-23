import { describe, expect, it } from "vitest";
import { key, makeDeck, type RecUI } from "./harness";

/** the screen position of a block line's cell (from the line numbers drawn) */
function cellXY(ui: RecUI, line: number, track: number) {
  const num = ui.texts.find((d) => d.s.trim() === String(line).padStart(3, "0") && d.x > 10); // decimal (0.13, D2)
  if (!num) throw new Error(`line ${line} not on screen`);
  const head = ui.texts.filter((d) => d.y === num.y - 1 - (num.y - 1 - ui.texts.find((t) => /kick/.test(t.s))!.y) && /▪|■|M /.test(d.s));
  void head;
  const first = ui.texts.find((d) => d.y === num.y && d.x > num.x && /^(---|[A-G][-#]\d|\^\^\^)$/.test(d.s))!;
  const second = ui.texts.filter((d) => d.y === num.y && /^(---|[A-G][-#]\d|\^\^\^)$/.test(d.s))[1];
  const cw = second.x - first.x;
  return { x: first.x + track * cw + 1, y: num.y };
}

describe("0.12 R4: dragging selects what the mouse covers, no more", () => {
  it("3 lines over 2 tracks select exactly 3 lines and 2 tracks", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.line = 20;
    let ui = d.draw();
    const a = cellXY(ui, 20, 0), b = cellXY(ui, 22, 1);
    ui.hitAt(a.x, a.y)!.onClick!({ x: a.x, y: a.y });
    // the page redraws between mouse moves: the view must not slide under the mouse
    for (const y of [a.y + 1, a.y + 2, b.y]) {
      ui = d.draw();
      ui.hitAt(b.x, y)!.onDrag?.({ x: b.x, y });
    }
    ui = d.draw();
    ui.hitAt(b.x, b.y)!.onUp?.({ x: b.x, y: b.y });
    expect(d.st.sel).toMatchObject({ line0: 20, line1: 22, track0: 0, track1: 1 });
  });
});

describe("0.12 R5: tab goes to the next track, ⇧tab the one before", () => {
  it("goes round the tracks and keeps the keys", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.col = 2;
    expect(d.press(key("tab"))).toBe(true);
    expect([d.st.track, d.st.col]).toEqual([1, 0]);
    for (let i = 0; i < 7; i++) d.press(key("tab"));
    expect(d.st.track).toBe(0);
    expect(d.press(key("tab", { shift: true }))).toBe(true);
    expect(d.st.track).toBe(7);
  });
  it("ICEBREAKER 0.6.2 keeps tab and hands it over as item-next: the next track too", async () => {
    const d = makeDeck();
    await d.med("med new");
    expect(d.app.onAction!("item-next")).toBe(true);
    expect(d.st.track).toBe(1);
  });
  it("⇧ alt ←→: the position before / after", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med seq add 0");
    d.press(key("right", { code: "ArrowRight", alt: true, shift: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(d.st.seq).toBe(1);
  });
});

describe("0.12 R15: one edit button, a tip on hover, nothing hard-coded", () => {
  it("shows one 'edit', a click switches the mode", async () => {
    const d = makeDeck();
    await d.med("med new");
    let ui = d.draw();
    const screen = ui.screen();
    expect(screen.match(/EDIT/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(screen).not.toMatch(/space: /);
    const btn = ui.texts.find((t) => /^ ?edit ?$/i.test(t.s.trim()) && t.y === 0)!;
    expect(btn).toBeTruthy();
    const h = ui.hitAt(btn.x + 1, 0)!;
    expect(h.tip).toMatch(/space/);
    if (h.onClick) h.onClick({ x: btn.x + 1, y: 0 });
    else await d.med(h.cmd!);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.st.edit).toBe(true);
    ui = d.draw();
    expect(ui.screen().match(/EDIT/gi)?.length).toBe(1);
  });
  it("the bottom help lines are gone from the screens", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.screen = "instrument";
    for (const inst of [0, 1, 4]) {
      d.st.inst = inst;
      expect(d.draw().screen()).not.toMatch(/the keys play it|keys: one drum a note/);
    }
  });
  it("the track's square mutes it", async () => {
    const d = makeDeck();
    await d.med("med new");
    const ui = d.draw();
    const sq = ui.texts.find((t) => /kick/.test(t.s) && t.y < 5)!;
    const h = ui.hitAt(sq.x - 2, sq.y)!;
    expect(h.tip).toMatch(/mute/);
    if (h.onClick) h.onClick({ x: sq.x - 2, y: sq.y });
    else await d.med(h.cmd!);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.engine.muted.has(0)).toBe(true);
  });
});

describe("0.12 R6: track names readable, muted tracks still readable", () => {
  it("a muted track's notes aren't drawn in the empty cells' colour", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med mute 1");
    const ui = d.draw();
    const c = ui.c;
    const notes = ui.texts.filter((t) => t.s === "C-3" && t.style?.fg !== undefined);
    expect(notes.some((t) => t.style!.fg === c.faint)).toBe(false);
    const other = ui.texts.find((t) => /snare/.test(t.s) && t.y < 5)!;
    expect(other.style?.fg).not.toBe(c.subtle);
  });
});

describe("0.12: the view (centred by default, or scrolling at the edges) and follow", () => {
  it("centred: the cursor's line in the middle; edges: line 0 at the top", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.line = 0;
    const top = (ui: RecUI) => ui.texts.filter((t) => t.x > 20 && /^ \d{3}$/.test(t.s)).sort((a, b) => a.y - b.y)[0];
    expect(top(d.draw()).y).toBeGreaterThan(8);
    expect(await d.med("med view edges")).toBe(0);
    expect(top(d.draw()).s.trim()).toBe("000");
    d.st.line = 50;
    const ui = d.draw();
    const shown = ui.texts.filter((t) => t.x > 20 && /^ \d{3}$/.test(t.s)).map((t) => parseInt(t.s, 10));
    expect(shown).toContain(50);
  });
  it("follow off: playing leaves the cursor where you edit", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med follow off");
    d.st.line = 30;
    await d.med("med play song 0 0");
    d.draw();
    expect(d.st.line).toBe(30);
    await d.med("med stop");
    await d.med("med follow on");
    expect(d.log).toMatch(/follow/);
  });
});

describe("0.12 R7: saving says so on the page", () => {
  it("a note, the time in the top line, ● while changed", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med tempo 120");
    expect(d.draw().texts.find((t) => t.y === 0 && t.s.includes("●"))).toBeTruthy();
    d.answers.push("songs/x.bmed");
    await d.med("med save");
    expect(d.notes.some((n) => /saved.*songs\/x\.bmed/.test(n))).toBe(true);
    expect(d.draw().screen().split("\n")[0]).toMatch(/✓ saved \d/);
  });
});
