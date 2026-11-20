/**
 * STATS — numbers over time. Modules record theirs through `ib.stats`
 * (budget left, pages read…); the deck records "commands run" and "notes in
 * the vault"; you keep your own from the shell or the app:
 *
 *   stats                         every stat, with its last 14 days
 *   stats show deck.commands 60   a graph of the last 60 days
 *   stats set weight 72.4 --unit kg
 *   stats add pushups 20          a counter (adds up per day)
 *   stats pin budget.left         show it on the widget
 *   stats rm weight               forget one of yours
 *
 * Everything stays in the vault (.icebreaker/stats.json), nothing online.
 */
import type { App } from "../../src/apps/types";
import type { Rect } from "../../src/core/grid";
import type { Action, KeyInput } from "../../src/core/input";
import type { Stat } from "../../src/core/stats";
import type { IcebreakerAPI } from "../../src/plugins/api";
import type { UI } from "../../src/ui/ui";

const RANGES = [7, 30, 90, 365];

export function activate(ib: IcebreakerAPI): void {
  ib.settings.register([
    { key: "range", label: "default period (days)", type: "choice", options: RANGES.map(String), default: "30", help: "The period the STATS page shows when it opens: 7, 30, 90 or 365 days (←→ changes it on the page)." },
  ]);
  const { BOLD, mix, fmt, parseFlags, t, q, sparkline, formatStat } = ib.lib;
  const run = (line: string) => void ib.shell.run(line);
  let all: Stat[] = [];
  let pinned: string[] = [];
  /** stats you chose not to see (the setup page: s in the app, or stats hide) */
  let hidden: string[] = [];
  const visible = () => all.filter((s) => !hidden.includes(s.id));
  /** the setup page opens next time the app is shown (`stats setup`) */
  let wantSetup = false;
  const moduleName = (id: string) => (id === "deck" ? "DECK" : ib.modules.installed().find((m) => m.id === id)?.name ?? id.toUpperCase());
  let loaded = false;

  const refresh = async () => {
    all = await ib.stats.list();
    loaded = true;
    ib.ui.redraw();
  };
  const ready = (async () => {
    pinned = await ib.storage.get<string[]>("pinned", []);
    hidden = await ib.storage.get<string[]>("hidden", []);
    await refresh();
  })();
  let pending: ReturnType<typeof setTimeout> | null = null;
  const off = ib.stats.onChange(() => {
    if (pending) return;
    pending = setTimeout(() => ((pending = null), void refresh()), 250);
  });
  stopListening = off;

  const find = (id: string) => all.find((s) => s.id === id) ?? all.find((s) => s.id === `stats.${id}`) ?? all.find((s) => (s.label === id || t(s.label) === id)) ?? null;
  const values = async (id: string, days: number) => (await ib.stats.series(id, days)).map((p) => p.value);
  /** a number with its unit; deltas get a sign */
  const show = (s: Stat, v = s.value) => formatStat(s, v);
  const shown = () => (pinned.length ? pinned.map(find).filter((s): s is Stat => !!s) : visible());
  /** cached 14-day series for lists/widgets (refreshed with the list) */
  const sparks = new Map<string, string>();
  const spark = (s: Stat, w = 14) => {
    const key = `${s.id}:${w}:${s.updated}`;
    if (!sparks.has(key)) {
      sparks.set(key, "");
      void ib.stats.series(s.id, w).then((p) => (sparks.set(key, sparkline(p.map((x) => x.value), w)), ib.ui.redraw()));
    }
    return sparks.get(key) ?? "";
  };

  ib.commands.register({
    name: "stats",
    aliases: ["stat"],
    summary: "numbers over time, from your modules and from you (STATS module)",
    usage: [
      "stats [ls] [prefix]                       every stat with its last 14 days",
      "stats show <id> [days]                    a graph (default 30 days)",
      "stats set <name> <number> [--unit u] [--label \"…\"]   one of yours (a level: weight, savings)",
      "stats add <name> [n] [--unit u]           a counter of yours (adds up per day)",
      "stats pin <id> · stats unpin <id>         choose what the widget shows",
      "stats rm <name>                           forget one of yours",
      "stats hide <id|module> · stats unhide …   choose what STATS shows",
      "stats setup                               the page to choose (s in the app)",
      "stats open                                the STATS app",
    ].join("\n"),
    examples: [
      ["stats set weight 72.4 --unit kg", "a stat of your own"],
      ["stats add pushups 20", "a counter: today's total grows"],
      ["stats show deck.commands 90", "commands run, last 90 days"],
    ],
    complete: () => ["ls", "show", "set", "add", "pin", "unpin", "rm", "open", "hide", "unhide", "setup", ...all.map((s) => s.id)],
    async run(ctx) {
      await ready;
      const { flags, rest } = parseFlags(ctx.args, ["unit", "label"]);
      const [sub, a, b] = rest;
      const meta = { unit: typeof flags.unit === "string" ? flags.unit : undefined, label: typeof flags.label === "string" ? flags.label : undefined };
      if (!sub || sub === "ls" || sub === "list") {
        const list = all.filter((s) => !a || s.id.startsWith(a));
        if (!list.length) return ctx.out(fmt.dim("no stats yet — stats set <name> <number>, or a module records some\n")), 0;
        const w = Math.max(...list.map((s) => s.id.length));
        for (const s of list) {
          const p = await values(s.id, 14);
          ctx.out(`${s.id.padEnd(w)}  ${fmt.bold(show(s).padStart(12))}  ${fmt.cyan(sparkline(p, 14))}  ${fmt.dim(t(s.label))}${pinned.includes(s.id) ? fmt.yellow(" ★") : ""}${hidden.includes(s.id) ? fmt.dim(" (hidden)") : ""}\n`);
        }
        return 0;
      }
      if (sub === "open") return void ib.apps.open("stats"), 0;
      if (sub === "show") {
        const s = a ? find(a) : null;
        if (!s) return ctx.err(`stats: no stat "${a ?? ""}" (stats ls)\n`), 1;
        const days = Math.max(2, Math.min(400, Number(b) || 30));
        const p = await values(s.id, days);
        const lo = Math.min(...p), hi = Math.max(...p), sum = p.reduce((x, y) => x + y, 0);
        ctx.out(`${fmt.bold(t(s.label))} ${fmt.dim(`· ${s.id} · ${s.kind} · ${t("from")} ${s.source}`)}\n`);
        ctx.out(`${fmt.bold(show(s))}  ${fmt.dim(t("updated"))} ${new Date(s.updated).toLocaleString()}\n`);
        for (let i = 0; i < p.length; i += 60) ctx.out(`${fmt.cyan(sparkline(p, p.length).slice(i, i + 60))}\n`);
        ctx.out(fmt.dim(`${days} ${t("days")} · min ${show(s, lo)} · max ${show(s, hi)} · ${s.kind === "counter" ? `${t("total")} ${show(s, sum)}` : `${t("avg")} ${show(s, sum / p.length)}`}\n`));
        return 0;
      }
      if (sub === "set" || sub === "add") {
        if (!a) return ctx.err(`usage: stats ${sub} <name> ${sub === "set" ? "<number>" : "[n]"}\n`), 1;
        const n = b === undefined && sub === "add" ? 1 : Number(String(b).replace(",", "."));
        if (!Number.isFinite(n)) return ctx.err(`stats: "${b ?? ""}" isn't a number\n`), 1;
        const name = a.startsWith("stats.") ? a.slice(6) : a;
        if (name.includes(".")) return ctx.err(`stats: "${a}" belongs to a module — yours have plain names (weight, pushups)\n`), 1;
        const s = sub === "set" ? await ib.stats.set(name, n, meta) : await ib.stats.add(name, n, meta);
        await refresh();
        ctx.out(`${fmt.green("▲")} ${fmt.bold(t(s.label))} ${show(s)}${sub === "add" ? fmt.dim(` (+${n})`) : ""}\n`);
        return 0;
      }
      if (sub === "pin" || sub === "unpin") {
        const s = a ? find(a) : null;
        if (!s) return ctx.err(`stats: no stat "${a ?? ""}" (stats ls)\n`), 1;
        pinned = pinned.filter((x) => x !== s.id);
        if (sub === "pin") pinned.push(s.id);
        await ib.storage.set("pinned", pinned);
        ib.ui.redraw();
        ctx.out(`${sub === "pin" ? fmt.yellow("★") : fmt.dim("☆")} ${t(s.label)}\n`);
        return 0;
      }
      if (sub === "setup") return (wantSetup = true), void ib.apps.open("stats"), 0;
      if (sub === "hide" || sub === "unhide") {
        if (!a) return ctx.err(`usage: stats ${sub} <id | module>\n`), 1;
        const ids = all.filter((x) => x.id === a || x.source === a || x.id === `stats.${a}`).map((x) => x.id);
        if (!ids.length) return ctx.err(`stats: no stat or module "${a}" (stats ls)\n`), 1;
        hidden = sub === "hide" ? [...new Set([...hidden, ...ids])] : hidden.filter((x) => !ids.includes(x));
        await ib.storage.set("hidden", hidden);
        ib.ui.redraw();
        ctx.out(`${sub === "hide" ? fmt.dim("☐ hidden") : fmt.green("☑ shown")}: ${ids.join(", ")}\n`);
        return 0;
      }
      if (sub === "rm" || sub === "remove") {
        const s = a ? find(a) : null;
        if (!s) return ctx.err(`stats: no stat "${a ?? ""}" (stats ls)\n`), 1;
        if (s.source !== "stats") return ctx.err(`stats: ${s.id} belongs to the ${s.source} module — only yours can be removed\n`), 1;
        await ib.stats.remove(s.id);
        pinned = pinned.filter((x) => x !== s.id);
        await ib.storage.set("pinned", pinned);
        await refresh();
        ctx.out(`${fmt.red("✕")} ${t(s.label)}\n`);
        return 0;
      }
      return ctx.err(`stats: unknown "${sub}" (man stats)\n`), 1;
    },
  });

  /** Name, then the number — the same words as the command. */
  async function addFlow(): Promise<void> {
    const name = await ib.ui.prompt(t("Track what?"), { placeholder: t("weight, pushups, savings…") });
    if (!name?.trim()) return;
    const kind = await ib.ui.choose(t("What kind?"), [
      { label: t("a level"), hint: t("weight, savings: the last value counts") },
      { label: t("a counter"), hint: t("pushups, pages: adds up each day") },
    ]);
    if (kind === null) return;
    const v = await ib.ui.prompt(kind === 0 ? t("Value now?") : t("How many today?"), { placeholder: "12" });
    if (!v?.trim()) return;
    const unit = await ib.ui.prompt(t("Unit? (optional)"), { placeholder: "kg · € · min" });
    run(`stats ${kind === 0 ? "set" : "add"} ${q(name.trim().replace(/\s+/g, "-").toLowerCase())} ${v.trim()}${unit?.trim() ? ` --unit ${q(unit.trim())}` : ""}`);
  }
  async function updateFlow(s: Stat): Promise<void> {
    if (s.source !== "stats") return ib.ui.notify(t("{id} is kept by the {m} module", { id: s.id, m: s.source }), "info");
    const v = await ib.ui.prompt(s.kind === "counter" ? t("Add how many?") : t("Value now?"), { placeholder: show(s) });
    if (!v?.trim()) return;
    run(`stats ${s.kind === "counter" ? "add" : "set"} ${s.id.slice(6)} ${v.trim()}`);
  }

  // ── the app ──
  class StatsApp implements App {
    readonly kind = "stats";
    readonly key = "stats";
    private sel = 0;
    private range = Math.max(0, RANGES.indexOf(Number(ib.settings.get("range")) || 30));
    private series: number[] = [];
    private seriesFor = "";
    private setup = false;
    private setupSel = 0;
    /** the setup page: each module, then its stats, with a box to show / hide */
    private setupRows(): ({ kind: "mod"; id: string } | { kind: "stat"; s: Stat })[] {
      const out: ({ kind: "mod"; id: string } | { kind: "stat"; s: Stat })[] = [];
      for (const src of [...new Set(all.map((x) => x.source))].sort()) {
        out.push({ kind: "mod", id: src });
        for (const x of all.filter((y) => y.source === src)) out.push({ kind: "stat", s: x });
      }
      return out;
    }
    private toggleRow(i: number): void {
      const row = this.setupRows()[i];
      if (!row) return;
      if (row.kind === "stat") return run(`stats ${hidden.includes(row.s.id) ? "unhide" : "hide"} ${row.s.id}`);
      const mine = all.filter((x) => x.source === row.id);
      run(`stats ${mine.every((x) => hidden.includes(x.id)) ? "unhide" : "hide"} ${row.id}`);
    }
    private renderSetup(ui: UI, r: Rect, focused: boolean): void {
      const c = ui.c;
      const w = Math.min(r.w - 4, 80), x = r.x + Math.floor((r.w - w) / 2);
      let y = r.y + 1;
      ui.button(x, y, t("‹ back to the stats"), () => (this.setup = false), { tip: "s · esc" });
      ui.text(x + 24, y, t("what STATS shows — space or click to switch"), { fg: c.muted }, w - 24);
      y += 2;
      const rows = this.setupRows();
      this.setupSel = Math.min(this.setupSel, Math.max(0, rows.length - 1));
      const room = r.y + r.h - y - 1;
      const from = Math.max(0, Math.min(this.setupSel - Math.floor(room / 2), rows.length - room));
      rows.slice(from, from + room).forEach((row, k) => {
        const i = from + k;
        const line = { x, y, w, h: 1 };
        const bg = i === this.setupSel && focused ? mix(c.accent, c.bg, 0.8) : ui.hovered(line) ? c.highlight : undefined;
        if (bg) ui.fill(line, { bg });
        const st = bg ? { bg } : {};
        if (row.kind === "mod") {
          const mine = all.filter((s) => s.source === row.id);
          const on = mine.filter((s) => !hidden.includes(s.id)).length;
          ib.lib.checkbox(ui, x + 1, y, on === mine.length ? true : on ? "some" : false, { bg: st.bg });
          ui.text(x + 5, y, moduleName(row.id), { fg: c.title, attrs: BOLD, ...st });
          ui.textRight(x + w - 1, y, `${on}/${mine.length}`, { fg: c.subtle, ...st });
        } else {
          const off = hidden.includes(row.s.id);
          ui.text(x + 1, y, "└", { fg: c.faint, ...st });
          ib.lib.checkbox(ui, x + 3, y, !off, { bg: st.bg });
          ui.text(x + 7, y, t(row.s.label), { fg: off ? c.muted : c.fg, ...st }, w - 32);
          ui.textRight(x + w - 1, y, `${show(row.s)}  ${row.s.id}`, { fg: c.subtle, ...st });
        }
        ui.hit(line, { onClick: () => ((this.setupSel = i), this.toggleRow(i)), tip: row.kind === "mod" ? `stats hide ${row.id} · stats unhide ${row.id}` : `stats hide ${row.s.id}` });
        y++;
      });
      if (!rows.length) ui.text(x, y, t("no stats yet"), { fg: c.muted });
    }
    title() {
      return "Stats";
    }
    status() {
      return this.setup ? t("↑↓ choose · space show / hide · s back") : t("a new · enter update · p pin · ←→ range · x remove · s choose what shows");
    }
    private cur(): Stat | undefined {
      return visible()[this.sel];
    }
    onText(s: string): boolean {
      if (s === "s") return (this.setup = !this.setup), true;
      if (this.setup) return s === " " ? (this.toggleRow(this.setupSel), true) : false;
      const st = this.cur();
      if (s === "a" || s === "+") return void addFlow(), true;
      if (s === "p" && st) return run(`stats ${pinned.includes(st.id) ? "unpin" : "pin"} ${st.id}`), true;
      if (s === "x" && st) return run(`stats rm ${st.id}`), true;
      return false;
    }
    onKey(k: KeyInput): boolean {
      return k.combo === "delete" ? this.onText("x") : false;
    }
    onAction(a: Action): boolean {
      if (this.setup) {
        const n = this.setupRows().length;
        if (a === "up") return (this.setupSel = n ? (this.setupSel - 1 + n) % n : 0), true;
        if (a === "down" || a === "item-next") return (this.setupSel = n ? (this.setupSel + 1) % n : 0), true;
        if (a === "confirm") return this.toggleRow(this.setupSel), true;
        if (a === "back") return (this.setup = false), true;
        return false;
      }
      const n = visible().length;
      if (a === "up") return (this.sel = n ? (this.sel - 1 + n) % n : 0), true;
      if (a === "down") return (this.sel = n ? (this.sel + 1) % n : 0), true;
      if (a === "left") return (this.range = Math.max(0, this.range - 1)), true;
      if (a === "right") return (this.range = Math.min(RANGES.length - 1, this.range + 1)), true;
      if (a === "confirm") {
        const st = this.cur();
        return void (st ? updateFlow(st) : addFlow()), true;
      }
      return false;
    }
    render(ui: UI, r: Rect, focused: boolean): void {
      const c = ui.c;
      if (!loaded) return;
      if (wantSetup) (this.setup = true), (wantSetup = false);
      if (this.setup) return this.renderSetup(ui, r, focused);
      ui.animate(60_000);
      const listW = Math.min(46, Math.floor(r.w * 0.42));
      let y = r.y + 1;
      const bw = ui.button(r.x + 2, y, t("+ track something"), () => void addFlow(), { tip: "a" });
      ui.button(r.x + 4 + bw, y, t("⚙ what shows"), () => (this.setup = true), { tip: "s · stats setup" });
      y += 2;
      this.sel = Math.min(this.sel, Math.max(0, visible().length - 1));
      if (!visible().length) {
        ui.text(r.x + 2, y, t("no stats yet — a starts one; modules add theirs"), { fg: c.muted }, r.w - 4);
        return;
      }
      visible().forEach((s, i) => {
        if (y >= r.y + r.h - 1) return;
        const row = { x: r.x + 1, y, w: listW, h: 1 };
        const sel = i === this.sel;
        const bg = sel ? mix(c.accent, c.bg, focused ? 0.78 : 0.88) : ui.hovered(row) ? c.highlight : undefined;
        if (bg) ui.fill(row, { bg });
        const st = bg ? { bg } : {};
        ui.text(row.x + 1, y, pinned.includes(s.id) ? "★" : "·", { fg: pinned.includes(s.id) ? c.warning : c.faint, ...st });
        const end = ui.textRight(row.x + listW - 1, y, show(s), { fg: c.fg, attrs: BOLD, ...st });
        const sp = spark(s, 8);
        ui.text(end - 9, y, sp, { fg: c.accent, ...st });
        ui.text(row.x + 3, y, t(s.label), { fg: sel ? c.fg : c.subtle, ...st }, end - row.x - 14);
        ui.hit(row, { onClick: () => (this.sel = i), tip: `stats show ${s.id}` });
        y++;
      });

      // the graph of the selected stat
      const s = this.cur();
      if (!s) return;
      const days = RANGES[this.range];
      const key = `${s.id}:${days}:${s.updated}`;
      if (this.seriesFor !== key) {
        this.seriesFor = key;
        void values(s.id, days).then((v) => ((this.series = v), ib.ui.redraw()));
      }
      const gx = r.x + listW + 3, gw = r.w - listW - 5;
      if (gw < 16) return;
      let gy = r.y + 1;
      ui.text(gx, gy, t(s.label), { fg: c.title, attrs: BOLD }, gw - 20);
      ui.textRight(gx + gw, gy, `${s.id} · ${s.source}`, { fg: c.muted });
      gy++;
      ui.text(gx, gy, show(s), { fg: c.accent, attrs: BOLD });
      let bx = gx + gw;
      for (let i = RANGES.length - 1; i >= 0; i--) {
        const label = `${RANGES[i]}${t("d")}`;
        bx -= label.length + 3;
        ui.button(bx, gy, label, () => (this.range = i), { selected: i === this.range, tip: `stats show ${s.id} ${RANGES[i]}` });
      }
      gy += 2;
      const v = this.series;
      const gh = Math.max(3, r.y + r.h - gy - 3);
      if (v.length) {
        const lo = Math.min(...v), hi = Math.max(...v);
        const base = s.kind === "counter" ? 0 : lo - (hi - lo) * 0.1;
        const span = hi - base || 1;
        ui.box({ x: gx, y: gy, w: gw, h: gh + 2 }, {});
        // stretch the days over the width (2 samples per cell)
        const samples = (gw - 2) * 2;
        const stretched = Array.from({ length: samples }, (_, i) => (v[Math.min(v.length - 1, Math.floor((i / samples) * v.length))] - base) / span);
        ui.chart({ x: gx + 1, y: gy + 1, w: gw - 2, h: gh }, stretched, c.accent);
        ui.text(gx + 2, gy, ` ${show(s, hi)} `, { fg: c.subtle });
        ui.text(gx + 2, gy + gh + 1, ` ${show(s, s.kind === "counter" ? 0 : lo)} `, { fg: c.subtle });
        const sum = v.reduce((a, b) => a + b, 0);
        ui.text(gx, gy + gh + 2, `${days} ${t("days")} · min ${show(s, lo)} · max ${show(s, hi)} · ${s.kind === "counter" ? `${t("total")} ${show(s, sum)}` : `${t("avg")} ${show(s, sum / v.length)}`}`, { fg: c.muted }, gw);
      }
    }
  }

  ib.apps.register({ kind: "stats", title: "Stats", description: "numbers over time, from modules and from you", icon: "▁▃▇", launcher: true, create: () => new StatsApp() });
  ib.palette.register({ id: "stats.new", title: "Stats: track something new…", group: "stats", run: () => void addFlow() });

  // ── the widget (and its pop-up) ──
  let popSel = 0;
  ib.widgets.register({
    id: "board",
    title: "stats",
    description: "your numbers and their last days (STATS module) — stats pin <id> to choose",
    size: { w: 4, h: 3 },
    min: { w: 2, h: 1 },
    open: "stats open",
    render(ui, r) {
      const c = ui.c;
      if (!loaded) return;
      const list = shown();
      if (!list.length) return void ui.text(r.x + 1, r.y, t("no stats yet"), { fg: c.muted }, r.w - 2);
      const sw = r.w >= 30 ? 10 : r.w >= 20 ? 6 : 0;
      list.slice(0, r.h).forEach((s, i) => {
        const end = ui.textRight(r.x + r.w - 1, r.y + i, show(s), { fg: c.fg, attrs: BOLD });
        if (sw) ui.text(end - sw - 1, r.y + i, spark(s, sw), { fg: c.accent });
        ui.text(r.x + 1, r.y + i, t(s.label), { fg: c.subtle }, end - r.x - sw - 3);
      });
    },
    popup: {
      title: "stats",
      size: { w: 64, h: 14 },
      hint: "a new · enter update · p pin · ↑↓",
      render(ui, r) {
        const c = ui.c;
        popSel = Math.min(popSel, Math.max(0, visible().length - 1));
        visible().slice(0, r.h - 2).forEach((s, i) => {
          const row = { x: r.x, y: r.y + i, w: r.w, h: 1 };
          const bg = i === popSel ? mix(c.accent, c.bg, 0.8) : undefined;
          if (bg) ui.fill(row, { bg });
          const st = bg ? { bg } : {};
          ui.text(r.x + 1, r.y + i, pinned.includes(s.id) ? "★" : " ", { fg: c.warning, ...st });
          const end = ui.textRight(r.x + r.w - 2, r.y + i, show(s), { fg: c.fg, attrs: BOLD, ...st });
          ui.text(end - 15, r.y + i, spark(s, 14), { fg: c.accent, ...st });
          ui.text(r.x + 3, r.y + i, t(s.label), { fg: c.fg, ...st }, end - r.x - 20);
          ui.hit(row, { onClick: () => (popSel = i), tip: `stats show ${s.id}` });
        });
        if (!visible().length) ui.text(r.x + 2, r.y, t("no stats yet — a starts one; modules add theirs"), { fg: c.muted });
        ui.button(r.x + 2, r.y + r.h - 1, t("+ track something"), () => void addFlow(), { tip: "a" });
      },
      onText: (s) => {
        const st = visible()[popSel];
        if (s === "a" || s === "+") return void addFlow(), true;
        if (s === "p" && st) return run(`stats ${pinned.includes(st.id) ? "unpin" : "pin"} ${st.id}`), true;
        return false;
      },
      onAction: (a) => {
        const n = visible().length;
        if (a === "up") return (popSel = n ? (popSel - 1 + n) % n : 0), true;
        if (a === "down") return (popSel = n ? (popSel + 1) % n : 0), true;
        if (a === "confirm" && visible()[popSel]) return void updateFlow(visible()[popSel]), true;
        return false;
      },
    },
  });

  ib.lib.addTranslations("fr", {
    "Stats": "Stats",
    "stats": "stats",
    "from": "de",
    "updated": "mis à jour",
    "days": "jours",
    "d": "j",
    "total": "total",
    "avg": "moy.",
    "Track what?": "Suivre quoi ?",
    "weight, pushups, savings…": "poids, pompes, épargne…",
    "What kind?": "Quel genre ?",
    "a level": "un niveau",
    "weight, savings: the last value counts": "poids, épargne : la dernière valeur compte",
    "a counter": "un compteur",
    "pushups, pages: adds up each day": "pompes, pages : s'additionne chaque jour",
    "Value now?": "Valeur actuelle ?",
    "How many today?": "Combien aujourd'hui ?",
    "Add how many?": "Ajouter combien ?",
    "Unit? (optional)": "Unité ? (facultatif)",
    "{id} is kept by the {m} module": "{id} est tenu par le module {m}",
    "a new · enter update · p pin · ←→ range · x remove": "a nouveau · entrée mettre à jour · p épingler · ←→ période · x retirer",
    "+ track something": "+ suivre quelque chose",
    "no stats yet — a starts one; modules add theirs": "pas encore de stats — a en commence une ; les modules ajoutent les leurs",
    "no stats yet": "pas encore de stats",
    "a new · enter update · p pin · ↑↓": "a nouveau · entrée mettre à jour · p épingler · ↑↓",
    "your numbers and their last days (STATS module) — stats pin <id> to choose": "tes chiffres et leurs derniers jours (module STATS) — stats pin <id> pour choisir",
    "numbers over time, from modules and from you": "des chiffres dans le temps, des modules et de toi",
    "‹ back to the stats": "‹ retour aux stats",
    "what STATS shows — space or click to switch": "ce que STATS affiche — espace ou clic pour basculer",
    "↑↓ choose · space show / hide · s back": "↑↓ choisir · espace afficher / masquer · s retour",
    "a new · enter update · p pin · ←→ range · x remove · s choose what shows": "a nouveau · entrée mettre à jour · p épingler · ←→ période · x retirer · s choisir l'affichage",
    "⚙ what shows": "⚙ affichage",
    "tasks open": "tâches ouvertes",
    "tasks added": "tâches ajoutées",
    "tasks done": "tâches faites",
    "reminders pending": "rappels à venir",
    "reminders rung": "rappels sonnés",
    "events this week": "événements cette semaine",
    "tracks played": "morceaux joués",
    "focus sessions": "sessions de focus",
    "minutes of focus": "minutes de focus",
    "timers started": "minuteurs lancés",
    "journal pages": "pages de journal",
    "messages to the AI": "messages à l'IA",
    "commands run": "commandes lancées",
    "notes in the vault": "notes dans le coffre",
  });
}

let stopListening: (() => void) | null = null;
export function deactivate(): void {
  stopListening?.();
  stopListening = null;
}
