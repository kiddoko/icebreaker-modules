/**
 * 0.13.3: what the Windows bench found in 0.13.2 — the guide's keys cut with « … » at ~1000 px
 * (« med saveas · Ctrl… », « tabulation · ⇧ ta… ») and its footer (« med guide ·… »), two hints
 * of the cell menu in English, « vintage amiga » in the LOG, save as proposing « untitled.bmed »
 * to a song the page calls « sans titre ».
 */
import { describe, expect, it } from "vitest";
import { deckOutput, deckT, makeDeck, RecUI, uiCase } from "./harness";
import { FR } from "../src/main";
import { fitParts, GUIDE, makeGuide, wrapKeys } from "../src/guide";
import { NAMES, named } from "../src/dsp/vintage";

/** the deck in French on Windows: the table, lowered (uiCase), ⌘ said Ctrl */
const winKeys = (s: string) => s.replace(/⌘⇧/g, "Ctrl+Shift+").replace(/⌘/g, "Ctrl+");
const frWin = (s: string) => winKeys(deckT(FR)(s));
const fr = (s: string) => FR[s] ?? s;

describe("0.13.3 the guide's keys and footer whole at every width", () => {
  it("wrapKeys: cut between the « · » parts first, no line too long", () => {
    expect(wrapKeys("med saveas · Ctrl+Shift+S", 12)).toEqual(["med saveas ·", "Ctrl+Shift+S"]);
    expect(wrapKeys("tabulation · ⇧ tabulation", 12)).toEqual(["tabulation ·", "⇧ tabulation"]);
    expect(wrapKeys("alt ⏎ · inser", 20)).toEqual(["alt ⏎ · inser"]);
    for (const l of wrapKeys("Ctrl+Shift+Z · a b c d e f g", 9)) expect([...l].length).toBeLessThanOrEqual(9);
  });
  it("fitParts: as many parts as fit, each whole", () => {
    expect(fitParts(["? ou ⌫ : retour", "med guide", "med effects"], 45)).toBe("? ou ⌫ : retour · med guide · med effects");
    expect(fitParts(["? ou ⌫ : retour", "med guide", "med effects"], 30)).toBe("? ou ⌫ : retour · med guide");
    expect(fitParts(["? ou ⌫ : retour", "med guide", "med effects"], 20)).toBe("? ou ⌫ : retour");
  });
  for (const [lang, t] of [["French on Windows", frWin], ["English on Windows", (s: string) => winKeys(uiCase(s))], ["English on a Mac", uiCase]] as const)
    it(`${lang}: every key, every row, the footer whole, from 24 to 200 columns`, async () => {
      const d = makeDeck({ t });
      const guide = makeGuide(d.ib);
      for (let w = 24; w <= 200; w += 4) {
        const ui = new RecUI();
        guide.draw(ui, { x: 0, y: 0, w, h: 30 }, true);
        // the bench's ~1000 px: the footer said « med guide ·… »
        const footer = ui.texts.filter((x) => x.y === Math.max(...ui.texts.map((y) => y.y)))[0].s;
        for (const part of footer.split(" · ")) expect([t("? or ⌫: back"), "med guide", "med effects", "↑↓"], `${w}: ${footer}`).toContain(part.replace(/^\d+–\d+\/\d+$/, "↑↓"));
        for (const x of ui.texts) expect(x.x + [...x.s].length, `${w}: ${x.s}`).toBeLessThanOrEqual(w - 1);
        // every key whole once its column's lines are put back together (« Ctrl… » was cut)
        const all = new RecUI();
        guide.draw(all, { x: 0, y: 0, w, h: 4000 }, true);
        const x0 = Math.min(...all.texts.map((x) => x.x));
        // (spaces aside: at the narrowest a long word goes on over the next line in pieces, never cut off)
        const column = (keep: (x: number) => boolean) => all.texts.filter((x) => keep(x.x)).sort((a, b) => a.y - b.y).map((x) => x.s).join("").replace(/\s+/g, "");
        const keys = column((x) => x === x0 + 1), words = column((x) => x > x0 + 1);
        for (const [k, what] of GUIDE.flatMap((p) => p.rows)) {
          expect(keys, `${w}: ${k}`).toContain(t(k).replace(/\s+/g, ""));
          expect(words, `${w}: ${what}`).toContain(named(t(what)).replace(/\s+/g, ""));
        }
      }
    });
  it("the bench's three: « med saveas · Ctrl+Shift+S », « alt pg préc · alt pg suiv », « tabulation · ⇧ tabulation » at ~1000 px", () => {
    const d = makeDeck({ t: frWin });
    for (const w of [50, 70, 100]) {
      const ui = new RecUI();
      makeGuide(d.ib).draw(ui, { x: 0, y: 0, w, h: 600 }, true);
      const shown = ui.texts.map((x) => x.s).join("\n");
      expect(shown).not.toMatch(/Ctrl…|alt…|⇧ ta…|·…|Shi…/);
      expect(shown).toMatch(/Ctrl\+Shift\+S$/m);
      expect(shown).toMatch(/alt pg suiv$/m);
      expect(shown).toMatch(/⇧ tabulation$/m);
    }
  });
});

describe("0.13.3 the cell menu's hints in French", () => {
  it("« suppr (mode édition) », « ⌫ (mode édition) »", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    const hints = (d.app.menu!() as { hint?: string }[]).map((e) => e?.hint ?? "");
    expect(hints).toContain("suppr (mode édition)");
    expect(hints).toContain("⌫ (mode édition)");
    expect(hints.join(" ")).not.toMatch(/edit mode/);
  });
});

describe("0.13.3 Amiga, Akai and Paula keep their capitals (the deck lowers its table's words, not a {var})", () => {
  it("the LOG, as the deck shows it in French: « vintage Amiga : 8 bits… », « vintage façon Akai… », « PAULA : … comme l'Amiga »", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    d.log = "";
    await d.med("med vintage 01 amiga");
    await d.med("med vintage 01 akai");
    await d.med("med paula on");
    const log = deckOutput(d.log.split("\n").filter((l) => !l.startsWith("$")).join("\n"), FR, { lower: true });
    expect(log).toMatch(/· vintage Amiga : 8 bits, la fréquence propre de la note, le filtre de l'A500/);
    expect(log).toMatch(/· vintage façon Akai S900 \/ S950 : 12 bits/);
    expect(log).toContain("PAULA : en escalier, granuleux, comme l'Amiga");
    expect(log).not.toMatch(/amiga|akai|paula/);
  });
  it("English as it was written", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med vintage 01 amiga");
    expect(d.log).toContain("vintage Amiga: 8 bits, the note's own rate, the A500's filter");
  });
  it("the page: every string with a name says it with a {var}, and keeps it after the deck lowers it", () => {
    for (const [en, fr] of Object.entries(FR)) {
      expect(en, en).not.toMatch(/\b(Amiga|Akai|Paula)\b/);
      expect(fr, en).not.toMatch(/\b(Amiga|Akai|Paula)\b/);
    }
    const t = (s: string) => Object.entries(NAMES).reduce((x, [k, v]) => x.split(`{${k}}`).join(v), deckT(FR)(s));
    expect(t("vintage: heard through an {amiga}'s {paula} or an old {akai} sampler")).toBe("vintage : entendu à travers la Paula d'un Amiga ou un vieux sampler Akai");
    expect(t("{amiga}: 8 bits, the note's own rate, the A500's filter")).toBe("Amiga : 8 bits, la fréquence propre de la note, le filtre de l'A500");
  });
  it("med guide --text says the names", async () => {
    const d = makeDeck();
    await d.med("med guide --text");
    const text = d.log;
    expect(text).toContain("an Amiga (8 bits, the A500's filter) or an Akai S900");
    expect(text).not.toMatch(/\{(amiga|akai|paula)\}/);
  });
});

describe("0.13.3 save as on a new song: the name in the deck's language", () => {
  it("French: « songs/sans titre.bmed »; the song stays « untitled » in memory", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    d.answers.push(null);
    await d.med("med saveas");
    expect(d.asked.at(-1)).toMatch(/\(songs\/sans titre\.bmed\)$/);
    expect(d.st.song!.title).toBe("untitled");
  });
  it("English: « songs/untitled.bmed », and a free one next (« untitled 2 »)", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.answers.push(null);
    await d.med("med saveas");
    expect(d.asked.at(-1)).toMatch(/\(songs\/untitled\.bmed\)$/);
    d.answers.push("songs/untitled.bmed");
    await d.med("med save");
    await d.med("med new --force");
    d.answers.push(null);
    await d.med("med saveas");
    expect(d.asked.at(-1)).toMatch(/\(songs\/untitled 2\.bmed\)$/);
  });
  it("French: saved under its proposed name, the song takes it as its title", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    d.answers.push("songs/sans titre.bmed");
    await d.med("med saveas");
    expect(d.st.path).toBe("songs/sans titre.bmed");
    expect(d.st.song!.title).toBe("sans titre");
  });
});
