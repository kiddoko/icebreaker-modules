/**
 * A fake deck for the page and the `med` command: a shell that runs `med …`, a
 * vault in memory, dialogs that answer what the test queued, and a UI that
 * records what the page drew (texts, hits) so a test can read and click it.
 */
import type { App, Hit, IcebreakerAPI, KeyInput, Rect, Style, UI } from "../src/icebreaker";
import { makeApp, newState, type State } from "../src/app";
import { registerCommands } from "../src/commands";
import { Engine, type StreamLike } from "../src/engine";
import { Autosave } from "../src/autosave";

/** split a command line the way the deck's shell does (quotes keep spaces) */
export function words(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] ?? m[3]);
  return out;
}

class FakeList<T> {
  items: T[] = [];
  selected = 0;
  onActivate?: (item: T, index: number) => void;
  onSelect?: (item: T, index: number) => void;
  cmdOf?: (item: T) => string | undefined;
  menuOf?: (item: T, index: number) => unknown[];
  select(i: number) {
    this.selected = i;
  }
  render(ui: UI, r: Rect, _f: boolean, draw: (item: T, row: Rect, sel: boolean, i: number) => void) {
    this.items.slice(0, r.h).forEach((it, i) => {
      const row = { x: r.x, y: r.y + i, w: r.w, h: 1 };
      draw(it, row, i === this.selected, i);
      ui.hit(row, { onClick: () => (this.select(i), this.onSelect?.(it, i)), menu: this.menuOf ? () => this.menuOf!(it, i) as never : undefined, cmd: undefined });
    });
  }
}

export interface Drawn {
  x: number;
  y: number;
  s: string;
  style?: Style;
}

/** a UI that remembers what was drawn */
export class RecUI implements UI {
  c = { bg: 0, panel: 1, panelAlt: 2, highlight: 3, fg: 4, muted: 5, subtle: 6, faint: 7, accent: 8, accentAlt: 9, success: 10, warning: 11, error: 12 };
  texts: Drawn[] = [];
  hits: { r: Rect; h: Hit }[] = [];
  buttons: { x: number; y: number; label: string; onClick: () => void; cmd?: string; tip?: string }[] = [];
  animate() {}
  text(x: number, y: number, s: string, style?: Style, maxW?: number) {
    const shown = maxW !== undefined ? s.slice(0, Math.max(0, maxW)) : s;
    this.texts.push({ x, y, s: shown, style });
    return x + shown.length;
  }
  textCenter(r: Rect, y: number, s: string, style?: Style) {
    return this.text(r.x + Math.floor((r.w - s.length) / 2), y, s, style);
  }
  textRight(xEnd: number, y: number, s: string, style?: Style) {
    this.text(xEnd - s.length, y, s, style);
    return xEnd - s.length;
  }
  fill() {}
  tint() {}
  box(r: Rect, o?: { title?: string }) {
    if (o?.title) this.texts.push({ x: r.x + 2, y: r.y, s: o.title });
    return { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 };
  }
  hit(r: Rect, h: Hit) {
    this.hits.push({ r, h });
  }
  button(x: number, y: number, label: string, onClick: () => void, o: { cmd?: string; tip?: string } = {}) {
    this.text(x, y, ` ${label} `);
    this.buttons.push({ x, y, label, onClick, cmd: o.cmd, tip: o.tip });
    this.hit({ x, y, w: label.length + 2, h: 1 }, o.cmd ? { cmd: o.cmd, tip: o.tip } : { onClick, tip: o.tip });
    return label.length + 2;
  }
  /** everything drawn, as one string a line */
  screen(): string {
    const rows = new Map<number, Drawn[]>();
    for (const d of this.texts) rows.set(d.y, [...(rows.get(d.y) ?? []), d]);
    return [...rows.keys()].sort((a, b) => a - b).map((y) => rows.get(y)!.sort((a, b) => a.x - b.x).map((d) => d.s).join(" ")).join("\n");
  }
  /** the last hit (on top) under a point */
  hitAt(x: number, y: number): Hit | undefined {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const { r, h } = this.hits[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return h;
    }
    return undefined;
  }
  find(s: string): Drawn | undefined {
    return this.texts.find((d) => d.s.includes(s));
  }
}

export function key(k: string, o: Partial<KeyInput> = {}): KeyInput {
  const named: Record<string, string> = { tab: "Tab", enter: "Enter", space: "Space", delete: "Delete", backspace: "Backspace", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", pageup: "PageUp", pagedown: "PageDown", escape: "Escape", f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6", f7: "F7", f8: "F8" };
  const code = o.code ?? named[k] ?? (/^[a-z]$/.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : k);
  return { key: k, code, ctrl: false, alt: false, shift: false, meta: false, combo: k, ...o };
}

export interface Deck {
  ib: IcebreakerAPI;
  st: State;
  engine: Engine;
  app: App;
  files: Map<string, string | Uint8Array>;
  /** what the dialogs answer, in order (choose: an index or null; prompt: a string or null) */
  answers: (number | string | null)[];
  /** what the dialogs asked */
  asked: string[];
  notes: string[];
  log: string;
  med(line: string): Promise<number>;
  draw(w?: number, h?: number): RecUI;
  press(k: KeyInput): boolean;
}

export function makeDeck(): Deck {
  const files = new Map<string, string | Uint8Array>();
  const store = new Map<string, unknown>();
  let cmd: { run(ctx: never): unknown } | null = null;
  const d = { answers: [] as (number | string | null)[], asked: [] as string[], notes: [] as string[], log: "" } as Deck;
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const ib = {
    commands: { register: (c: never) => void (cmd = c) },
    apps: { register() {}, open: async () => undefined },
    palette: { register() {} },
    shell: { run: (line: string) => d.med(line) },
    vault: {
      read: async (p: string) => {
        const v = files.get(p);
        if (typeof v !== "string") throw new Error(`no ${p}`);
        return v;
      },
      write: async (p: string, s: string) => void files.set(p, s),
      writeBytes: async (p: string, b: Uint8Array | ArrayBuffer) => void files.set(p, b instanceof Uint8Array ? b : new Uint8Array(b)),
      readBytes: async (p: string) => {
        const v = files.get(p);
        if (!(v instanceof Uint8Array)) throw new Error(`no ${p}`);
        return v;
      },
      mkdir: async (p: string) => void files.set(`${p}/`, ""),
      list: async (dir: string) => {
        const seen = new Map<string, boolean>();
        for (const p of files.keys()) {
          if (!p.startsWith(`${dir}/`)) continue;
          const rest = p.slice(dir.length + 1);
          if (!rest) continue;
          const name = rest.split("/")[0];
          seen.set(name, seen.get(name) || rest.includes("/"));
        }
        return [...seen].map(([name, isDir]) => ({ path: `${dir}/${name}`, name, isDir, size: 0, modified: 0 }));
      },
    },
    storage: { get: async (k: string, f: unknown) => (store.has(k) ? structuredClone(store.get(k)) : f), set: async (k: string, v: unknown) => void store.set(k, structuredClone(v)) },
    ui: {
      notify: (s: string) => void d.notes.push(s),
      choose: async (title: string, opts: { label: string }[]) => {
        d.asked.push(`${title} [${opts.map((o) => o.label).join(" | ")}]`);
        const a = d.answers.shift();
        return a === undefined ? null : (a as number | null);
      },
      prompt: async (title: string, o?: { initial?: string }) => {
        d.asked.push(`${title} (${o?.initial ?? ""})`);
        const a = d.answers.shift();
        return a === undefined ? null : (a as string | null);
      },
      redraw() {},
    },
    audio: { available: () => true, stream: async (): Promise<StreamLike> => ({ rate: 48000, low: 800, high: 2400, write() {}, close() {} }), stop: async () => {}, onStop: () => () => {} },
    lib: {
      BOLD: 1,
      t: (s: string) => s,
      addTranslations() {},
      truncate: (s: string, w: number) => (s.length > w ? s.slice(0, Math.max(0, w - 1)) + "…" : s),
      q: (s: string) => (/[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s),
      mix: (a: number) => a,
      parseFlags(args: string[], withValue: string[] = []) {
        const flags: Record<string, string | true> = {};
        const rest: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith("--") && a.length > 2) {
            const [k, v] = a.slice(2).split("=", 2);
            if (v !== undefined) flags[k] = v;
            else if (withValue.includes(k) && i + 1 < args.length) flags[k] = args[++i];
            else flags[k] = true;
          } else rest.push(a);
        }
        return { flags, rest };
      },
      fmt: { green: (s: string) => s, cyan: (s: string) => s, dim: (s: string) => s },
      ListView: FakeList,
    },
  } as unknown as IcebreakerAPI;
  const engine = new Engine(ib.audio);
  const st = newState();
  st.autosave = new Autosave({ vault: ib.vault, storage: ib.storage, now: () => Date.now(), later: () => 0, cancel() {} }, () => ({ song: st.song, editor: st.editor, path: st.path, playing: engine.playing }));
  registerCommands(ib, engine, st);
  const app = makeApp(ib, engine, st);
  Object.assign(d, {
    ib,
    st,
    engine,
    app,
    files,
    async med(line: string) {
      const [name, ...args] = words(line);
      if (name !== "med" || !cmd) throw new Error(`not a med command: ${line}`);
      d.log += `$ ${line}\n`;
      const ctx = { args, out: (s: string) => void (d.log += s), err: (s: string) => void (d.log += `ERR ${s}`), resolve: (p: string) => p.replace(/^\/+/, "") };
      return (await cmd.run(ctx as never)) as number;
    },
    draw(w = 120, h = 40) {
      const ui = new RecUI();
      app.render(ui, { x: 0, y: 0, w, h }, true);
      return ui;
    },
    press: (k: KeyInput) => !!app.onKey?.(k),
  });
  void dirOf;
  return d;
}

/** let the page's `void ib.shell.run(…)` finish */
export const settle = () => new Promise((r) => setTimeout(r, 0));
