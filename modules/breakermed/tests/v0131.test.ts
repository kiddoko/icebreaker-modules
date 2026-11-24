/**
 * 0.13.1: what the Windows bench found in 0.13.0 — the vintage key, French
 * leftovers on the page and in the guide, med new's line in French.
 */
import { describe, expect, it } from "vitest";
import { deckOutput, key, makeDeck, settle } from "./harness";
import { FR } from "../src/main";
import { GUIDE } from "../src/guide";
import { USAGE } from "../src/commands";
import README from "../README.md?raw";

const alt = (code: string, o = {}) => key(code.replace(/^Key/, "").toLowerCase(), { code, alt: true, ...o });
const fr = (s: string) => FR[s] ?? s;

describe("0.13.1 the vintage key: alt T (alt Y and alt R never arrive on the bench's Windows)", () => {
  it("alt T goes round off → amiga → akai → off", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.inst = 0;
    for (const want of ["amiga", "akai", undefined]) {
      expect(d.press(alt("KeyT"))).toBe(true);
      await settle();
      expect(d.st.song!.instruments[0].vintage?.kind).toBe(want);
    }
  });
  it("alt T writes no note (T is a piano key: with alt, it's the shortcut)", async () => {
    const d = makeDeck();
    await d.med("med new");
    await d.med("med edit on");
    const before = JSON.stringify(d.st.song!.blocks);
    d.press(alt("KeyT"));
    await settle();
    expect(JSON.stringify(d.st.song!.blocks)).toBe(before);
  });
  it("the guide, the help, the button's tip, the README say alt T; alt Y / alt R are gone from them", async () => {
    const rows = GUIDE.flatMap((p) => p.rows.flat()).join("\n");
    expect(rows).toMatch(/alt T · med vintage/);
    expect(USAGE.join("\n")).toMatch(/\(alt T\)/);
    for (const text of [rows, USAGE.join("\n"), README]) expect(text).not.toMatch(/alt [YR]\b/);
    const d = makeDeck();
    await d.med("med new");
    d.st.screen = "instrument";
    const tips = d.draw().hits.map((h) => h.h.tip ?? "").join("\n");
    expect(tips).toMatch(/click or alt T/);
    expect(FR["click or alt T"]).toBe("clic ou alt T");
  });
  it("the INSTRUMENT screen's status line names alt T", async () => {
    const d = makeDeck();
    await d.med("med new");
    d.st.screen = "instrument";
    expect(d.app.status!()).toMatch(/alt T vintage/);
  });
});

describe("0.13.1 French leftovers on the page", () => {
  it("the sequence's header goes through t(): « pos    bloc »", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    const screen = d.draw().screen();
    expect(screen).toContain("pos    bloc");
    expect(screen).not.toMatch(/pos +block/);
  });
  it("a new song's name is « sans titre » on the page (the file and the song keep “untitled”)", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new");
    expect(d.st.song!.title).toBe("untitled");
    expect(d.draw().screen().split("\n")[0]).toMatch(/sans titre/);
    expect(d.draw().screen().split("\n")[0]).not.toMatch(/untitled/);
  });
});

describe("0.13.1 the guide in French, on Windows", () => {
  it("“med saveas · ⌘⇧S” is whole once the deck makes it Ctrl+Shift+S (it was cut: « Ctrl+Sh… »)", async () => {
    const win = (s: string) => s.replace(/⌘⇧([A-Z])/g, "Ctrl+Shift+$1").replace(/⌘([A-Z←→])/g, "Ctrl+$1");
    const d = makeDeck({ t: (s) => win(fr(s)) });
    await d.med("med new");
    d.press(key("?"));
    const screen = d.draw(120, 60).screen();
    expect(screen).toContain("med saveas · Ctrl+Shift+S");
    expect(screen).toContain("Ctrl+Z · Ctrl+Shift+Z");
    expect(screen).not.toMatch(/Ctrl\+Sh…/);
  });
  it("space is « espace » in both rows, never « ⇧Space » next to « espace » (and never « ⇧e… » a keycap would cut)", () => {
    expect(fr("space")).toBe("espace");
    expect(fr("⇧Space")).toBe("⇧ espace");
    for (const v of Object.values(FR)) expect(v, v).not.toMatch(/⇧[a-zà-ÿ]{2,}/);
  });
  it("the stopped space row names the button as it reads: « éditer »", () => {
    const row = GUIDE.flatMap((p) => p.rows).find(([k]) => k === "space")!;
    expect(fr(row[1])).toMatch(/« éditer »/);
    expect(fr("edit")).toBe("éditer");
  });
  it("every key the guide writes in English words has its French", () => {
    const keyWords = new Set(["alt", "med"]); // tab, PgUp, PgDn too since 0.13.2
    const missing = GUIDE.flatMap((p) => p.rows.map(([k]) => k))
      // the med commands are typed as they are: only the words around them are said
      .filter((k) => /[a-z]{3,}/.test(k.split(" · ").filter((part) => !part.startsWith("med ")).join(" ").split(/[\s,]+/).filter((w) => !keyWords.has(w)).join(" ")))
      .filter((k) => FR[k] === undefined);
    expect(missing).toEqual([]);
  });
});

describe("0.13.1 med new's line, number first, in the module's own words", () => {
  it("English: « untitled · 8 tracks · 1 block · 1 position · 5 instruments · 0:07 »", async () => {
    const d = makeDeck();
    await d.med("med new");
    expect(d.log).toMatch(/♫ untitled · 8 tracks · 1 block · 1 position · \d+ instruments · \d+:\d\d\n/);
  });
  it("French through the deck's tOutput with the module's table: « sans titre · 8 pistes · 1 bloc · 1 position · 5 instruments »", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new 12");
    const line = d.log.split("\n").find((l) => l.startsWith("♫"))!;
    expect(deckOutput(line, FR)).toMatch(/^♫ sans titre · 12 pistes · 1 bloc · 1 position · \d+ instruments · \d+:\d\d$/);
  });
  it("plurals: 2 blocks · 3 positions → « 2 blocs · 3 positions »; 1 track → « 1 piste »", async () => {
    const d = makeDeck({ t: fr });
    await d.med("med new 1");
    await d.med("med seq new");
    await d.med("med seq new");
    d.answers.push("songs/p.bmed");
    await d.med("med save");
    d.log = "";
    await d.med("med open songs/p.bmed");
    const line = d.log.split("\n").find((l) => l.startsWith("♫"))!;
    expect(line).toMatch(/· 1 track · 3 blocks · 3 positions ·/);
    expect(deckOutput(line, FR)).toMatch(/· 1 piste · 3 blocs · 3 positions ·/);
  });
});

describe("0.13.1 the built main.js (what the STORE ships) has med new", () => {
  it("activate() from main.js registers med, and med new makes a song", async () => {
    const d = makeDeck();
    // main.js's own activate, on the fake deck: its med replaces the sources' one
    (d.ib.audio as unknown as { schedule: () => void }).schedule = () => {};
    // @ts-expect-error main.js is the bundle: no types of its own
    const built = (await import("../main.js")) as { activate(ib: unknown): void };
    built.activate(d.ib);
    expect(await d.med("med new")).toBe(0);
    expect(d.log).not.toMatch(/unknown/);
    expect(d.log).toMatch(/♫ /);
  });
});
