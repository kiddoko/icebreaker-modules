/**
 * 0.13.2: what the Windows bench found in 0.13.1 — the limiter on the whole demo
 * (« LIM » lit the whole time), the guide's last English keycaps and its cut rows,
 * the log and the toasts in English, the tab's « untitled.bmed », the edit mode
 * left on when another song comes.
 */
import { describe, expect, it } from "vitest";
import GITATTRIBUTES from "../../../.gitattributes?raw";
import { deckOutput, makeDeck, RecUI } from "./harness";
import { FR } from "../src/main";
import { GUIDE, makeGuide, wrap } from "../src/guide";
import { readSong } from "../src/format";
import { demoMod } from "../src/demo";
import { Renderer } from "../src/render";
import { Limiter } from "../src/dsp/limiter";

const fr = (s: string) => FR[s] ?? s;

/** the demo, 20 s by blocks of 1024 frames (~21 ms, about what the page asks between two draws) */
function demoBlocks(limit: boolean) {
  const r = new Renderer(readSong(demoMod()), 48000, true);
  r.limit = limit;
  r.play(0, 0);
  const n = 1024, L = new Float32Array(n), R = new Float32Array(n);
  const out: { peak: number; takenDb: number }[] = [];
  for (let k = 0; k < (48000 * 20) / n; k++) {
    L.fill(0), R.fill(0), (r.meter = { peak: 0, gain: 1 });
    r.render(L, R, n);
    out.push({ peak: r.meter.peak, takenDb: -20 * Math.log10(r.meter.gain) });
  }
  return out;
}

describe("0.13.2 the limiter: a catch for the rare peak, not a press on the whole song", () => {
  it("before the limiter, the demo stays under its ceiling (it ran 5 dB over it: 1.72 for 0.89)", () => {
    const raw = demoBlocks(false);
    expect(Math.max(...raw.map((b) => b.peak))).toBeLessThan(Limiter.CEILING);
  });
  it("the limiter takes nothing from the demo (it took 1.4 dB on average, over 3 dB in 12% of the blocks: « LIM » never went out)", () => {
    const blocks = demoBlocks(true);
    expect(Math.max(...blocks.map((b) => b.takenDb))).toBeLessThan(0.5);
  });
  it("the meter moves: the demo's level sits around −6 dB, its peaks near −1 dB (not 6 bars all the time)", () => {
    const peaks = demoBlocks(true).map((b) => b.peak).sort((a, b) => a - b);
    const median = 20 * Math.log10(peaks[peaks.length >> 1]);
    expect(median).toBeGreaterThan(-9);
    expect(median).toBeLessThan(-4);
  });
  it("a song too loud for it is still caught: never over −1 dBFS", () => {
    const lim = new Limiter(48000);
    const L = Float32Array.from({ length: 4800 }, (_, i) => 2 * Math.sin(i / 7)), R = L.slice();
    lim.process(L, R, 0, L.length);
    expect(Math.max(...L.map(Math.abs))).toBeLessThanOrEqual(Limiter.CEILING + 1e-6);
  });
});

describe("0.13.2 a Windows clone (core.autocrlf) checks out the module's files with LF", () => {
  it(".gitattributes at the repository's root: text eol=lf", () => {
    expect(GITATTRIBUTES).toMatch(/^\* text=auto eol=lf$/m);
  });
});

describe("0.13.2 the guide in French: its last keycaps, no row cut", () => {
  it("PgUp / PgDn / tab are said the French keyboard's way", () => {
    expect(fr("alt PgUp · alt PgDn")).toBe("alt pg préc · alt pg suiv");
    expect(fr("↑↓ ←→ · PgUp PgDn")).toBe("↑↓ ←→ · pg préc pg suiv");
    expect(fr("tab · ⇧Tab")).toBe("tabulation · ⇧ tabulation");
    for (const [k] of GUIDE.flatMap((p) => p.rows)) expect(fr(k), k).not.toMatch(/PgUp|PgDn|Tab\b/);
  });
  it("the transpose menu's hints too", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    expect(fr("⇧ alt PgUp")).toBe("⇧ alt pg préc");
  });
  it("wrap: words in lines, none longer than the width", () => {
    expect(wrap("stop · à l'arrêt : MODE ÉDITION", 12)).toEqual(["stop · à", "l'arrêt :", "MODE ÉDITION"]);
    for (const l of wrap("a".repeat(30) + " b", 8)) expect([...l].length).toBeLessThanOrEqual(8);
  });
  it("a row too long goes on over the next line: the space row whole, « (ou clic sur « éditer » en haut) »", () => {
    const d = makeDeck({ t: fr });
    const guide = makeGuide(d.ib);
    for (const w of [60, 90, 140]) {
      const ui = new RecUI();
      guide.draw(ui, { x: 0, y: 0, w, h: 400 }, true);
      // every line within the guide's box, and every row whole when the lines are put back together
      for (const t of ui.texts) expect(t.x + [...t.s].length, t.s).toBeLessThanOrEqual(w - 1);
      const text = ui.screen().split("\n").map((l) => l.trim()).join(" ").replace(/\s+/g, " ");
      expect(text).toContain("espace stop · à l'arrêt : MODE ÉDITION oui / non (ou clic sur « éditer » en haut)");
      for (const p of GUIDE) {
        expect(text, p.title).toContain(fr(p.title));
        for (const [, what] of p.rows) expect(text, what).toContain(fr(what).replace(/\s+/g, " "));
      }
    }
  });
});

describe("0.13.2 the log and the toasts in the deck's language", () => {
  const run = async (lines: string[]) => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    d.log = "";
    for (const l of lines) await d.med(l);
    return { d, log: deckOutput(d.log, FR) };
  };
  it("the bench's lines: med edit on, med vintage, med play, the save's toast", async () => {
    const { d, log } = await run(["med edit on", "med vintage 01 amiga", "med edit off", "med play song 0 0", "med stop"]);
    expect(log).toContain("mode édition : la frappe écrit dans le bloc");
    expect(log).toMatch(/✓ 01 .+ · vintage Amiga : 8 bits/);
    expect(log).toContain("▶ lecture du morceau depuis la position 000, ligne 000");
    expect(log).toContain("■ arrêté");
    d.answers.push("songs/a.bmed");
    await d.med("med save");
    expect(d.notes.at(-1)).toMatch(/^enregistré · songs\/a\.bmed/);
  });
  it("the page's other switches: paula, view, follow, click, filter, octave, step, mute, selection", async () => {
    const { log } = await run(["med paula off", "med view edges", "med follow off", "med click on", "med click off", "med filter on", "med octave 4", "med step 2", "med step 1", "med mute 1", "med mute 1", "med select block", "med copy", "med transpose 1", "med select none", "med vintage 01 off", "med pos 0 4"]);
    for (const want of ["LISSE : interpolé", "vue : défile à ses bords (OctaMED)", "suivre coupé", "métronome : un clic", "métronome : non", "le filtre LED de l'A500 : oui", "octave 4 : la rangée du bas des touches est C-4", "pas 2 : le curseur avance de 2 lignes", "pas 1 : le curseur avance d'1 ligne", "muettes : 1", "toutes les pistes jouent", "sélectionné 64 lignes · 8 pistes", "copié 64 lignes · 8 pistes", "transposé de +1 · 64 lignes · 8 pistes", "rien de sélectionné", "vintage coupé : le son tel quel", "position 000 → bloc 000 · ligne 004"])
      expect(log, want).toContain(want);
  });
  it("English stays as it was written", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    await d.med("med vintage 01 akai");
    expect(d.log).toContain("edit mode: typing writes in the block");
    expect(d.log).toMatch(/· vintage Akai S900 \/ S950-style: 12 bits, a lower rate, aliasing \(\d+ Hz\)/);
    expect(deckOutput(d.log, FR)).toMatch(/· vintage façon Akai S900 \/ S950 : 12 bits, une fréquence plus basse, du repliement \(\d+ Hz\)/);
  });
});

describe("0.13.2 the tab after med new, in French", () => {
  it("« ♫ sans titre.bmed », not « untitled.bmed »", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    expect((d.app as unknown as { title: () => string }).title()).toBe("♫ sans titre.bmed");
    const en = makeDeck();
    await en.med("med new");
    expect((en.app as unknown as { title: () => string }).title()).toBe("♫ untitled.bmed");
  });
  it("a saved song keeps its own name", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    d.answers.push("songs/mon morceau.bmed");
    await d.med("med save");
    expect((d.app as unknown as { title: () => string }).title()).toBe("♫ mon morceau.bmed");
  });
});

describe("0.13.2 another song: the edit mode starts off", () => {
  for (const load of ["med demo", "med new --force", "med open songs/a.bmed"])
    it(`edit on, then ${load}: off (⏎ plays, not « ● rec »)`, async () => {
      const d = makeDeck();
      await d.med("med new");
      d.answers.push("songs/a.bmed");
      await d.med("med save");
      await d.med("med edit on");
      expect(d.st.edit).toBe(true);
      await d.med(load);
      expect(d.st.edit).toBe(false);
    });
});
