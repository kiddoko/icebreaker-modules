/**
 * TODO — a to-do list, written as a module (a built-in plugin).
 *
 * One feature, one module: the tasks live in the module's own data file
 * (.icebreaker/plugin-data/todo.json), not in your notes. Three faces, one
 * source of truth — the `todo` command:
 *
 *   todo add "walk the dog" --urgent --due tomorrow +home
 *   the TODO app        (a / space / 1-4 / d / e / x …)
 *   the HOME widget     (todo.list)
 *
 * The app and the widget never change the data themselves: they run `todo …`
 * commands through ib.shell.run, so every click shows up in the shell.
 * It only uses the public plugin API (`ib`): copy it to start your own module.
 */
import type { App } from "../../src/apps/types";
import type { Rect } from "../../src/core/grid";
import type { Action, KeyInput } from "../../src/core/input";
import type { IcebreakerAPI } from "../../src/plugins/api";
import type { Command, ShellContext } from "../../src/shell/types";
import type { UI } from "../../src/ui/ui";
import type * as Dates from "../../src/core/dates";
/** the deck's one date reader (ib.lib.dates), set when the module starts */
let D!: typeof Dates;

type Prio = "urgent" | "high" | "moderate" | "low";
const PRIOS: Prio[] = ["urgent", "high", "moderate", "low"];
/** Accepted spellings (flags and values), English and French. */
const PRIO_ALIAS: Record<string, Prio> = {
  urgent: "urgent", u: "urgent", "!!!": "urgent", "1": "urgent",
  high: "high", important: "high", haute: "high", "!!": "high", "2": "high",
  moderate: "moderate", normal: "moderate", medium: "moderate", moyenne: "moderate", "!": "moderate", "3": "moderate",
  low: "low", l: "low", basse: "low", later: "low", "4": "low",
};

interface Task {
  id: number;
  text: string;
  prio: Prio;
  /** YYYY-MM-DD or null */
  due: string | null;
  tags: string[];
  done: boolean;
  created: string;
  doneAt: string | null;
  /** a task that comes back: see Repeat */
  repeat?: Repeat;
}

/**
 * When a recurring task is done it comes back, due on the next date of its
 * rule, until its cycles run out (or forever).
 *   every N days · every N weeks (on chosen weekdays) · every N months
 *   times: several times a day (it stays today until done that many times)
 */
interface Repeat {
  unit: "day" | "week" | "month";
  n: number;
  /** weekly: on these weekdays (0 = sunday) */
  days?: number[];
  /** several times a day */
  times?: number;
  /** done so many times today (with `times`) */
  todayCount?: number;
  todayDate?: string;
  /** cycles left (null = forever) */
  left: number | null;
  /** or until this date (YYYY-MM-DD) */
  until?: string | null;
  /** how many times it was done, all in all */
  total?: number;
  /** the week the rule started (every other week counts from it) */
  anchor: string;
}

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** "day", "2d", "other-day", "week", "2w", "mon,wed,sat", "month", "3m"… → a rule, or an error */
export function parseRepeat(raw: string): Omit<Repeat, "left" | "anchor"> | string {
  const v = raw.toLowerCase().trim();
  const named: Record<string, [Repeat["unit"], number]> = {
    day: ["day", 1], daily: ["day", 1], jour: ["day", 1], "every-day": ["day", 1],
    "other-day": ["day", 2], "every-other-day": ["day", 2],
    week: ["week", 1], weekly: ["week", 1], semaine: ["week", 1], "other-week": ["week", 2], "every-other-week": ["week", 2],
    month: ["month", 1], monthly: ["month", 1], mois: ["month", 1],
  };
  if (named[v]) return { unit: named[v][0], n: named[v][1] };
  const m = /^(\d+)\s*(d|day|days|j|w|week|weeks|s|m|month|months)$/.exec(v);
  if (m) {
    const n = Math.max(1, Math.min(365, Number(m[1])));
    const u = m[2][0] === "d" || m[2][0] === "j" ? "day" : m[2][0] === "w" || m[2] === "s" ? "week" : "month";
    return { unit: u, n };
  }
  const days = v.split(/[,\s]+/).map((d) => D.WEEKDAYS[d] ?? D.WEEKDAYS[d.slice(0, 3)]).filter((d) => d !== undefined);
  if (days.length && days.length === v.split(/[,\s]+/).length) return { unit: "week", n: 1, days: [...new Set(days)].sort() };
  return `can't read the repeat "${raw}" — try day, 2d, week, 2w, mon,wed,sat, month`;
}

/** "10", "100", "1y", "6m", "forever" → cycles or an end date */
function parseCycles(raw: string): { left: number | null; until: string | null } | string {
  const v = raw.toLowerCase().trim();
  if (["forever", "inf", "infinite", "∞", "toujours", "always"].includes(v)) return { left: null, until: null };
  if (/^\d+$/.test(v)) return { left: Math.max(1, Number(v)), until: null };
  const m = /^(\d+)\s*(y|year|years|an|ans|m|month|months|mois|w|week|weeks)$/.exec(v);
  if (m) {
    const d = new Date();
    const n = Number(m[1]);
    if (m[2][0] === "y" || m[2][0] === "a") d.setFullYear(d.getFullYear() + n);
    else if (m[2][0] === "m") d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n * 7);
    return { left: null, until: iso(d) };
  }
  return `can't read "${raw}" — a number of times (10, 100), a span (1y, 6m) or forever`;
}

function describeRepeat(r: Repeat): string {
  const every = r.unit === "week" && r.days?.length
    ? `${r.n === 2 ? "every other week on " : ""}${r.days.map((d) => WD[d]).join(" ")}`
    : r.n === 1 ? `every ${r.unit}` : r.n === 2 ? `every other ${r.unit}` : `every ${r.n} ${r.unit}s`;
  const times = r.times && r.times > 1 ? ` ×${r.times}` : "";
  const end = r.left !== null ? ` · ${r.left} left` : r.until ? ` · until ${r.until}` : "";
  return `↻ ${every}${times}${end}`;
}

/** The next due date after `from` (YYYY-MM-DD) for this rule. */
function nextDate(r: Repeat, from: string): string {
  const d = new Date(`${from}T12:00`);
  if (r.unit === "day") d.setDate(d.getDate() + r.n);
  else if (r.unit === "month") d.setMonth(d.getMonth() + r.n);
  else if (!r.days?.length) d.setDate(d.getDate() + 7 * r.n);
  else {
    const anchor = new Date(`${r.anchor}T12:00`);
    anchor.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7)); // that week's monday
    for (let i = 1; i <= 7 * r.n + 7; i++) {
      const c = new Date(d);
      c.setDate(d.getDate() + i);
      const week = Math.floor((c.getTime() - anchor.getTime()) / (7 * 86_400_000));
      if (r.days.includes(c.getDay()) && week % r.n === 0) return iso(c);
    }
    d.setDate(d.getDate() + 7);
  }
  return iso(d);
}

/** The first due date: today if the rule allows it, else its next date. */
function firstDate(r: Repeat): string {
  const today = iso(new Date());
  if (r.unit === "week" && r.days?.length && !r.days.includes(new Date().getDay())) return nextDate(r, today);
  return today;
}

type Filter = "open" | "today" | "all" | "done";
const FILTERS: Filter[] = ["open", "today", "all", "done"];

// ── dates ──────────────────────────────────────────────────────────────────

const iso = (d: Date) => D.ymd(d);
const inDays = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return iso(d);
};

/** "tomorrow", "fri", "+3d", "2w", "2026-12-01", "24/12" → YYYY-MM-DD; "-" → null; unreadable → undefined. */
export function parseDue(raw: string): string | null | undefined {
  const s = raw.trim().toLowerCase();
  if (["-", "none", "no", "clear", "aucune", "aucun"].includes(s)) return null;
  // a bare number is days from now here ("3" = in 3 days)
  const n = /^\+?(\d{1,3})(d|j)?$/.exec(s);
  if (n) return inDays(Number(n[1]));
  // the rest: the deck's one date reader (ib.lib.dates)
  const d = D.parseDay(s);
  return d ? iso(d) : undefined;
}

function daysUntil(due: string): number {
  const [y, mo, d] = due.split("-").map(Number);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((new Date(y, mo - 1, d, 12).getTime() - now.getTime()) / 86_400_000);
}

function dueLabel(due: string | null): string {
  if (!due) return "";
  const n = daysUntil(due);
  if (n < -1) return `${-n}d late`;
  if (n === -1) return "yesterday";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  const d = new Date(`${due}T12:00`);
  return n < 7 ? d.toLocaleDateString("en", { weekday: "short" }).toLowerCase() : d.toLocaleDateString("en", { day: "numeric", month: "short" }).toLowerCase();
}

// ── parsing "walk the dog --urgent --due tomorrow +home" ──────────────────

interface Parsed {
  repeat?: Omit<Repeat, "left" | "anchor">;
  repeatRaw?: string;
  times?: number;
  cycles?: { left: number | null; until: string | null };
  cyclesRaw?: string;
  text: string;
  prio?: Prio;
  due?: string | null;
  dueRaw?: string;
  tags: string[];
  error?: string;
}

export function parseTask(tokens: string[]): Parsed {
  const out: Parsed = { text: "", tags: [] };
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const f = /^--?([a-z!]+)(?:=(.*))?$/i.exec(t);
    if (f && t !== "-") {
      const k = f[1].toLowerCase();
      let v = f[2];
      if (PRIO_ALIAS[k] && !/^\d$/.test(k)) {
        out.prio = PRIO_ALIAS[k];
        continue;
      }
      if (k === "due" || k === "d" || k === "for") {
        v ??= tokens[++i];
        const d = v === undefined ? undefined : parseDue(v);
        if (d === undefined) out.error = `can't read the date "${v ?? ""}" — try today, tomorrow, fri, +3d, 2026-12-01, 24/12`;
        else (out.due = d), (out.dueRaw = v);
        continue;
      }
      if (k === "every" || k === "repeat" || k === "r") {
        v ??= tokens[++i];
        const r = parseRepeat(v ?? "");
        if (typeof r === "string") out.error = r;
        else (out.repeat = r), (out.repeatRaw = v);
        continue;
      }
      if (k === "times" || k === "x") {
        v ??= tokens[++i];
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 50) out.error = `--times: a number of times a day (2, 3…), not "${v ?? ""}"`;
        else out.times = n;
        continue;
      }
      if (k === "cycles" || k === "count" || k === "during") {
        v ??= tokens[++i];
        const c = parseCycles(v ?? "");
        if (typeof c === "string") out.error = c;
        else (out.cycles = c), (out.cyclesRaw = v);
        continue;
      }
      if (k === "prio" || k === "p") {
        v ??= tokens[++i];
        const p = PRIO_ALIAS[(v ?? "").toLowerCase()];
        if (!p) out.error = `unknown priority "${v ?? ""}" — urgent, high, moderate or low`;
        else out.prio = p;
        continue;
      }
      if (k === "tag" || k === "t") {
        v ??= tokens[++i];
        if (v) out.tags.push(v.replace(/^\+/, ""));
        continue;
      }
      out.error = `unknown option ${t} (see: man todo)`;
      continue;
    }
    if (/^\+[\p{L}\p{N}_-]+$/u.test(t)) {
      out.tags.push(t.slice(1));
      continue;
    }
    words.push(t);
  }
  out.text = words.join(" ").trim();
  return out;
}

/** Split typed text like a (tiny) shell: spaces separate, quotes group. */
function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of s.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// ── the module ─────────────────────────────────────────────────────────────

export function activate(ib: IcebreakerAPI): void {
  D = ib.lib.dates;
  // its settings (Settings → ◇ TODO)
  ib.settings.register([
    { key: "view", label: "opens on", type: "choice", options: ["open", "today", "all", "done"], default: "open", help: "What the TODO page shows when it opens: the open tasks, today's, all of them, or the done ones." },
    { key: "add", label: "new task", type: "action", value: () => "add", cmd: "todo add", help: "Add a task (todo add \"…\" --due fri --urgent)." },
  ]);
  ib.lib.addTranslations("fr", {
    "doesn't repeat": "ne se répète pas",
    "every day": "tous les jours",
    "several times a day": "plusieurs fois par jour",
    "every other day": "un jour sur deux",
    "on chosen weekdays": "certains jours de la semaine",
    "every week": "toutes les semaines",
    "every other week": "une semaine sur deux",
    "every month": "tous les mois",
    "Repeat “{task}”": "Répéter « {task} »",
    "How many times a day?": "Combien de fois par jour ?",
    "Which days?": "Quels jours ?",
    "forever": "pour toujours",
    "for a year": "pendant un an",
    "for a month": "pendant un mois",
    "a number of times…": "un nombre de fois…",
    "For how long?": "Pendant combien de temps ?",
    "How many times?": "Combien de fois ?",
  });
  const { BOLD, DIM, STRIKE, mix, strWidth, q, fmt } = ib.lib;

  // ── store (only the `todo` command writes it) ──
  let tasks: Task[] = [];
  let trash: Task[] = [];
  let nextId = 1;
  let loaded = false;
  const ready = (async () => {
    tasks = await ib.storage.get<Task[]>("tasks", []);
    trash = await ib.storage.get<Task[]>("trash", []);
    nextId = await ib.storage.get<number>("next", tasks.reduce((m, t) => Math.max(m, t.id + 1), 1));
    loaded = true;
    ib.ui.redraw();
  })();
  const save = async () => {
    void ib.stats.set("open", tasks.filter((t) => !t.done).length, { label: "tasks open" }).catch(() => {});
    await ib.storage.set("tasks", tasks);
    await ib.storage.set("trash", trash.slice(-20));
    await ib.storage.set("next", nextId);
    ib.ui.redraw();
  };

  /** r in the app: the repeat, picked from lists (the same words as `todo repeat`). */
  async function repeatFlow(t: Task): Promise<void> {
    const kinds: [string, string, string][] = [
      [ib.lib.t("doesn't repeat"), "", "off"],
      [ib.lib.t("every day"), "", "day"],
      [ib.lib.t("several times a day"), "", "day+times"],
      [ib.lib.t("every other day"), "", "2d"],
      [ib.lib.t("on chosen weekdays"), "mon,wed,sat…", "days"],
      [ib.lib.t("every week"), "", "week"],
      [ib.lib.t("every other week"), "", "2w"],
      [ib.lib.t("every month"), "", "month"],
    ];
    const k = await ib.ui.choose(ib.lib.t("Repeat “{task}”", { task: t.text }), kinds.map(([label, hint]) => ({ label, hint })));
    if (k === null) return;
    let rule = kinds[k][2];
    if (rule === "off") return void run(`todo repeat ${t.id} off`);
    let extra = "";
    if (rule === "day+times") {
      const n = await ib.ui.prompt(ib.lib.t("How many times a day?"), { initial: "3" });
      if (!n?.trim()) return;
      rule = "day";
      extra = ` --times ${Number(n) || 2}`;
    }
    if (rule === "days") {
      const d = await ib.ui.prompt(ib.lib.t("Which days?"), { placeholder: "mon,wed,sat" });
      if (!d?.trim()) return;
      rule = d.trim().replace(/\s+/g, "");
    }
    const spans: [string, string][] = [[ib.lib.t("forever"), "forever"], ["10×", "10"], ["100×", "100"], [ib.lib.t("for a year"), "1y"], [ib.lib.t("for a month"), "1m"], [ib.lib.t("a number of times…"), "ask"]];
    const c = await ib.ui.choose(ib.lib.t("For how long?"), spans.map(([label]) => ({ label })));
    if (c === null) return;
    let cycles = spans[c][1];
    if (cycles === "ask") {
      const n = await ib.ui.prompt(ib.lib.t("How many times?"), { initial: "30" });
      if (!n?.trim()) return;
      cycles = n.trim();
    }
    run(`todo repeat ${t.id} ${q(rule)}${extra}${cycles !== "forever" ? ` --cycles ${cycles}` : ""}`);
  }

  /** Done once: a plain task is done; a recurring one comes back (again today, or on its next date) until its cycles run out. */
  function complete(t: Task): "done" | "again" | "next" | "finished" {
    const now = new Date().toISOString();
    const r = t.repeat;
    if (!r) return (t.done = true), (t.doneAt = now), "done";
    r.total = (r.total ?? 0) + 1;
    const today = iso(new Date());
    if (r.times && r.times > 1) {
      if (r.todayDate !== today) (r.todayDate = today), (r.todayCount = 0);
      r.todayCount = (r.todayCount ?? 0) + 1;
      if (r.todayCount < r.times) return "again";
      r.todayCount = 0;
    }
    if (r.left !== null) {
      r.left -= 1;
      if (r.left <= 0) return (t.done = true), (t.doneAt = now), "finished";
    }
    const from = t.due && t.due > today ? t.due : today;
    const next = nextDate(r, from);
    if (r.until && next > r.until) return (t.done = true), (t.doneAt = now), "finished";
    t.due = next;
    return "next";
  }

  // ── what other modules can do with tasks (ib.modules.call("todo", …)) ──
  ib.modules.expose("list", { doc: "list() → every task { id, text, prio, due, tags, done }", fn: async () => (await ready, tasks.map((t) => ({ ...t }))) });
  ib.modules.expose("add", {
    doc: 'add(text, { due: "YYYY-MM-DD", prio: "urgent|high|moderate|low", tags: [] }) → the new task',
    fn: async (text: string, o: { due?: string; prio?: Prio; tags?: string[] } = {}) => {
      await ready;
      const t: Task = { id: nextId++, text: String(text), prio: o.prio && PRIOS.includes(o.prio) ? o.prio : "moderate", due: o.due ?? null, tags: o.tags ?? [], done: false, created: new Date().toISOString(), doneAt: null };
      tasks.push(t);
      void ib.stats.add("added", 1, { label: "tasks added", kind: "counter" }).catch(() => {});
      await save();
      return { ...t };
    },
  });
  ib.modules.expose("done", {
    doc: "done(id) → marks a task done (true if found)",
    fn: async (id: number) => {
      await ready;
      const t = tasks.find((x) => x.id === Number(id));
      if (!t || t.done) return false;
      complete(t);
      void ib.stats.add("done", 1, { label: "tasks done", kind: "counter" }).catch(() => {});
      await save();
      return true;
    },
  });

  const rank = (t: Task) => PRIOS.indexOf(t.prio);
  const sorted = (list: Task[]) =>
    [...list].sort((a, b) => Number(a.done) - Number(b.done) || rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.id - b.id);
  const isToday = (t: Task) => !!t.due && daysUntil(t.due) <= 0;
  const pick = (f: Filter) => sorted(tasks.filter((t) => (f === "done" ? t.done : f === "all" ? true : !t.done && (f === "open" || isToday(t)))));

  /** Short form for messages and the shell: "walk the dog (urgent, tomorrow)". */
  const describe = (t: Task) => {
    const bits = [t.prio !== "moderate" ? t.prio : "", t.due ? dueLabel(t.due) : "", t.repeat ? describeRepeat(t.repeat) : "", ...t.tags.map((g) => `+${g}`)].filter(Boolean);
    return `${t.text}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  };

  const prioMark = (p: Prio) => (p === "urgent" ? "!!!" : p === "high" ? "!! " : p === "moderate" ? "!  " : "·  ");
  const prioAnsi = (p: Prio, s: string) => (p === "urgent" ? fmt.red(s) : p === "high" ? fmt.yellow(s) : p === "moderate" ? fmt.cyan(s) : fmt.gray(s));

  function line(t: Task): string {
    const box = t.done ? fmt.green(ib.lib.BOX_ON) : ib.lib.BOX_OFF;
    const due = t.due ? (daysUntil(t.due) < 0 && !t.done ? fmt.red(dueLabel(t.due)) : daysUntil(t.due) === 0 ? fmt.yellow("today") : fmt.dim(dueLabel(t.due))) : "";
    const tags = t.tags.map((g) => fmt.magenta(`+${g}`)).join(" ");
    const text = t.done ? fmt.dim(t.text) : t.text;
    return `${fmt.dim(String(t.id).padStart(3))} ${box} ${prioAnsi(t.prio, prioMark(t.prio))} ${text}${tags ? ` ${tags}` : ""}${due ? `  ${due}` : ""}${t.repeat && !t.done ? `  ${fmt.cyan(describeRepeat(t.repeat))}` : ""}\n`;
  }

  function ids(ctx: ShellContext, args: string[]): Task[] | null {
    if (!args.length) return ctx.err("which one? give its number (todo shows them)\n"), null;
    const out: Task[] = [];
    for (const a of args) {
      const t = tasks.find((x) => x.id === Number(a.replace(/^#/, "")));
      if (!t) return ctx.err(`todo: no task ${a}\n`), null;
      out.push(t);
    }
    return out;
  }

  const SUBS = ["add", "done", "undo", "edit", "prio", "due", "rm", "restore", "ls", "clear", "open"];

  const command: Command = {
    name: "todo",
    examples: [
      ['todo add "pills" --every day --times 2 --cycles 30', "twice a day for 30 days"],
      ['todo add "gym" --every mon,wed,sat', "three days a week, forever"],
      ['todo add "plants" --every 2w --cycles 1y', "every other week for a year"],

      ["todo add \"promener le chien\" --urgent --due demain +maison", "urgent task, due tomorrow, tagged maison"],
      ["todo add \"rapport Q4\" --high --due fri +work", "high priority, due next Friday"],
      ["todo add \"appeler mamie\" --due +3d", "due in 3 days (moderate priority by default)"],
      ["todo", "what's left, most urgent first"],
      ["todo ls --today", "due today or late"],
      ["todo ls +work", "only tasks tagged work"],
      ["todo done 3 5", "tick tasks 3 and 5"],
      ["todo prio 3 low", "change a priority"],
      ["todo due 3 24/12", "set a due date (- removes it)"],
      ["todo edit 3 \"promener le chien et le chat\" --high", "new text and priority"],
      ["todo rm 3", "remove it\u2026"],
      ["todo restore", "\u2026and bring it back"],
      ["todo open --add", "the app, ready to type"],
    ],
    aliases: ["td"],
    summary: "your to-do list: priorities, due dates, tags (the TODO module)",
    usage: [
      "todo                          what's left to do",
      "todo add <text> [options]     (also: todo task add …)",
      "     --urgent --high --moderate --low      priority (default: moderate)",
      "     --due today|tomorrow|fri|+3d|2w|2026-12-01|24/12",
      "     +tag                     tags: +home +work",
      "     --every day|2d|week|2w|mon,wed,sat|month   it comes back when done",
      "     --times 3                several times a day",
      "     --cycles 10|100|1y|6m|forever             for how long (default: forever)",
      "todo repeat <n> <rule | off> [--times N] [--cycles …]   (r in the app)",
      "todo done <n…>    todo undo <n…>",
      "todo edit <n> [new text] [options]",
      "todo prio <n> urgent|high|moderate|low",
      "todo due <n> <date | ->",
      "todo rm <n…>      todo restore    (brings back what you just removed)",
      "todo ls [--all | --done | --today | --late] [+tag]",
      "todo clear        forget finished tasks",
      "todo open         the TODO app",
    ].join("\n"),
    man: "Tasks are stored by the TODO module in .icebreaker/plugin-data/todo.json, not in your notes.\nThe app and the HOME widget run these same commands: click around and watch the shell.",
    complete: () => SUBS,
    async run(ctx) {
      await ready;
      const args = [...ctx.args];
      if (args[0] === "task") args.shift();
      const sub = args.shift() ?? "ls";

      switch (sub) {
        case "add":
        case "a": {
          const p = parseTask(args);
          if (p.error) return ctx.err(`todo: ${p.error}\n`), 1;
          if (!p.text) return ctx.err('usage: todo add "what to do" [--urgent] [--due tomorrow] [+tag]\n'), 1;
          const t: Task = { id: nextId++, text: p.text, prio: p.prio ?? "moderate", due: p.due ?? null, tags: p.tags, done: false, created: new Date().toISOString(), doneAt: null };
          if (p.repeat || p.times) {
            const rule = p.repeat ?? { unit: "day" as const, n: 1 };
            t.repeat = { ...rule, times: p.times, left: p.cycles?.left ?? null, until: p.cycles?.until ?? null, anchor: iso(new Date()), total: 0 };
            t.due ??= firstDate(t.repeat);
          }
          tasks.push(t);
          void ib.stats.add("added", 1, { label: "tasks added", kind: "counter" }).catch(() => {});
          await save();
          ctx.out(`${fmt.green("+")} ${fmt.dim(`#${t.id}`)} ${describe(t)}\n`);
          return 0;
        }
        case "repeat":
        case "every": {
          // todo repeat <id> <rule | off> [--times N] [--cycles 10|1y|forever]
          const id = args.shift();
          const t = tasks.find((x) => x.id === Number(id));
          if (!t) return ctx.err(`todo: no task #${id ?? ""}\n`), 1;
          const ruleRaw = args.shift();
          if (!ruleRaw) return ctx.out(`${t.text}: ${t.repeat ? describeRepeat(t.repeat) : "doesn't repeat"}\n`), 0;
          if (ruleRaw === "off" || ruleRaw === "none") {
            delete t.repeat;
            await save();
            return ctx.out(`${t.text}: ${fmt.dim("doesn't repeat any more")}\n`), 0;
          }
          const p = parseTask(["x", "--every", ruleRaw, ...args]);
          if (p.error || !p.repeat) return ctx.err(`todo: ${p.error ?? "usage: todo repeat <id> day|2d|week|2w|mon,wed|month [--times 3] [--cycles 10|1y|forever]"}\n`), 1;
          t.repeat = { ...p.repeat, times: p.times, left: p.cycles?.left ?? null, until: p.cycles?.until ?? null, anchor: iso(new Date()), total: t.repeat?.total ?? 0 };
          t.done = false;
          t.due ??= firstDate(t.repeat);
          await save();
          ctx.out(`${fmt.cyan("↻")} ${t.text}  ${fmt.cyan(describeRepeat(t.repeat))}  ${fmt.dim(`next: ${t.due}`)}\n`);
          return 0;
        }
        case "done":
        case "undo": {
          const list = ids(ctx, args);
          if (!list) return 1;
          for (const t of list) {
            if (sub === "done" && t.repeat && !t.done) {
              const r = complete(t);
              ctx.out(`${fmt.green(ib.lib.BOX_ON)} ${t.text}${r === "again" ? fmt.dim(`  (${t.repeat.todayCount}/${t.repeat.times} today)`) : r === "next" ? fmt.dim(`  ↻ next: ${t.due}`) : fmt.dim("  ↻ the last one")}\n`);
              continue;
            }
            t.done = sub === "done";
            t.doneAt = t.done ? new Date().toISOString() : null;
            ctx.out(`${t.done ? fmt.green(ib.lib.BOX_ON) : ib.lib.BOX_OFF} ${t.text}\n`);
          }
          if (sub === "done") void ib.stats.add("done", list.length, { label: "tasks done", kind: "counter" }).catch(() => {});
          await save();
          const left = tasks.filter((t) => !t.done).length;
          if (sub === "done" && left === 0) ib.ui.notify("all done. go outside.", "success");
          return 0;
        }
        case "edit": {
          const [n, ...rest] = args;
          const list = ids(ctx, n ? [n] : []);
          if (!list) return 1;
          const t = list[0];
          const p = parseTask(rest);
          if (p.error) return ctx.err(`todo: ${p.error}\n`), 1;
          if (p.text) t.text = p.text;
          if (p.prio) t.prio = p.prio;
          if (p.due !== undefined) t.due = p.due;
          if (p.tags.length) t.tags = p.tags;
          await save();
          ctx.out(`${fmt.cyan("~")} ${fmt.dim(`#${t.id}`)} ${describe(t)}\n`);
          return 0;
        }
        case "prio": {
          const [n, v] = args;
          const list = ids(ctx, n ? [n] : []);
          if (!list) return 1;
          const p = PRIO_ALIAS[(v ?? "").toLowerCase()];
          if (!p) return ctx.err("usage: todo prio <n> urgent|high|moderate|low\n"), 1;
          list[0].prio = p;
          await save();
          ctx.out(`${prioAnsi(p, prioMark(p).trim())} ${list[0].text}\n`);
          return 0;
        }
        case "due": {
          const [n, ...v] = args;
          const list = ids(ctx, n ? [n] : []);
          if (!list) return 1;
          const d = parseDue(v.join(" ") || "-");
          if (d === undefined) return ctx.err(`todo: can't read the date "${v.join(" ")}" — today, tomorrow, fri, +3d, 2026-12-01, 24/12, or - to clear\n`), 1;
          list[0].due = d;
          await save();
          ctx.out(`${list[0].text}: ${d ? dueLabel(d) : "no due date"}\n`);
          return 0;
        }
        case "rm": {
          const list = ids(ctx, args);
          if (!list) return 1;
          tasks = tasks.filter((t) => !list.includes(t));
          trash.push(...list);
          await save();
          ctx.out(`${fmt.red("−")} ${list.map((t) => t.text).join(", ")} ${fmt.dim("(todo restore to undo)")}\n`);
          return 0;
        }
        case "restore": {
          const t = trash.pop();
          if (!t) return ctx.err("todo: nothing to restore\n"), 1;
          tasks.push(t);
          await save();
          ctx.out(`${fmt.green("+")} ${fmt.dim(`#${t.id}`)} ${describe(t)}\n`);
          return 0;
        }
        case "clear": {
          const done = tasks.filter((t) => t.done);
          tasks = tasks.filter((t) => !t.done);
          trash.push(...done);
          await save();
          ctx.out(`${done.length} finished task${done.length === 1 ? "" : "s"} cleared\n`);
          return 0;
        }
        case "open": {
          const app = ib.apps.open("todo") as TodoApp | null;
          if (app && args.includes("--add")) app.startTyping();
          return 0;
        }
        case "ls": {
          const f: Filter = args.includes("--all") || args.includes("-a") ? "all" : args.includes("--done") ? "done" : args.includes("--today") ? "today" : "open";
          const tag = args.find((a) => a.startsWith("+"))?.slice(1);
          let list = pick(f);
          if (args.includes("--late")) list = list.filter((t) => t.due && daysUntil(t.due) < 0);
          if (tag) list = list.filter((t) => t.tags.includes(tag));
          if (!list.length) return ctx.out(f === "open" ? "nothing to do. suspicious.\n" : "nothing here.\n"), 0;
          for (const t of list) ctx.out(line(t));
          return 0;
        }
        default:
          ctx.err(`todo: "${sub}"? try ${SUBS.map((s) => fmt.bold(s)).join(" · ")}  (todo add "${[sub, ...args].join(" ")}" to add it)\n`);
          return 1;
      }
    },
  };
  ib.commands.register(command);

  // ── the app ──

  const run = (line: string) => void ib.shell.run(line);

  class TodoApp implements App {
    readonly kind = "todo";
    readonly key = "todo";
    private filter: Filter = (FILTERS as string[]).includes(String(ib.settings.get("view"))) ? (ib.settings.get("view") as Filter) : "open";
    private sel = 0;
    private scroll = 0;
    private typing = false;
    /** "add a task": THE field (ib.lib.Field), same syntax as `todo add` */
    private readonly add = new ib.lib.Field({ icon: "+", onChange: () => (this.hint = ""), onSubmit: () => this.submit() });
    private get input(): string {
      return this.add.text;
    }
    private hint = "";

    title(): string {
      return "todo";
    }

    status(): string {
      return this.typing
        ? "type · --urgent --high --low · --due tomorrow · +tag · enter add · esc stop"
        : "a add · space done · 1-4 priority · d due · r repeat · e edit · x remove · tab filter · u restore";
    }

    startTyping(): void {
      this.typing = true;
    }

    private get list(): Task[] {
      return pick(this.filter);
    }

    private get current(): Task | undefined {
      return this.list[this.sel];
    }

    private submit(): void {
      const p = parseTask(tokenize(this.input));
      if (p.error) return void (this.hint = p.error);
      if (!p.text) return void (this.typing = false);
      // the clean, quoted command that does it — so the shell shows how to type it
      const flags = [p.prio && p.prio !== "moderate" ? `--${p.prio}` : "", p.due !== undefined && p.dueRaw ? `--due ${q(p.dueRaw)}` : "", p.repeatRaw ? `--every ${q(p.repeatRaw)}` : "", p.times ? `--times ${p.times}` : "", p.cyclesRaw ? `--cycles ${q(p.cyclesRaw)}` : "", ...p.tags.map((t) => `+${t}`)].filter(Boolean);
      run(`todo add ${q(p.text)}${flags.length ? ` ${flags.join(" ")}` : ""}`);
      this.add.clear();
      this.hint = "";
      if (this.filter === "done") this.filter = "open";
    }

    private async edit(t: Task): Promise<void> {
      const v = await ib.ui.prompt(`edit #${t.id}`, { initial: t.text });
      if (v?.trim() && v.trim() !== t.text) run(`todo edit ${t.id} ${q(v.trim())}`);
    }

    private async due(t: Task): Promise<void> {
      const v = await ib.ui.prompt(`due date for #${t.id}`, { initial: t.due ?? "", placeholder: "today, tomorrow, fri, +3d, 24/12 — or - to clear" });
      if (v !== null) run(`todo due ${t.id} ${q(v.trim() || "-")}`);
    }

    onText(t: string): boolean {
      if (this.typing) {
        if (t.includes("\n")) {
          const rest = t.replace(/[\r\n]+/g, " ").trimEnd();
          if (rest) this.add.onText(rest);
          this.submit();
          return true;
        }
        return this.add.onText(t);
      }
      const cur = this.current;
      switch (t) {
        case "a": case "n": case "+": case "i": this.startTyping(); return true;
        case " ": if (cur) run(`todo ${cur.done ? "undo" : "done"} ${cur.id}`); return true;
        case "1": case "2": case "3": case "4": if (cur) run(`todo prio ${cur.id} ${PRIOS[Number(t) - 1]}`); return true;
        case "d": if (cur) void this.due(cur); return true;
        case "r": if (cur) void repeatFlow(cur); return true;
        case "e": if (cur) void this.edit(cur); return true;
        case "x": if (cur) run(`todo rm ${cur.id}`); return true;
        case "u": run("todo restore"); return true;
        case "c": run("todo clear"); return true;
        default: return false; // h → HOME etc.
      }
    }

    onKey(k: KeyInput): boolean {
      if (this.typing) {
        switch (k.combo) {
          case "esc": this.typing = false; this.add.clear(); this.hint = ""; return true;
          case "down": case "tab": this.typing = false; return true;
          default: return this.add.onKey(k) || k.combo.length === 1; // letters arrive as text
        }
      }
      if (k.combo === "tab" || k.combo === "shift+tab") {
        const i = FILTERS.indexOf(this.filter);
        this.filter = FILTERS[(i + (k.shift ? FILTERS.length - 1 : 1)) % FILTERS.length];
        this.sel = 0;
        return true;
      }
      if ((k.combo === "delete" || k.combo === "ctrl+backspace") && this.current) return run(`todo rm ${this.current.id}`), true;
      return false;
    }

    onAction(a: Action): boolean {
      if (this.typing) return false;
      const n = this.list.length;
      switch (a) {
        case "up": if (this.sel === 0) this.startTyping(); else this.sel--; return true;
        case "down": this.sel = Math.min(n - 1, this.sel + 1); return true;
        case "confirm": if (this.current) run(`todo ${this.current.done ? "undo" : "done"} ${this.current.id}`); return true;
        case "home": this.sel = 0; return true;
        case "end": this.sel = Math.max(0, n - 1); return true;
        default: return false;
      }
    }

    render(ui: UI, r: Rect, focused: boolean): void {
      const c = ui.c;
      const g = ui.theme.glyphs;
      if (!loaded) return void ui.text(r.x + 1, r.y, `${ui.spinner()} loading…`, { fg: c.muted });
      const w = Math.min(r.w - 2, 110);
      const x0 = r.x + Math.max(1, Math.floor((r.w - w) / 2));
      let y = r.y + 1;

      // ── input line ──
      const inRect = { x: x0, y, w, h: 1 };
      this.add.render(ui, inRect, { focused: this.typing && focused, active: this.typing, bg: c.panelAlt, placeholder: this.typing ? "walk the dog --urgent --due tomorrow +home" : "add a task  (a)" });
      ui.hit(inRect, { onClick: () => this.startTyping(), tip: "type, enter adds · same syntax as `todo add`" });
      y++;
      if (this.hint) ui.text(x0 + 1, y, `⚠ ${this.hint}`, { fg: c.error }, w - 2);
      y += 2;

      // ── filters + counters ──
      let fx = x0;
      for (const f of FILTERS) {
        const label = ` ${f} ${pick(f).length} `;
        const on = f === this.filter;
        const rect = { x: fx, y, w: strWidth(label), h: 1 };
        ui.text(fx, y, label, on ? { fg: c.panel, bg: c.accent, attrs: BOLD } : { fg: ui.hovered(rect) ? c.accent : c.muted, bg: c.highlight });
        ui.hit(rect, { onClick: () => ((this.filter = f), (this.sel = 0)), tip: "tab cycles the filters" });
        fx += rect.w + 1;
      }
      const open = tasks.filter((t) => !t.done);
      const late = open.filter((t) => t.due && daysUntil(t.due) < 0).length;
      const urgent = open.filter((t) => t.prio === "urgent").length;
      const sum = [urgent ? `${urgent} urgent` : "", late ? `${late} late` : ""].filter(Boolean).join(" · ");
      if (sum) ui.textRight(x0 + w, y, sum, { fg: late ? c.error : c.warning });
      y += 2;

      // ── list, grouped by priority ──
      const list = this.list;
      this.sel = Math.max(0, Math.min(this.sel, list.length - 1));
      type Row = { head: Prio } | { task: Task; index: number };
      const rows: Row[] = [];
      list.forEach((t, index) => {
        const prev = list[index - 1];
        if (this.filter !== "done" && !t.done && (!prev || prev.prio !== t.prio || prev.done)) rows.push({ head: t.prio });
        rows.push({ task: t, index });
      });
      const viewH = r.y + r.h - y;
      const selRow = rows.findIndex((row) => "task" in row && row.index === this.sel);
      if (selRow - 1 < this.scroll) this.scroll = Math.max(0, selRow - 1);
      if (selRow >= this.scroll + viewH) this.scroll = selRow - viewH + 1;
      this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, rows.length - viewH)));

      if (!list.length) {
        const msg = this.filter === "done" ? "nothing finished yet" : this.filter === "today" ? "nothing due today" : "nothing to do. suspicious.  (a to add)";
        ui.text(x0 + 1, y, msg, { fg: c.muted });
      }
      const pc = (p: Prio) => (p === "urgent" ? c.error : p === "high" ? c.warning : p === "moderate" ? c.accent : c.subtle);
      rows.slice(this.scroll, this.scroll + viewH).forEach((row, k) => {
        const ry = y + k;
        if ("head" in row) {
          const label = ` ${row.head.toUpperCase()} `;
          ui.text(x0, ry, "──", { fg: c.faint });
          ui.text(x0 + 2, ry, label, { fg: pc(row.head), attrs: BOLD });
          ui.hline(x0 + 2 + label.length, ry, w - label.length - 2, { fg: c.faint });
          return;
        }
        const t = row.task;
        const rect = { x: x0, y: ry, w, h: 1 };
        const sel = row.index === this.sel && !this.typing;
        const hot = ui.hovered(rect);
        const rbg = sel ? (focused ? c.selection : c.highlight) : hot ? c.highlight : undefined;
        if (rbg !== undefined) ui.fill(rect, { bg: rbg });
        ui.hit(rect, { onClick: () => ((this.sel = row.index), (this.typing = false)), onDouble: () => void this.edit(t) });
        // checkbox → done / undo
        const box = t.done ? g.done : g.todo;
        const bw = strWidth(box);
        ui.text(x0 + 1, ry, box, { fg: t.done ? c.success : pc(t.prio), bg: rbg, attrs: BOLD });
        ui.hit({ x: x0 + 1, y: ry, w: bw, h: 1 }, { cmd: `todo ${t.done ? "undo" : "done"} ${t.id}`, tip: "space / enter" });
        let tx = x0 + 2 + bw;
        ui.text(tx, ry, String(t.id).padStart(3), { fg: c.faint, bg: rbg });
        tx += 4;
        // priority mark: click to cycle
        const mark = prioMark(t.prio);
        const next = PRIOS[(rank(t) + PRIOS.length - 1) % PRIOS.length];
        ui.text(tx, ry, mark, { fg: pc(t.prio), bg: rbg, attrs: BOLD });
        ui.hit({ x: tx, y: ry, w: 3, h: 1 }, { cmd: `todo prio ${t.id} ${next}`, tip: "1 urgent · 2 high · 3 moderate · 4 low" });
        tx += 4;
        // due + remove on the right
        const right = x0 + w - 1;
        let rx = right;
        if (hot || sel) {
          ui.text(right - 1, ry, "×", { fg: c.error, bg: rbg, attrs: BOLD });
          ui.hit({ x: right - 1, y: ry, w: 1, h: 1 }, { cmd: `todo rm ${t.id}`, tip: "x · todo restore brings it back" });
          rx = right - 3;
        }
        if (t.due) {
          const n = daysUntil(t.due);
          const label = dueLabel(t.due);
          const fg = t.done ? c.faint : n < 0 ? c.error : n === 0 ? c.warning : n === 1 ? c.accent : c.subtle;
          rx = ui.textRight(rx, ry, label, { fg, bg: rbg, attrs: n <= 0 && !t.done ? BOLD : 0 }) - 2;
          ui.hit({ x: rx + 2, y: ry, w: strWidth(label), h: 1 }, { onClick: () => void this.due(t), tip: "d · todo due <n> <date>" });
        }
        // text + tags
        const tags = t.tags.map((x) => `+${x}`).join(" ");
        const room = rx - tx - (tags ? strWidth(tags) + 1 : 0);
        const end = ui.text(tx, ry, t.text, { fg: t.done ? c.faint : sel ? c.fg : c.fg, bg: rbg, attrs: t.done ? STRIKE | DIM : 0 }, Math.max(1, room));
        if (tags && room > 4) ui.text(end + 1, ry, tags, { fg: c.accentAlt, bg: rbg }, rx - end - 1);
      });
      if (this.scroll + viewH < rows.length) ui.textRight(x0 + w, r.y + r.h - 1, ` ↓ ${rows.length - this.scroll - viewH} more `, { fg: c.panel, bg: c.accent });
    }
  }

  ib.apps.register({
    kind: "todo",
    title: "Todo",
    description: "to-do list: priorities, due dates, tags",
    icon: "☑",
    launcher: true,
    create: () => new TodoApp(),
  });

  ib.palette.register({ id: "todo.add", title: "Todo: add a task", group: "todo", run: () => run("todo open --add") });

  // ── the HOME widget (and its pop-up: quick add) ──
  /** the pop-up's "add a task": THE field */
  const quickField = new ib.lib.Field({ icon: "+" });
  let quickSel = 0;
  /** the task under the mouse in the HOME widget (Delete / ⌘⌫ removes it) */
  let hoverId: number | null = null;
  const isDelete = (k: KeyInput) => k.combo === "delete" || k.combo === "ctrl+backspace" || k.combo === "backspace";
  const editTask = async (t: Task) => {
    const v = await ib.ui.prompt(`edit #${t.id}`, { initial: t.text });
    if (v?.trim() && v.trim() !== t.text) run(`todo edit ${t.id} ${q(v.trim())}`);
  };
  const dueTask = async (t: Task) => {
    const v = await ib.ui.prompt(`due date for #${t.id}`, { initial: t.due ?? "", placeholder: "today, tomorrow, fri, +3d, 24/12 — or - to clear", suggestions: ["today", "tomorrow", "mon", "fri", "+3d", "+1w", "-"] });
    if (v !== null) run(`todo due ${t.id} ${q(v.trim() || "-")}`);
  };
  /** right-click on a task, in the widget and its pop-up */
  const taskMenu = (t: Task) => [
    { label: "Done ✓", cmd: `todo done ${t.id}`, hint: "click" },
    { label: "Edit…", run: () => void editTask(t), hint: "e" },
    { label: "Due date…", run: () => void dueTask(t), hint: "d" },
    { label: "Remove", cmd: `todo rm ${t.id}`, danger: true, hint: "del" },
  ];

  ib.widgets.register({
    id: "list",
    title: "todo",
    description: "what's left to do (TODO module)",
    size: { w: 4, h: 5 },
    min: { w: 2, h: 2 },
    onKey(k) {
      const t = tasks.find((x) => x.id === hoverId && !x.done);
      if (!t || !isDelete(k)) return false;
      run(`todo rm ${t.id}`);
      return true;
    },
    render(ui, r) {
      const c = ui.c;
      const g = ui.theme.glyphs;
      hoverId = null;
      if (!loaded) return void ui.text(r.x + 1, r.y, `${ui.spinner()} loading…`, { fg: c.muted });
      const open = pick("open");
      const urgent = open.filter((t) => t.prio === "urgent").length;
      const late = open.filter((t) => t.due && daysUntil(t.due) < 0).length;
      const add = " + add ";
      const ax = r.x + r.w - strWidth(add) - 1;
      const room = ax - r.x - 2;
      let hx = ui.text(r.x + 1, r.y, `${open.length} open`, { fg: open.length ? c.accent : c.success, attrs: BOLD }, room);
      const extra = [urgent ? `${urgent} urgent` : "", late ? `${late} late` : ""].filter(Boolean).join(" · ");
      if (extra && hx - r.x - 1 + 3 + strWidth(extra) <= room) hx = ui.text(hx, r.y, ` · ${extra}`, { fg: c.error });
      const addRect = { x: ax, y: r.y, w: strWidth(add), h: 1 };
      ui.text(ax, r.y, add, ui.hovered(addRect) ? { fg: c.panel, bg: c.accent, attrs: BOLD } : { fg: c.accent, bg: c.highlight });
      ui.hit(addRect, { cmd: "todo open --add", tip: 'or straight from the shell: todo add "…"' });
      if (!open.length) return void ui.text(r.x + 1, r.y + 1, "nothing to do. suspicious.", { fg: c.muted });
      const pc = (p: Prio) => (p === "urgent" ? c.error : p === "high" ? c.warning : p === "moderate" ? c.accent : c.subtle);
      const fits = open.length > r.h - 1 ? r.h - 2 : r.h - 1;
      open.slice(0, fits).forEach((t, i) => {
        const y = r.y + 1 + i;
        const row = { x: r.x, y, w: r.w, h: 1 };
        const hot = ui.hovered(row);
        if (hot) hoverId = t.id;
        const box = hot ? g.done : g.todo;
        ui.text(r.x + 1, y, box, { fg: pc(t.prio), attrs: BOLD });
        ui.hit(row, { cmd: `todo done ${t.id}`, tip: `${describe(t)}\nclick: done · del: remove · right-click: edit, due date`, menu: () => taskMenu(t) });
        const tx = r.x + 2 + strWidth(box);
        const due = t.due ? dueLabel(t.due) : "";
        const dueFg = t.due && daysUntil(t.due) < 0 ? c.error : t.due && daysUntil(t.due) === 0 ? c.warning : c.subtle;
        const dx = due ? ui.textRight(r.x + r.w - 1, y, due, { fg: dueFg }) : r.x + r.w;
        ui.text(tx, y, t.text, { fg: hot ? c.accent : c.fg, attrs: hot ? STRIKE : 0 }, Math.max(1, dx - tx - 1));
      });
      if (fits < open.length) ui.text(r.x + 1, r.y + r.h - 1, `+${open.length - fits} more · enter opens the list`, { fg: c.faint }, r.w - 2);
    },
    open: "todo open",
    popup: {
      title: "todo",
      size: { w: 64, h: 14 },
      hint: "type + enter: add · ↑↓ · space: done · del: remove · right-click: edit",
      render(ui, r) {
        const c = ui.c;
        const quick = quickField.text;
        quickField.render(ui, { x: r.x + 1, y: r.y, w: r.w - 2, h: 1 }, { focused: true, placeholder: "walk the dog --urgent --due tomorrow +home" });
        const open = pick("open");
        quickSel = Math.max(0, Math.min(quickSel, open.length - 1));
        open.slice(0, r.h - 2).forEach((t, i) => {
          const y = r.y + 2 + i;
          const row = { x: r.x, y, w: r.w, h: 1 };
          const sel = i === quickSel && !quick;
          if (sel) ui.fill(row, { bg: mix(c.accent, c.bg, 0.8) });
          const st = sel ? { bg: mix(c.accent, c.bg, 0.8) } : {};
          ui.text(r.x + 2, y, ui.theme.glyphs.todo, { fg: c.subtle, ...st });
          ui.text(r.x + 5, y, t.text, { fg: c.fg, attrs: sel ? BOLD : 0, ...st }, r.w - 20);
          if (t.due) ui.textRight(r.x + r.w - 2, y, dueLabel(t.due), { fg: daysUntil(t.due) < 0 ? c.error : c.subtle, ...st });
          ui.hit(row, { cmd: `todo done ${t.id}`, tip: "click: done · right-click: edit, due date, remove", menu: () => taskMenu(t) });
        });
        if (!open.length) ui.text(r.x + 2, r.y + 2, "nothing to do. suspicious.", { fg: c.muted });
      },
      onText: (t) => {
        if (t === " " && !quickField.text) {
          const cur = pick("open")[quickSel];
          if (cur) run(`todo done ${cur.id}`);
          return true;
        }
        return quickField.onText(t) || true;
      },
      onKey: (k) => {
        // nothing typed: Delete (⌘⌫) removes the chosen task
        if (!quickField.text && isDelete(k)) {
          const cur = pick("open")[quickSel];
          if (cur) run(`todo rm ${cur.id}`);
          return true;
        }
        if (k.combo === "enter" && quickField.text.trim()) {
          run(`todo add ${quickField.text.trim()}`); // same syntax as typing it in the shell
          quickField.clear();
          return true;
        }
        return quickField.onKey(k);
      },
      onAction: (a) => {
        if (a === "up") return (quickSel = Math.max(0, quickSel - 1)), true;
        if (a === "down") return (quickSel += 1), true;
        return false;
      },
    },
  });
}
