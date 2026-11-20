/**
 * REMINDERS — local reminders. A system notification (with the deck's
 * "tu-dut") 15 minutes before — or whatever you choose — and on time. Purely
 * local: no Google, no Apple, no account; stored in the module's data file.
 *
 *   remind "call mom" fri 18:00            15 min before, then on time
 *   remind "pills" tomorrow 9h --before 0  only on time
 *   remind "tea" +10m                      in 10 minutes
 *   remind ls · remind done <n> · remind rm <n> · remind test
 *
 * The deck has to be running for a reminder to ring (it can be in the
 * background). Missed ones ring as soon as it starts.
 */
import type { App } from "../../src/apps/types";
import type { Rect } from "../../src/core/grid";
import type { Action, KeyInput } from "../../src/core/input";
import type { IcebreakerAPI } from "../../src/plugins/api";
import type { UI } from "../../src/ui/ui";
import type * as Dates from "../../src/core/dates";
/** the deck's one date reader (ib.lib.dates), set when the module starts */
let D!: typeof Dates;

interface Reminder {
  id: number;
  title: string;
  /** ISO date-time */
  due: string;
  /** minutes before `due` for the early warning (0 = none) */
  before: number;
  done: boolean;
  warned: boolean;
  fired: boolean;
}

const pad = (n: number) => D.pad2(n);
/** a day the way people write it — ib.lib.dates */
const parseDay = (s: string): Date | null => D.parseDay(s);
/** a time of day as [hours, minutes] — ib.lib.dates */
const parseTime = (s: string): [number, number] | null => {
  const m = D.parseTime(s);
  return m === null ? null : [Math.floor(m / 60), m % 60];
};

/** "+10m", "+2h", "in 1h30" as minutes from now, or null */
function parseIn(s: string): number | null {
  const m = /^\+?(?:(\d+)h)?(?:(\d+)m(?:in)?)?$/i.exec(s.trim());
  if (!m || (!m[1] && !m[2]) || !s.trim().startsWith("+")) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}
let timer: ReturnType<typeof setInterval> | null = null;

export function activate(ib: IcebreakerAPI): void {
  D = ib.lib.dates;
  const { BOLD, mix, q, fmt, parseFlags, t } = ib.lib;
  const run = (line: string) => void ib.shell.run(line);
  let list: Reminder[] = [];
  let next = 1;
  let loaded = false;
  const ready = (async () => {
    list = await ib.storage.get<Reminder[]>("reminders", []);
    next = list.reduce((n, r) => Math.max(n, r.id + 1), 1);
    loaded = true;
    check();
  })();
  const save = () => {
    void ib.stats.set("pending", list.filter((r) => !r.done && !r.fired).length, { label: "reminders pending" }).catch(() => {});
    return ib.storage.set("reminders", list).then(() => ib.ui.redraw());
  };
  ib.modules.expose("list", { doc: "list() → the reminders still to come { id, title, due (ISO), before }", fn: async () => (await ready, list.filter((r) => !r.done && !r.fired).map((r) => ({ ...r }))) });
  ib.modules.expose("add", {
    doc: "add(title, dueISO, beforeMinutes = 15) → the new reminder",
    fn: async (title: string, due: string, before = 15) => {
      await ready;
      const d = new Date(due);
      if (Number.isNaN(d.getTime())) throw new Error(`reminders.add: "${due}" isn't a date`);
      const r: Reminder = { id: next++, title: String(title), due: d.toISOString(), before: Number(before) || 0, done: false, warned: false, fired: false };
      list.push(r);
      await save();
      return { ...r };
    },
  });

  const when = (r: Reminder) => {
    const d = new Date(r.due);
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? t("today") : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const left = (r: Reminder) => {
    const min = Math.round((new Date(r.due).getTime() - Date.now()) / 60000);
    if (min < 0) return t("late");
    if (min < 60) return `${min} min`;
    if (min < 1440) return `${Math.floor(min / 60)} h ${pad(min % 60)}`;
    return `${Math.round(min / 1440)} d`;
  };
  const upcoming = () => list.filter((r) => !r.done).sort((a, b) => a.due.localeCompare(b.due));

  /** Ring what's due: the early warning, then on time. */
  function check(): void {
    if (!loaded) return;
    const now = Date.now();
    let changed = false;
    for (const r of list) {
      if (r.done) continue;
      const due = new Date(r.due).getTime();
      if (!r.fired && now >= due) {
        r.fired = r.warned = true;
        changed = true;
        void ib.stats.add("rung", 1, { label: "reminders rung", kind: "counter" }).catch(() => {});
        ib.ui.alert(`◷ ${r.title}`, t("now"));
      } else if (!r.warned && r.before > 0 && now >= due - r.before * 60000) {
        r.warned = true;
        changed = true;
        ib.ui.alert(`◷ ${r.title}`, t("in {n} min", { n: Math.max(1, Math.round((due - now) / 60000)) }));
      }
    }
    if (changed) void save();
  }
  if (timer) clearInterval(timer);
  timer = setInterval(check, 10_000);

  ib.settings.register([
    { key: "before", label: "early warning, by default (minutes)", type: "choice", options: ["0", "5", "10", "15", "30", "60"], default: "15", help: "How long before the time a reminder warns you first (then it rings again on time). 0 = only on time. `--before` on a reminder overrides it." },
  ]);

  /** Words → the title, and the time if some words say one (fri 18:00, tomorrow 9h, +10m). */
  function parseWhen(words: string[]): { title: string[]; due: Date | null; inMin: number | null } {
    let day: Date | null = null, time: [number, number] | null = null, inMin: number | null = null;
    const title: string[] = [];
    for (const w of words) {
      if (inMin === null && parseIn(w) !== null) inMin = parseIn(w);
      else if (!time && parseTime(w)) time = parseTime(w);
      else if (!day && parseDay(w)) day = parseDay(w);
      else title.push(w);
    }
    return { title, due: day || time || inMin !== null ? whenOf(day, time, inMin) : null, inMin };
  }

  function whenOf(day: Date | null, time: [number, number] | null, inMin: number | null): Date {
    if (inMin !== null) return new Date(Date.now() + inMin * 60000);
    const d = day ?? new Date();
    const [h, m] = time ?? [9, 0];
    let due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
    if (!day && due.getTime() < Date.now()) due = new Date(due.getTime() + 86400000); // a time already past today → tomorrow
    return due;
  }

  ib.commands.register({
    name: "remind",
    aliases: ["reminder", "reminders"],
    summary: "local reminders: a notification before and on time (REMINDERS module)",
    usage: [
      'remind "title" <day> <time> [--before 15m]   (default: 15 min before, then on time)',
      'remind "title" +10m | +2h                    in a while (no time: in 1 hour)',
      "remind ls                                    what's coming",
      "remind done <n> · remind rm <n>",
      'remind edit <n> "new title" [new time]       change it (what you give)',
      "remind test                                  try the notification",
      "remind open                                  the REMINDERS app",
    ].join("\n"),
    examples: [
      ['remind "call mom" fri 18:00', "a notification at 17:45 and at 18:00"],
      ['remind "pills" tomorrow 9h --before 0', "only on time"],
      ['remind "tea" +10m', "in 10 minutes"],
    ],
    complete: () => ["ls", "done", "rm", "edit", "test", "open"],
    async run(ctx) {
      await ready;
      const [sub, ...rest] = ctx.args;
      if (!sub || sub === "ls" || sub === "list") {
        const up = upcoming();
        if (!up.length) return ctx.out(fmt.dim("no reminders\n")), 0;
        for (const r of up) ctx.out(`${fmt.dim(String(r.id).padStart(3))}  ${fmt.bold(r.title)} ${fmt.dim(`· ${when(r)} · ${left(r)}${r.before ? ` · ${r.before} min before` : ""}`)}\n`);
        return 0;
      }
      if (sub === "open") return void ib.apps.open("reminders"), 0;
      if (sub === "test") return ib.ui.alert("◷ ICEBREAKER", t("this is what a reminder looks like")), 0;
      if (sub === "done" || sub === "rm" || sub === "remove") {
        const r = list.find((x) => x.id === Number(rest[0]));
        if (!r) return ctx.err(`remind: no reminder ${rest[0] ?? ""} (remind ls)\n`), 1;
        if (sub === "done") r.done = true;
        else list = list.filter((x) => x !== r);
        await save();
        ctx.out(`${sub === "done" ? fmt.green("✓") : fmt.red("✕")} ${r.title}\n`);
        return 0;
      }
      if (sub === "edit") {
        // remind edit <n> "new title" [new time] — what you give changes, the rest stays
        const r = list.find((x) => x.id === Number(rest[0]));
        if (!r) return ctx.err(`remind: no reminder ${rest[0] ?? ""} (remind ls)\n`), 1;
        const { flags: ef, rest: ew } = parseFlags(rest.slice(1), ["before"]);
        const p = parseWhen(ew);
        if (p.title.length) r.title = p.title.join(" ");
        if (p.due) {
          r.due = p.due.toISOString();
          r.warned = r.fired = false;
        }
        const eb = typeof ef.before === "string" ? /^(\d+)(m|min|h)?$/.exec(ef.before) : null;
        if (eb) r.before = Number(eb[1]) * (eb[2] === "h" ? 60 : 1);
        await save();
        ctx.out(`${fmt.cyan("~")} ${fmt.bold(r.title)} ${fmt.dim(`· ${when(r)} · #${r.id}`)}\n`);
        return 0;
      }
      // remind "title" <when…>
      const { flags, rest: words } = parseFlags(ctx.args, ["before"]);
      const { title, due: parsed, inMin } = parseWhen(words);
      if (!title.length) return ctx.err('usage: remind "title" <day> <time> | +10m\n'), 1;
      // no time given: in an hour
      const due = parsed ?? new Date(Date.now() + 3600_000);
      const b = typeof flags.before === "string" ? /^(\d+)(m|min|h)?$/.exec(flags.before) : null;
      const dflt = Number(ib.settings.get("before") ?? 15);
      const before = b ? Number(b[1]) * (b[2] === "h" ? 60 : 1) : inMin !== null && inMin <= dflt ? 0 : dflt;
      const r: Reminder = { id: next++, title: title.join(" "), due: due.toISOString(), before, done: false, warned: false, fired: false };
      list.push(r);
      await save();
      ctx.out(`${fmt.green("◷")} ${fmt.bold(r.title)} ${fmt.dim(`· ${when(r)}${before ? ` · ${t("a notification {n} min before", { n: before })}` : ""} · #${r.id}`)}\n`);
      return 0;
    },
  });

  /** Title, then when — the same words as the command. */
  async function addFlow(): Promise<void> {
    const title = await ib.ui.prompt(t("Remind me of…"), { placeholder: t("call mom") });
    if (!title?.trim()) return;
    // ask again until the time is understood (it used to fail silently, in the shell)
    let initial = "";
    for (;;) {
      const raw = await ib.ui.prompt(t("When? (empty: in 1 hour)"), { initial, placeholder: "fri 18:00 · tomorrow 9h · +10m", suggestions: ["+10m", "+30m", "+1h", "today 18:00", "today 21:00", "tomorrow 9:00", "demain 9h", "mon 9:00", "fri 18:00"] });
      if (raw === null) return; // esc: no reminder
      const at = raw.trim() || "+1h"; // nothing said: in an hour
      // every word must say a time: one that doesn't would end up in the title
      const p = parseWhen(at.split(/\s+/));
      if (p.title.length || !p.due) {
        ib.ui.notify(t("I didn't understand \"{at}\" — try fri 18:00, tomorrow 9h, +10m", { at }), "warning");
        initial = at;
        continue;
      }
      const before = list.length;
      const code = await ib.shell.run(`remind ${q(title.trim())} ${at.trim()}`);
      if (code === 0 && list.length > before) {
        const r = list[list.length - 1];
        ib.ui.notify(`◷ ${r.title} — ${when(r)}`, "success");
        return;
      }
      ib.ui.notify(t("I didn't understand \"{at}\" — try fri 18:00, tomorrow 9h, +10m", { at: at.trim() }), "warning");
      initial = at.trim();
    }
  }

  /** Change a reminder: its title, then its time (empty = keep it). */
  async function editFlow(rem: Reminder): Promise<void> {
    const title = await ib.ui.prompt(t("The reminder"), { initial: rem.title });
    if (title === null) return;
    const at = await ib.ui.prompt(t("When? (empty: keep {when})", { when: when(rem) }), { placeholder: "fri 18:00 · tomorrow 9h · +10m", suggestions: ["+10m", "+30m", "+1h", "today 18:00", "tomorrow 9:00", "mon 9:00", "fri 18:00"] });
    if (at === null) return;
    await ib.shell.run(`remind edit ${rem.id} ${q(title.trim() || rem.title)} ${at.trim()}`);
  }

  /** the line under the mouse in the HOME widget (Delete / ⌘⌫ removes it) */
  let hoverId: number | null = null;
  const isDelete = (k: KeyInput) => k.combo === "delete" || k.combo === "ctrl+backspace" || k.combo === "backspace";

  /** right-click on a reminder */
  const remMenu = (rem: Reminder) => [
    { label: t("done ✓"), cmd: `remind done ${rem.id}` },
    { label: t("Edit…"), run: () => void editFlow(rem), hint: "e" },
    { label: t("remove"), cmd: `remind rm ${rem.id}`, danger: true, hint: "del" },
    "-" as const,
    { label: t("+ add a reminder"), run: () => void addFlow() },
  ];

  // ── the app ──
  class RemindersApp implements App {
    readonly kind = "reminders";
    readonly key = "reminders";
    /** THE list (ib.lib.ListView): selection, scrolling, mouse, right-click */
    private readonly list = new ib.lib.ListView<Reminder>();
    constructor() {
      this.list.onActivate = (rem) => void editFlow(rem);
      this.list.tipOf = (rem) => `remind done ${rem.id} · remind rm ${rem.id}`;
      this.list.menuOf = (rem) => remMenu(rem);
    }
    title() {
      return "Reminders";
    }
    status() {
      return t("a add · e edit · d done · x remove · t test the notification");
    }
    onText(s: string): boolean {
      const r = this.list.current;
      if (s === "a" || s === "+") return void addFlow(), true;
      if (s === "e" && r) return void editFlow(r), true;
      if (s === "d" && r) return run(`remind done ${r.id}`), true;
      if (s === "x" && r) return run(`remind rm ${r.id}`), true;
      if (s === "t") return run("remind test"), true;
      return false;
    }
    onKey(k: KeyInput): boolean {
      return isDelete(k) ? this.onText("x") : false;
    }
    onAction(a: Action): boolean {
      if (a === "confirm" && !this.list.current) return void addFlow(), true;
      return this.list.onAction(a);
    }
    render(ui: UI, r: Rect, focused: boolean): void {
      const c = ui.c;
      if (!loaded) return;
      ui.animate(30_000);
      const w = Math.min(r.w - 4, 90), x = r.x + Math.floor((r.w - w) / 2);
      let y = r.y + 1;
      const bar = new ib.lib.Row(ui, x, y, x + w);
      bar.button(t("+ add a reminder"), () => void addFlow(), { tip: "a" });
      bar.button(t("test the notification"), () => {}, { cmd: "remind test" });
      y += 2;
      this.list.items = upcoming();
      if (!this.list.items.length) return void ui.text(x, y, t("nothing to remember — a adds a reminder"), { fg: c.muted });
      this.list.render(ui, { x, y, w, h: r.y + r.h - 1 - y }, focused, (rem, row, sel) => {
        const late = new Date(rem.due).getTime() < Date.now();
        // (the list paints the row's background: the text keeps it)
        ui.text(row.x + 1, row.y, "◷", { fg: late ? c.error : c.accent });
        ui.text(row.x + 4, row.y, rem.title, { fg: c.fg, attrs: sel ? BOLD : 0 }, row.w - 44);
        ui.textRight(row.x + row.w - 20, row.y, when(rem), { fg: c.subtle });
        ui.textRight(row.x + row.w - 10, row.y, left(rem), { fg: late ? c.error : c.warning });
        // the obvious way: ✓ done and ✕ remove on every line (THE button)
        ui.button(row.x + row.w - 8, row.y, "✓", () => {}, { cmd: `remind done ${rem.id}`, tip: t("done (d)"), accent: c.success });
        ui.button(row.x + row.w - 4, row.y, "✕", () => {}, { cmd: `remind rm ${rem.id}`, tip: t("remove (x)"), accent: c.error });
      });
    }
  }
  ib.apps.register({ kind: "reminders", title: "Reminders", description: "local reminders with notifications", icon: "◷", launcher: true, create: () => new RemindersApp() });
  ib.palette.register({ id: "reminders.add", title: "Reminders: remind me of…", group: "reminders", run: () => void addFlow() });

  // ── the widget (and its pop-up) ──
  ib.widgets.register({
    id: "next",
    title: "reminders",
    description: "what you asked to remember (REMINDERS module)",
    size: { w: 4, h: 3 },
    min: { w: 2, h: 1 },
    open: "remind open",
    onKey(k) {
      const rem = list.find((x) => x.id === hoverId && !x.done);
      if (!rem || !isDelete(k)) return false;
      run(`remind rm ${rem.id}`);
      return true;
    },
    render(ui, r) {
      const c = ui.c;
      if (!loaded) return;
      ui.animate(30_000);
      const up = upcoming();
      hoverId = null;
      if (!up.length) return void ui.text(r.x + 1, r.y, t("nothing to remember"), { fg: c.muted }, r.w - 2);
      up.slice(0, r.h).forEach((rem, i) => {
        const late = new Date(rem.due).getTime() < Date.now();
        // ✓ on every line, right here on HOME: one click and it's done
        const dn = { x: r.x + r.w - 3, y: r.y + i, w: 3, h: 1 };
        const end = ui.textRight(dn.x - 1, r.y + i, left(rem), { fg: late ? c.error : c.warning });
        ui.text(r.x + 1, r.y + i, "◷", { fg: c.accent });
        ui.text(r.x + 4, r.y + i, rem.title, { fg: c.fg }, end - r.x - 5);
        const line = { x: r.x, y: r.y + i, w: dn.x - r.x, h: 1 };
        if (ui.hovered(line)) hoverId = rem.id;
        ui.hit(line, { tip: `${rem.title}\n✓ = ${t("done")} · ${t("del: remove · right-click: edit, more")}`, menu: () => remMenu(rem) });
        ui.button(dn.x, dn.y, "✓", () => {}, { cmd: `remind done ${rem.id}`, tip: t("done (d)"), accent: c.success });
      });
    },
    popup: {
      title: "reminders",
      size: { w: 60, h: 12 },
      hint: "a add · e edit · d done · del remove · ↑↓",
      render(ui, r) {
        const c = ui.c;
        const up = upcoming();
        popSel = Math.min(popSel, Math.max(0, up.length - 1));
        up.slice(0, r.h - 2).forEach((rem, i) => {
          const row = { x: r.x, y: r.y + i, w: r.w, h: 1 };
          if (i === popSel) ui.fill(row, { bg: mix(c.accent, c.bg, 0.8) });
          const st = i === popSel ? { bg: mix(c.accent, c.bg, 0.8) } : {};
          ui.text(r.x + 2, r.y + i, rem.title, { fg: c.fg, ...st }, r.w - 30);
          ui.textRight(r.x + r.w - 6, r.y + i, `${when(rem)} · ${left(rem)}`, { fg: c.subtle, ...st });
          ui.hit(row, { onClick: () => (popSel = i), menu: () => remMenu(rem) });
          // after the row's own click (the last one registered wins): ✓ is its own
          ui.button(r.x + r.w - 4, r.y + i, "✓", () => {}, { cmd: `remind done ${rem.id}`, tip: t("done (d)"), accent: c.success });
        });
        if (!up.length) ui.text(r.x + 2, r.y, t("nothing to remember — a adds a reminder"), { fg: c.muted });
        ui.button(r.x + 2, r.y + r.h - 1, t("+ add a reminder"), () => void addFlow(), { tip: "a" });
      },
      onText: (s) => {
        const rem = upcoming()[popSel];
        if (s === "a" || s === "+") return void addFlow(), true;
        if (s === "d" && rem) return run(`remind done ${rem.id}`), true;
        if (s === "e" && rem) return void editFlow(rem), true;
        return false;
      },
      onKey: (k) => {
        const rem = upcoming()[popSel];
        if (rem && isDelete(k)) return run(`remind rm ${rem.id}`), true;
        return false;
      },
      onAction: (a) => {
        const n = upcoming().length;
        if (a === "up") return (popSel = n ? (popSel - 1 + n) % n : 0), true;
        if (a === "down") return (popSel = n ? (popSel + 1) % n : 0), true;
        return false;
      },
    },
  });
  let popSel = 0;

  ib.lib.addTranslations("fr", {
    "late": "en retard",
    "now": "maintenant",
    "in {n} min": "dans {n} min",
    "this is what a reminder looks like": "voilà à quoi ressemble un rappel",
    "a notification {n} min before": "une notification {n} min avant",
    "Remind me of…": "Me rappeler…",
    "call mom": "appeler maman",
    "When?": "Quand ?",
    "Reminders": "Rappels",
    "reminders": "rappels",
    "a add · d done · x remove · t test the notification": "a ajouter · d fait · x retirer · t tester la notification",
    "+ add a reminder": "+ ajouter un rappel",
    "test the notification": "tester la notification",
    "nothing to remember — a adds a reminder": "rien à se rappeler — a ajoute un rappel",
    "nothing to remember": "rien à se rappeler",
    "a add · e edit · d done · del remove · ↑↓": "a ajouter · e modifier · d fait · suppr retirer · ↑↓",
    "a add · e edit · d done · x remove · t test the notification": "a ajouter · e modifier · d fait · x retirer · t tester la notification",
    "The reminder": "Le rappel",
    "When? (empty: keep {when})": "Quand ? (vide : garder {when})",
    "Edit…": "Modifier…",
    "del: remove · right-click: edit, more": "suppr : retirer · clic droit : modifier, plus",
    "When? (empty: in 1 hour)": "Quand ? (vide : dans 1 heure)",
    'I didn\'t understand "{at}" — try fri 18:00, tomorrow 9h, +10m': "je n'ai pas compris « {at} » — essaie ven 18:00, demain 9h, +10m",
    "done ✓": "fait ✓",
    remove: "retirer",
    "done (d)": "fait (d)",
    done: "fait",
    "right-click: more": "clic droit : plus",
    "remove (x)": "retirer (x)",
    "what you asked to remember (REMINDERS module)": "ce que tu as demandé de te rappeler (module RAPPELS)",
  });
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
