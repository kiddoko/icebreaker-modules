/**
 * CALENDAR — your agenda, as a module.
 *
 *   cal                         today and the next 7 days
 *   cal add "dentist" fri 14:30 --for 45m --cal work
 *   cal rm <ref> · cal next 5 · cal month · cal open fri
 *   cal calendars · cal default <name> · cal show|hide <name>
 *   cal google setup | connect | disconnect · cal sync
 *
 * Calendars: "local", plain Markdown in your vault (calendar/2026-11.md, one
 * line per event — edit it anywhere, it's yours, offline, no account) and,
 * once connected, your Google calendars (read + add + remove, through
 * src-tauri/src/google.rs). Google data is cached OUTSIDE the vault
 * (ib.google.cache, in the app config dir) so the AI and sync tools never see
 * it; it shows up offline and at start-up, then refreshes every 10 minutes.
 *
 * The app and the widget change nothing themselves: they run `cal …` commands.
 */
import type { App } from "../../src/apps/types";
import type { Rect } from "../../src/core/grid";
import type { Action, KeyInput } from "../../src/core/input";
import type { IcebreakerAPI } from "../../src/plugins/api";
import type { ShellContext } from "../../src/shell/types";
import type { UI } from "../../src/ui/ui";
import type * as Dates from "../../src/core/dates";
/** the deck's one date reader (ib.lib.dates), set when the module starts */
let D!: typeof Dates;

interface Cal {
  /** "local" or "g:<google calendar id>" */
  id: string;
  name: string;
  color: string;
  writable: boolean;
  primary?: boolean;
}

interface Ev {
  /** "l<n>" for local events, the Google event id otherwise */
  id: string;
  cal: string;
  title: string;
  /** all-day: YYYY-MM-DD (end exclusive) · timed: ISO date-time */
  start: string;
  end: string;
  allDay: boolean;
  where?: string;
}

const DAY = 86_400_000;
/** today, tomorrow, fri, +3d, 2w, 2026-12-01, 24/12 → a day (local midnight), or null — ib.lib.dates */
export const parseDay = (raw: string, from?: Date): Date | null => D.parseDay(raw, from);
/** "18:00", "9h", "7pm" → minutes after midnight, or null — ib.lib.dates */
export const parseTime = (raw: string): number | null => D.parseTime(raw);
const pad = (n: number) => D.pad2(n);
const ymd = (d: Date) => D.ymd(d);
const dayOf = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s);
const startOfDay = (d: Date) => D.startOfDay(d);
const addDays = (d: Date, n: number) => D.addDays(d, n);
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** ISO 8601 week number */
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
};


/** 45m, 1h, 1h30, 90 → minutes, or null. */
function parseDuration(raw: string): number | null {
  const m = /^(?:(\d+)h)?(\d+)?(m|min)?$/i.exec(raw.trim());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/** "in 25 min", "in 3 h", "now" */
function until(d: Date): string {
  const min = Math.round((d.getTime() - Date.now()) / 60_000);
  if (min <= 0) return "now";
  if (min < 60) return `in ${min} min`;
  if (min < 24 * 60) return `in ${Math.round(min / 60)} h`;
  return `in ${Math.round(min / 1440)} d`;
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

let sayTimer: ReturnType<typeof setInterval> | undefined;

export function activate(ib: IcebreakerAPI): void {
  D = ib.lib.dates;
  const { BOLD, hex, mix, strWidth, q, fmt, parseFlags, t } = ib.lib;
  const run = (line: string) => void ib.shell.run(line);
  // the first day of the week (Settings → ◇ CALENDAR): monday, or sunday
  const ws = () => (ib.settings.get<string>("weekStart") === "sunday" ? 0 : 1);
  /** a day's column in the week, 0 = the first day */
  const dow = (d: Date) => (d.getDay() - ws() + 7) % 7;
  /** a date that falls on column i (for the weekday names) */
  const colDay = (i: number) => new Date(2024, 0, ws() + i);
  /** column i is a saturday or a sunday */
  const wkd = (i: number) => [0, 6].includes((i + ws()) % 7);
  /** `cal settings`: the app opens on its settings */
  let openSettings = false;

  // ── store ────────────────────────────────────────────────────────────────
  const LOCAL: Cal = { id: "local", name: "local", color: "", writable: true };
  /** "local": everything in the vault, Google hidden · "google" · "ask": not chosen yet */
  let mode: "local" | "google" | "ask" = "ask";
  let local: Ev[] = [];
  let nextLocal = 1;
  let google: { calendars: Cal[]; events: Ev[]; at: number } = { calendars: [], events: [], at: 0 };
  let hidden: string[] = [];
  let defaultCal = "local";
  /** the user picked a default (else the primary Google calendar becomes it) */
  let defaultChosen = false;
  let connected = false;
  let syncing = false;
  let syncError: string | null = null;
  let loaded = false;

  // ── the local calendar: Markdown files in the vault ─────────────────────
  //   - 2026-11-19 14:30-15:15 Dentist @ Cabinet Dupont ^l12
  //   - 2026-11-24..2026-11-26 Trip ^l13          (all day, end included)
  const DIR = "calendar";
  const FILE = /^calendar\/(\d{4})-(\d{2})\.md$/;
  const LINE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?\s+(?:(\d{1,2}[:h]\d{2}|\d{1,2}h)(?:-(\d{1,2}[:h]\d{2}|\d{1,2}h))?\s+)?(.*?)(?:\s+\^(l\d+))?\s*$/;
  /** the lines of each month file that aren't events (title, your notes): kept as they are */
  const extra = new Map<string, string[]>();
  let localAt = 0;
  const toLine = (e: Ev) => {
    const s = dayOf(e.start);
    let when: string;
    if (e.allDay) {
      const last = addDays(dayOf(e.end), -1);
      when = ymd(last) > ymd(s) ? `${ymd(s)}..${ymd(last)}` : ymd(s);
    } else when = `${ymd(s)} ${hm(s)}-${hm(dayOf(e.end))}`;
    return `- ${when} ${e.title}${e.where ? ` @ ${e.where}` : ""} ^${e.id}`;
  };
  async function loadLocal(): Promise<void> {
    localAt = Date.now();
    const out: Ev[] = [];
    const missing: Ev[] = [];
    extra.clear();
    for (const path of ib.vault.notes().filter((p) => FILE.test(p))) {
      const text = await ib.vault.read(path).catch(() => "");
      const keep: string[] = [];
      for (const raw of text.split("\n")) {
        const m = LINE.exec(raw);
        if (!m) {
          keep.push(raw);
          continue;
        }
        const [, d1, d2, t1, t2, rest, id] = m;
        const at = rest.lastIndexOf(" @ ");
        const title = (at >= 0 ? rest.slice(0, at) : rest).trim() || "(no title)";
        const where = at >= 0 ? rest.slice(at + 3).trim() : undefined;
        const day = dayOf(d1);
        let e: Ev;
        if (t1) {
          const [h1, m1 = 0] = t1.split(/[:h]/).map((x) => Number(x || 0));
          const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h1, m1);
          let end = new Date(start.getTime() + 3600_000);
          if (t2) {
            const [h2, m2 = 0] = t2.split(/[:h]/).map((x) => Number(x || 0));
            end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h2, m2);
            if (end <= start) end = addDays(end, 1);
          }
          e = { id: id ?? "", cal: "local", title, start: start.toISOString(), end: end.toISOString(), allDay: false, where };
        } else e = { id: id ?? "", cal: "local", title, start: d1, end: ymd(addDays(dayOf(d2 ?? d1), 1)), allDay: true, where };
        if (!id) missing.push(e);
        out.push(e);
      }
      while (keep.length && !keep[keep.length - 1].trim()) keep.pop();
      extra.set(path, keep);
    }
    nextLocal = out.reduce((n, e) => Math.max(n, Number(e.id.slice(1)) + 1 || n), 1);
    for (const e of missing) e.id = `l${nextLocal++}`; // written with their ^id next time that month is saved
    local = out;
  }
  /** Rewrite the month files of these events (only those). */
  async function writeMonths(evs: Ev[]): Promise<void> {
    const months = new Set(evs.map((e) => ymd(dayOf(e.start)).slice(0, 7)));
    await ib.vault.mkdir(DIR).catch(() => {});
    for (const ym of months) {
      const path = `${DIR}/${ym}.md`;
      const head = extra.get(path) ?? [`# ${dayOf(`${ym}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`, "", "<!-- ICEBREAKER calendar: one event per line. `cal -h` for the syntax. -->"];
      const lines = local
        .filter((e) => ymd(dayOf(e.start)).slice(0, 7) === ym)
        .sort((a, b) => dayOf(a.start).getTime() - dayOf(b.start).getTime())
        .map(toLine);
      await ib.vault.write(path, `${head.join("\n")}\n\n${lines.join("\n")}\n`);
      extra.set(path, head);
    }
    localAt = Date.now();
  }
  /** Pick up edits made outside (Obsidian, an editor, sync), at most every few seconds. */
  const refreshLocal = () => {
    if (Date.now() - localAt > 5000) {
      localAt = Date.now();
      void loadLocal().then(() => ib.ui.redraw());
    }
  };

  const ready = (async () => {
    mode = await ib.storage.get<"local" | "google" | "ask">("mode", "ask");
    await loadLocal();
    // events from older versions (plugin-data) move into the vault files
    const old = await ib.storage.get<Ev[]>("local", []);
    if (old.length) {
      for (const e of old) local.push({ ...e, id: `l${nextLocal++}` });
      await writeMonths(old);
      await ib.storage.set("local", []);
    }
    // calendar names, ids (your e-mail), events: Google data, kept out of the vault
    if (ib.google.available()) {
      const g = await ib.google.cache.read<{ google?: typeof google; hidden?: string[]; defaultCal?: string; defaultChosen?: boolean }>({ google, hidden, defaultCal });
      google = g.google ?? google;
      hidden = g.hidden ?? [];
      defaultCal = g.defaultCal ?? "local";
      defaultChosen = !!g.defaultChosen;
    }
    loaded = true;
    ib.ui.redraw();
    if (ib.google.available()) {
      connected = (await ib.google.status().catch(() => ({ connected: false }))).connected;
      if (connected) void sync();
    }
  })();
  const save = async () => {
    if (ib.google.available()) await ib.google.cache.write({ google, hidden, defaultCal, defaultChosen });
    ib.ui.redraw();
  };

  const calendars = (): Cal[] => [LOCAL, ...google.calendars];
  const calOf = (id: string) => calendars().find((c) => c.id === id);
  const colorOf = (ui: UI, id: string) => {
    const c = calOf(id)?.color;
    return c ? hex(c) : ui.c.accent;
  };
  const findCal = (name: string): Cal | undefined => {
    const n = name.toLowerCase();
    const all = calendars();
    return all.find((c) => c.name.toLowerCase() === n || c.id.toLowerCase() === n) ?? all.find((c) => c.name.toLowerCase().includes(n));
  };
  const visible = () => [...local, ...google.events].filter((e) => !hidden.includes(e.cal) && calOf(e.cal));
  /** Events that touch [from, to), sorted. */
  /** by day, then all-day events first, then by time */
  const byStart = (a: Ev, b: Ev) =>
    ymd(dayOf(a.start)).localeCompare(ymd(dayOf(b.start))) || Number(b.allDay) - Number(a.allDay) || dayOf(a.start).getTime() - dayOf(b.start).getTime();
  const between = (from: Date, to: Date) => visible().filter((e) => dayOf(e.start) < to && dayOf(e.end) > from).sort(byStart);
  /** events starting on or after `from`, for `days` days */
  const upcomingAfter = (from: Date, days: number) => visible().filter((e) => dayOf(e.start) >= from && dayOf(e.start) < addDays(from, days)).sort(byStart);
  // ── for other modules (ib.modules.call("calendar", …)) ──
  ib.modules.expose("events", {
    doc: "events(fromISO, toISO) → [{ id, cal, title, start, end, allDay, where }]",
    fn: (from: string, to: string) => (refreshLocal(), between(new Date(from), new Date(to)).map((e) => ({ ...e }))),
  });
  ib.modules.expose("today", { doc: "today() → today's events", fn: () => (refreshLocal(), between(dayOf(ymd(new Date())), addDays(dayOf(ymd(new Date())), 1)).map((e) => ({ ...e }))) });
  ib.modules.expose("add", { doc: 'add("dentist fri 14:30 --cal work") → same words as `cal add`', fn: (words: string) => ib.shell.run(`cal add ${words}`) });
  const recordUpcoming = () => void ib.stats.set("week", upcomingAfter(dayOf(ymd(new Date())), 7).length, { label: "events this week" }).catch(() => {});
  setTimeout(recordUpcoming, 3000);
  const upcoming = (n: number) =>
    visible()
      .filter((e) => dayOf(e.end).getTime() > Date.now())
      .sort((a, b) => dayOf(a.start).getTime() - dayOf(b.start).getTime())
      .slice(0, n);

  /** A short, stable handle for commands: l12 for local, 5 letters for Google. */
  const ref = (e: Ev) => {
    if (e.cal === "local") return e.id;
    let h = 0;
    for (const ch of e.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h.toString(36).slice(-5).padStart(5, "0");
  };
  const byRef = (r: string) => visible().find((e) => ref(e) === r.toLowerCase()) ?? [...local, ...google.events].find((e) => ref(e) === r.toLowerCase());

  // ── Google ───────────────────────────────────────────────────────────────
  const gid = (c: string) => encodeURIComponent(c.slice(2));
  const fromGoogle = (cal: string, it: any): Ev | null => {
    if (!it?.start || it.status === "cancelled") return null;
    const allDay = !!it.start.date;
    return { id: it.id, cal, title: it.summary || "(no title)", start: it.start.date ?? it.start.dateTime, end: it.end?.date ?? it.end?.dateTime ?? it.start.dateTime, allDay, where: it.location || undefined };
  };

  async function sync(): Promise<void> {
    if (syncing || !connected) return;
    syncing = true;
    ib.ui.redraw();
    try {
      const list = await ib.google.calendar<{ items: any[] }>("GET", "users/me/calendarList", { query: { minAccessRole: "reader" } });
      const cals: Cal[] = (list.items ?? []).map((c) => ({
        id: `g:${c.id}`,
        name: c.summaryOverride || (c.primary && (!c.summary || c.summary === c.id) ? "google" : c.summary) || c.id,
        color: c.backgroundColor || "",
        writable: c.accessRole === "owner" || c.accessRole === "writer",
        primary: !!c.primary,
      }));
      const from = addDays(startOfDay(new Date()), -31).toISOString();
      const to = addDays(startOfDay(new Date()), 186).toISOString();
      const events: Ev[] = [];
      for (const c of cals) {
        let page: string | undefined;
        do {
          const r = await ib.google.calendar<{ items: any[]; nextPageToken?: string }>("GET", `calendars/${gid(c.id)}/events`, {
            query: { timeMin: from, timeMax: to, singleEvents: true, orderBy: "startTime", maxResults: 2500, pageToken: page },
          });
          for (const it of r.items ?? []) {
            const e = fromGoogle(c.id, it);
            if (e) events.push(e);
          }
          page = r.nextPageToken;
        } while (page);
      }
      google = { calendars: cals, events, at: Date.now() };
      if (defaultCal === "local" && !defaultChosen) {
        const primary = cals.find((c) => c.primary);
        if (primary) defaultCal = primary.id;
      }
      syncError = null;
      await save();
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e);
    } finally {
      syncing = false;
      ib.ui.redraw();
    }
  }
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => void sync(), 10 * 60_000);

  // ── output helpers ───────────────────────────────────────────────────────
  const ansiColor = (id: string, s: string) => {
    const c = calOf(id)?.color;
    if (!c) return fmt.magenta(s);
    const n = parseInt(c.slice(1), 16);
    return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}\x1b[39m`;
  };
  const when = (e: Ev) => (e.allDay ? t("all day") : `${hm(dayOf(e.start))}–${hm(dayOf(e.end))}`);
  const dayTitle = (d: Date) => {
    const n = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / DAY);
    const label = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    return n === 0 ? `${t("today")} · ${label}` : n === 1 ? `${t("tomorrow")} · ${label}` : label;
  };
  const printDays = (ctx: ShellContext, from: Date, days: number, emptyToo: boolean) => {
    let any = false;
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const evs = between(d, addDays(d, 1));
      if (!evs.length && !emptyToo) continue;
      any = true;
      ctx.out(`${fmt.bold(dayTitle(d))}\n`);
      if (!evs.length) ctx.out(fmt.dim("  nothing\n"));
      for (const e of evs) ctx.out(`  ${ansiColor(e.cal, "●")} ${fmt.dim(when(e).padEnd(11))} ${e.title}${e.where ? fmt.dim(` · ${e.where}`) : ""} ${fmt.dim(`[${ref(e)}]`)}\n`);
    }
    if (!any) ctx.out(fmt.dim("nothing planned\n"));
  };
  const status = () => (mode === "local" && !connected ? t("calendar in your vault ({dir}/)", { dir: DIR }) : connected ? (syncing ? t("google: syncing…") : syncError ? `google: ${syncError}` : google.at ? t("google: synced {time}", { time: new Date(google.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) }) : t("google: connected")) : t("google: not connected (cal google connect)"));

  // ── add / remove ─────────────────────────────────────────────────────────
  async function addEvent(cal: Cal, title: string, start: Date, allDay: boolean, minutes: number, where?: string): Promise<Ev> {
    const end = allDay ? addDays(start, Math.max(1, Math.round(minutes / 1440))) : new Date(start.getTime() + minutes * 60_000);
    if (cal.id === "local") {
      const e: Ev = { id: `l${nextLocal++}`, cal: "local", title, start: allDay ? ymd(start) : start.toISOString(), end: allDay ? ymd(end) : end.toISOString(), allDay, where };
      local.push(e);
      await writeMonths([e]);
      ib.ui.redraw();
      return e;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const body = {
      summary: title,
      location: where,
      start: allDay ? { date: ymd(start) } : { dateTime: start.toISOString(), timeZone: tz },
      end: allDay ? { date: ymd(end) } : { dateTime: end.toISOString(), timeZone: tz },
    };
    const it = await ib.google.calendar("POST", `calendars/${gid(cal.id)}/events`, { body });
    const e = fromGoogle(cal.id, it)!;
    google.events.push(e);
    await save();
    return e;
  }

  async function removeEvent(e: Ev): Promise<void> {
    if (e.cal === "local") {
      local = local.filter((x) => x !== e);
      await writeMonths([e]);
    } else {
      await ib.google.calendar("DELETE", `calendars/${gid(e.cal)}/events/${encodeURIComponent(e.id)}`);
      google.events = google.events.filter((x) => x !== e);
    }
    await save();
  }

  // ── the `cal` command ────────────────────────────────────────────────────
  // ── 30 minutes before a timed event: the voice says it (Settings → VOICE → calendar)
  const announced = new Set<string>();
  if (sayTimer) clearInterval(sayTimer); // the module switched off and on again: one timer only
  sayTimer = setInterval(() => {
    const now = Date.now();
    for (const e of visible()) {
      if (e.allDay) continue;
      const mins = (dayOf(e.start).getTime() - now) / 60_000;
      const key = `${e.cal}:${e.id}:${e.start}`;
      if (mins > 0 && mins <= 30 && !announced.has(key)) {
        announced.add(key);
        ib.ui.say(t("in {n} minutes: {title}", { n: Math.max(1, Math.round(mins)), title: e.title }), "calendar");
      }
    }
  }, 60_000);

  // ── Settings → ◇ CALENDAR (each row is also a command) ─────────────────────
  ib.settings.register([
    { key: "weekStart", label: "first day of the week", type: "choice", options: ["monday", "sunday"], default: "monday", help: "Where the week starts in the month grid, the week view and `cal month`." },
    {
      key: "where",
      label: "where your calendar lives",
      type: "action",
      value: () => (connected ? t("vault + Google") : t("vault only")),
      cmd: "cal settings",
      help: "Your events are plain Markdown in calendar/ inside the vault (offline, no account). Google Calendar is optional: it signs in in your browser, the token stays in the app's config folder, never in the vault.",
    },
    ...(ib.google.available()
      ? [
          {
            key: "google",
            label: "Google account",
            type: "action" as const,
            value: () => (connected ? t("connected") : t("not connected")),
            cmd: () => (connected ? "cal google disconnect" : "cal google connect"),
            run: async () => {
              if (connected && !(await ib.ui.confirm(t("Disconnect Google Calendar?"), t("Its cached events leave the deck; your vault calendar stays.")))) return;
              run(connected ? "cal google disconnect" : "cal google connect");
            },
            help: "Connect: your browser opens Google's consent page, you allow, done (Mac, Windows, Linux alike). On Windows, if the firewall asks about ICEBREAKER, allow it: Google sends you back to the app on 127.0.0.1. A build without ICEBREAKER's Google client needs your own: see the next rows and docs/GOOGLE.md.",
          },
          { key: "sync", label: "sync with Google now", type: "action" as const, value: () => (syncing ? t("syncing…") : google.at ? new Date(google.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"), cmd: "cal sync", help: "Fetch your Google calendars now (it also syncs by itself every few minutes while connected)." },
          { key: "googleClient", label: "your own Google client (advanced)", type: "action" as const, cmd: "cal google setup", help: "Use your own OAuth client from console.cloud.google.com (Desktop app type) instead of ICEBREAKER's: needed on builds without one. `cal google setup --default` goes back." },
        ]
      : []),
    {
      key: "defaultCal",
      label: "new events go to",
      type: "action",
      value: () => calOf(defaultCal)?.name ?? "local",
      cmd: () => `cal default ${q(calOf(defaultCal)?.name ?? "local")}`,
      run: async () => {
        const all = calendars().filter((c) => c.writable);
        const i = await ib.ui.choose(t("New events go to"), all.map((c) => ({ label: c.name, hint: c.id === "local" ? "vault" : "google", color: c.color || undefined })), { selected: Math.max(0, all.findIndex((c) => c.id === defaultCal)) });
        if (i !== null) run(`cal default ${q(all[i].name)}`);
      },
      help: "Where `cal add` and the + button put a new event: the vault, or one of your Google calendars.",
    },
    { key: "more", label: "calendars shown, colours, files…", type: "action", cmd: "cal settings", help: "The CALENDAR app's own settings page (show / hide each calendar, the default one, Google)." },
  ]);

  ib.commands.register({
    name: "cal",
    aliases: ["calendar", "agenda"],
    summary: "your agenda: local + Google calendars (CALENDAR module)",
    usage: [
      "cal                      today and the next 7 days",
      "cal today | tomorrow | week | <day>",
      "cal next [n]             the next n events",
      "cal month [day]          this month as a grid",
      'cal add "title" <day> [14:30[-16:00]] [--for 1h] [--cal name] [--where place]',
      "cal rm <ref>             remove an event ([ref] is shown next to it)",
      "cal open [day]           the CALENDAR app",
      "cal settings             its settings: calendars, Google, local files",
      "cal calendars            your calendars",
      "cal default <name>       where `cal add` puts things",
      "cal show | hide <name>   show or hide a calendar",
      "cal sync                 fetch Google now",
      "cal mode local | google  stay 100% local, or use Google too",
      "cal google connect | disconnect | status · cal google setup [--default]",
    ].join("\n"),
    examples: [
      ["cal", "the week ahead"],
      ['cal add "dentist" fri 14:30 --for 45m', "on your default calendar"],
      ['cal add "trip" 24/12 --for 3d --cal family', "an all-day event on 3 days"],
      ['cal add "standup" tomorrow 9:30-9:45 --cal work', "a time range"],
      ["cal next 3", "what's coming"],
      ["cal google connect", "sign in to Google in your browser"],
    ],
    man: [
      "Days: today, tomorrow, mon…sun (lun…dim), +3d, 2w, 2026-12-01, 24/12.",
      "Times: 14:30, 14h30, 14h, 2pm. No time = all day. Default length: 1 h.",
      "",
      "LOCAL — the \"local\" calendar is plain Markdown in your vault, one file per month",
      "(calendar/2026-11.md), one event per line; edit it anywhere, it's picked up:",
      "  - 2026-11-19 14:30-15:15 Dentist @ Cabinet Dupont ^l12",
      "  - 2026-11-24..2026-11-26 Trip ^l13",
      "No account, no network, no AI needed. cal mode local hides Google entirely.",
      "",
      "GOOGLE — cal google connect: your browser opens Google's consent page, you allow, done.",
      "The token stays in the app's config folder, never in your vault; cal google disconnect revokes it.",
      "",
      "Your own OAuth client instead of ICEBREAKER's (or a build without one):",
      "  1. console.cloud.google.com → new project → enable \"Google Calendar API\"",
      "  2. Google Auth Platform → Audience: External, publish the app",
      "  3. Clients → Create client → Desktop app",
      "  4. cal google setup   (paste the client ID and secret) · cal google setup --default goes back",
      "  5. cal google connect",
    ].join("\n"),
    complete: () => ["today", "tomorrow", "week", "next", "month", "add", "rm", "open", "settings", "calendars", t("default"), "show", "hide", "sync", "google"],
    async run(ctx) {
      await ready;
      await loadLocal(); // pick up edits made outside
      const [sub, ...rest] = ctx.args;
      const today = startOfDay(new Date());
      try {
        switch (sub) {
          case undefined:
            printDays(ctx, today, 8, false);
            if (connected || syncError) ctx.out(fmt.dim(`${status()}\n`));
            else if (mode === "ask") ctx.out(fmt.dim("your calendar lives in the vault (calendar/) · Google too? cal google connect · or stay local: cal mode local\n"));
            return 0;
          case "today": printDays(ctx, today, 1, true); return 0;
          case "tomorrow": printDays(ctx, addDays(today, 1), 1, true); return 0;
          case "week": printDays(ctx, today, 7, true); return 0;
          case "next": {
            const evs = upcoming(Number(rest[0]) || 5);
            if (!evs.length) return ctx.out(fmt.dim("nothing coming up\n")), 0;
            for (const e of evs) {
              const s = dayOf(e.start);
              ctx.out(`${ansiColor(e.cal, "●")} ${fmt.dim(s.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).padEnd(14))} ${fmt.dim(e.allDay ? "all day" : hm(s))}  ${e.title} ${fmt.dim(`· ${until(s)} [${ref(e)}]`)}\n`);
            }
            return 0;
          }
          case "month": {
            const d = rest[0] ? parseDay(rest[0]) : today;
            if (!d) return ctx.err(`cal: can't read the day "${rest[0]}"\n`), 1;
            const first = new Date(d.getFullYear(), d.getMonth(), 1);
            ctx.out(`${fmt.bold(first.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}\n`);
            ctx.out(fmt.dim(ws() ? " mo  tu  we  th  fr  sa  su\n" : " su  mo  tu  we  th  fr  sa\n"));
            let line = "    ".repeat(dow(first));
            for (let day = first; day.getMonth() === first.getMonth(); day = addDays(day, 1)) {
              const n = between(day, addDays(day, 1)).length;
              const num = String(day.getDate()).padStart(3);
              const cell = ymd(day) === ymd(today) ? fmt.bold(fmt.magenta(num)) : n ? fmt.cyan(num) : fmt.dim(num);
              line += cell + (n ? fmt.yellow("•") : " ");
              if (dow(day) === 6) {
                ctx.out(line + "\n");
                line = "";
              }
            }
            if (line) ctx.out(line + "\n");
            return 0;
          }
          case "settings": case "setup": {
            openSettings = true;
            ib.apps.open("calendar");
            return 0;
          }
          case "open": {
            const d = rest[0] ? parseDay(rest[0]) : null;
            if (rest[0] && !d) return ctx.err(`cal: can't read the day "${rest[0]}"\n`), 1;
            const app = ib.apps.open("calendar") as CalendarApp | null;
            if (d && app) app.goto(d);
            return 0;
          }
          case "add": return await add(ctx, rest);
          case "rm": case "remove": case "del": {
            const e = rest[0] && byRef(rest[0]);
            if (!e) return ctx.err(`cal: no event "${rest[0] ?? ""}" (the [ref] next to it in \`cal\`)\n`), 1;
            const c = calOf(e.cal);
            if (c && !c.writable) return ctx.err(`cal: "${c.name}" is read-only\n`), 1;
            await removeEvent(e);
            ctx.out(`${fmt.red("✕")} ${e.title} ${fmt.dim(`(${c?.name ?? e.cal})`)}\n`);
            return 0;
          }
          case "calendars": case "cals": case "list": {
            for (const c of calendars()) {
              const flags = [c.id === defaultCal ? fmt.green("default") : "", hidden.includes(c.id) ? fmt.dim("hidden") : "", c.writable ? "" : fmt.dim("read-only")].filter(Boolean).join(" ");
              ctx.out(`${ansiColor(c.id, "●")} ${c.name} ${flags}\n`);
            }
            ctx.out(fmt.dim(`${status()}\n`));
            return 0;
          }
          case "default": {
            if (!rest.length) return ctx.out(`${calOf(defaultCal)?.name ?? "local"}\n`), 0;
            const c = findCal(rest.join(" "));
            if (!c) return ctx.err(`cal: no calendar "${rest.join(" ")}" (see cal calendars)\n`), 1;
            if (!c.writable) return ctx.err(`cal: "${c.name}" is read-only\n`), 1;
            defaultCal = c.id;
            defaultChosen = true;
            await save();
            ctx.out(`new events go to ${ansiColor(c.id, "●")} ${c.name}\n`);
            return 0;
          }
          case "show": case "hide": {
            const c = findCal(rest.join(" "));
            if (!c) return ctx.err(`cal: no calendar "${rest.join(" ")}"\n`), 1;
            hidden = hidden.filter((h) => h !== c.id);
            if (sub === "hide") hidden.push(c.id);
            await save();
            ctx.out(`${c.name}: ${sub === "hide" ? "hidden" : "shown"}\n`);
            return 0;
          }
          case "sync": {
            if (!connected) return ctx.err("cal: Google isn't connected (cal google connect)\n"), 1;
            await sync();
            if (syncError) return ctx.err(`cal: ${syncError}\n`), 1;
            ctx.out(`${fmt.green("✓")} ${google.calendars.length} calendars, ${google.events.length} events\n`);
            return 0;
          }
          case "google": return await googleCmd(ctx, rest[0]);
          case "mode": {
            const m = rest[0];
            if (!m) return ctx.out(`${mode === "ask" ? "not chosen yet (local works; Google: cal google connect)" : mode}\n`), 0;
            if (m !== "local" && m !== "google") return ctx.err("cal mode local | google\n"), 1;
            if (m === "local" && connected) {
              if (!(await ib.ui.confirm("Stay local only?", "This disconnects Google and deletes its cached events from this computer.\nYour local calendar (calendar/ in the vault) is untouched."))) return ctx.err("cal: cancelled\n"), 1;
              await googleCmd(ctx, "disconnect");
            }
            mode = m;
            await ib.storage.set("mode", mode);
            ib.ui.redraw();
            if (m === "google") return await googleCmd(ctx, "connect");
            ctx.out(`${fmt.green("✓")} local only: your calendar is in ${DIR}/ (plain Markdown), nothing leaves this computer\n`);
            return 0;
          }
          default: {
            // `cal fri`, `cal 24/12`: that day
            const d = parseDay(sub);
            if (d) return printDays(ctx, d, 1, true), 0;
            ctx.err(`cal: "${sub}"? try cal -h\n`);
            return 1;
          }
        }
      } catch (e) {
        ctx.err(`cal: ${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      }
    },
  });

  async function add(ctx: ShellContext, args: string[]): Promise<number> {
    const { flags, rest } = parseFlags(args, ["for", "cal", "c", "where", "to"]);
    let day: Date | null = null;
    let from: number | null = null;
    let to: number | null = null;
    const words: string[] = [];
    for (const w of rest) {
      const range = /^(.+?)-(.+)$/.exec(w);
      if (from === null && range && parseTime(range[1]) !== null && parseTime(range[2]) !== null) {
        from = parseTime(range[1]);
        to = parseTime(range[2]);
      } else if (from === null && parseTime(w) !== null) from = parseTime(w);
      else if (!day && parseDay(w)) day = parseDay(w);
      else words.push(w);
    }
    const title = words.join(" ").trim();
    if (!title) return ctx.err('cal: what is it? cal add "title" <day> [time]\n'), 1;
    if (!day) day = startOfDay(new Date());
    if (typeof flags.to === "string") to = parseTime(flags.to);
    const name = (flags.cal ?? flags.c) as string | true | undefined;
    const cal = typeof name === "string" ? findCal(name) : calOf(defaultCal) ?? LOCAL;
    if (!cal) return ctx.err(`cal: no calendar "${name}" (see cal calendars)\n`), 1;
    if (!cal.writable) return ctx.err(`cal: "${cal.name}" is read-only\n`), 1;
    let minutes = from === null ? 1440 : 60;
    if (typeof flags.for === "string") {
      const m = /^(\d+)(d|j)$/i.exec(flags.for);
      const d = m ? Number(m[1]) * 1440 : parseDuration(flags.for);
      if (d === null) return ctx.err(`cal: can't read the length "${flags.for}" (45m, 1h30, 2d)\n`), 1;
      minutes = d;
    } else if (from !== null && to !== null) minutes = (to - from + 1440) % 1440 || 60;
    const start = from === null ? day : new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(from / 60), from % 60);
    const e = await addEvent(cal, title, start, from === null, minutes, typeof flags.where === "string" ? flags.where : undefined);
    ctx.out(`${fmt.green("+")} ${ansiColor(cal.id, "●")} ${e.title} ${fmt.dim(`· ${dayTitle(dayOf(e.start))} · ${when(e)} · ${cal.name} [${ref(e)}]`)}\n`);
    return 0;
  }

  async function googleCmd(ctx: ShellContext, what = "status"): Promise<number> {
    if (!ib.google.available()) return ctx.err("cal: Google needs the desktop app\n"), 1;
    const st = await ib.google.status();
    switch (what) {
      case "status":
        ctx.out(`${st.configured ? fmt.green("✓") : fmt.yellow("·")} OAuth client: ${st.custom ? "yours" : st.configured ? "ICEBREAKER's" : "none in this build — cal google setup (see man cal)"}\n`);
        ctx.out(`${st.connected ? fmt.green("✓") : fmt.yellow("·")} ${st.connected ? `signed in · ${google.calendars.length} calendars` : "not signed in — cal google connect"}\n`);
        if (syncError) ctx.out(fmt.red(`${syncError}\n`));
        return 0;
      case "setup": {
        if (ctx.args.includes("--default")) {
          await ib.google.setup("", "");
          connected = false;
          ctx.out("back to ICEBREAKER's client · now: cal google connect\n");
          return 0;
        }
        ctx.out(fmt.dim("Google Cloud console → Credentials → OAuth client ID → Desktop app (details: man cal)\n"));
        const id = await ib.ui.prompt("Google OAuth client ID", { placeholder: "1234-abc.apps.googleusercontent.com" });
        if (!id?.trim()) return ctx.err("cal: cancelled\n"), 1;
        const secret = await ib.ui.prompt("Client secret", { mask: true, placeholder: "GOCSPX-…" });
        if (!secret?.trim()) return ctx.err("cal: cancelled\n"), 1;
        await ib.google.setup(id, secret);
        ctx.out(`${fmt.green("✓")} saved. Now: cal google connect\n`);
        return 0;
      }
      case "connect": case "login": {
        if (!st.configured) return ctx.err("cal: this build has no ICEBREAKER client — use your own: cal google setup (see man cal)\n"), 1;
        ctx.out(fmt.dim("your browser opens Google's consent page… (waiting up to 5 min)\n"));
        await ib.google.connect();
        connected = true;
        mode = "google";
        await ib.storage.set("mode", mode);
        ctx.out(`${fmt.green("✓")} connected. Fetching your calendars…\n`);
        await sync();
        if (syncError) return ctx.err(`cal: ${syncError}\n`), 1;
        ctx.out(`${google.calendars.length} calendars, ${google.events.length} events · default: ${calOf(defaultCal)?.name}\n`);
        return 0;
      }
      case "disconnect": case "logout": {
        await ib.google.disconnect();
        connected = false;
        google = { calendars: [], events: [], at: 0 };
        hidden = hidden.filter((h) => !h.startsWith("g:"));
        if (defaultCal.startsWith("g:")) defaultCal = "local";
        defaultChosen = false;
        await ib.storage.set("local", local); // (the Google cache file was deleted)
        ctx.out("disconnected (cached Google events removed)\n");
        return 0;
      }
      default:
        ctx.err("cal google setup | connect | disconnect | status\n");
        return 1;
    }
  }

  /** Ask title / day / time / calendar, then run the `cal add` it adds up to. */
  async function addFlow(day: Date): Promise<void> {
    const title = await ib.ui.prompt("New event", { placeholder: t("dentist") });
    if (!title?.trim()) return;
    const when = await ib.ui.prompt(t("When? ({day})", { day: day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) }), {
      placeholder: t("14:30 · 9:30-10:15 · empty = all day · or another day: fri 18h"),
    });
    if (when === null) return;
    const writable = calendars().filter((c) => c.writable);
    let cal = calOf(defaultCal) ?? LOCAL;
    if (writable.length > 1) {
      const i = await ib.ui.choose(
        t("Which calendar?"),
        writable.map((c) => ({ label: c.name, hint: c.id === defaultCal ? "default" : c.primary ? "primary" : "", color: c.color || undefined })),
        { selected: Math.max(0, writable.findIndex((c) => c.id === defaultCal)) },
      );
      if (i === null) return;
      cal = writable[i];
    }
    const hasDay = when.trim().split(/\s+/).some((w) => parseDay(w));
    run(`cal add ${q(title.trim())}${hasDay ? "" : ` ${ymd(day)}`}${when.trim() ? ` ${when.trim()}` : ""} --cal ${q(cal.name)}`);
  }

  // ── the app ──────────────────────────────────────────────────────────────
  class CalendarApp implements App {
    readonly kind = "calendar";
    readonly key = "calendar";
    private day = startOfDay(new Date());
    /** -1: the month grid has the keys; ≥0: an event of the day is selected */
    private sel = -1;
    view: "month" | "settings" = "month";
    private setSel = 0;

    title() {
      return "Calendar";
    }
    status() {
      return status();
    }
    goto(d: Date) {
      this.day = startOfDay(d);
      this.sel = -1;
      ib.ui.redraw();
    }
    private get events() {
      return between(this.day, addDays(this.day, 1));
    }

    onText(t: string): boolean {
      if (this.view === "settings") {
        const cal = calendars()[this.setSel];
        if (!cal) return false;
        if (t === " ") return run(`cal ${hidden.includes(cal.id) ? "show" : "hide"} ${q(cal.name)}`), true;
        if (t === "d") return run(`cal default ${q(cal.name)}`), true;
        if (t === "c") return (this.view = "month"), true;
        return false;
      }
      switch (t) {
        case "a": case "n": case "+": void addFlow(this.day); return true;
        case "t": this.goto(new Date()); return true;
        case "s": run("cal sync"); return true;
        case "c": this.view = "settings"; return true;
        case "[": case "<": this.goto(new Date(this.day.getFullYear(), this.day.getMonth() - 1, Math.min(this.day.getDate(), 28))); return true;
        case "]": case ">": this.goto(new Date(this.day.getFullYear(), this.day.getMonth() + 1, Math.min(this.day.getDate(), 28))); return true;
        case "x": this.remove(); return true;
        default: return false;
      }
    }
    onKey(k: KeyInput): boolean {
      if (this.view === "settings") {
        if (k.combo === "esc") return (this.view = "month"), true;
        return false;
      }
      if (k.combo === "delete" || k.combo === "backspace") return this.remove(), true;
      if (k.combo === "esc" && this.sel >= 0) return (this.sel = -1), true;
      if (k.combo === "pageup") return this.onText("["), true;
      if (k.combo === "pagedown") return this.onText("]"), true;
      return false;
    }
    onAction(a: Action): boolean {
      if (this.view === "settings") {
        const n = calendars().length;
        if (a === "up") this.setSel = Math.max(0, this.setSel - 1);
        else if (a === "down") this.setSel = Math.min(n - 1, this.setSel + 1);
        else if (a === "confirm") this.onText(" ");
        else if (a === "back") this.view = "month";
        else return false;
        return true;
      }
      const n = this.events.length;
      if (this.sel >= 0) {
        if (a === "up") this.sel = this.sel === 0 ? -1 : this.sel - 1;
        else if (a === "down") this.sel = Math.min(n - 1, this.sel + 1);
        else if (a === "back") this.sel = -1;
        else return false;
        return true;
      }
      const move = { left: -1, right: 1, up: -7, down: 7 } as Record<string, number>;
      if (a in move) return this.goto(addDays(this.day, move[a])), true;
      if (a === "confirm") return n ? (this.sel = 0) : void addFlow(this.day), true;
      if (a === "home") return this.goto(new Date()), true;
      return false;
    }
    private remove(): void {
      const e = this.events[this.sel];
      if (!e) return;
      void ib.ui.confirm(`Remove "${e.title}"?`, `${dayTitle(dayOf(e.start))} · ${when(e)} · ${calOf(e.cal)?.name}`).then((ok) => {
        if (ok) run(`cal rm ${ref(e)}`);
      });
    }

    render(ui: UI, r: Rect, focused: boolean): void {
      const c = ui.c;
      if (!loaded) return void ui.text(r.x + 1, r.y, `${ui.spinner()} loading…`, { fg: c.muted });
      refreshLocal();
      if (syncing) ui.animate(100);
      this.header(ui, r);
      if (openSettings) (openSettings = false), (this.view = "settings");
      if (this.view === "settings") return this.renderSettings(ui, { x: r.x, y: r.y + 2, w: r.w, h: r.h - 2 }, focused);
      const today = startOfDay(new Date());
      const first = new Date(this.day.getFullYear(), this.day.getMonth(), 1);
      const offset = dow(first);
      const weeks = Math.ceil((offset + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);

      // ── layout: the month grid on the left, the agenda on the right (stacked when narrow)
      const wide = r.w >= 78;
      const gutter = r.w >= 60 ? 4 : 0; // week numbers
      // the month gets most of the width (the agenda keeps 32 columns at least): event names need room
      const gridW = wide ? Math.min(r.w - 32, Math.max(43, Math.floor(r.w * 0.68))) : r.w - 2;
      const cw = Math.max(3, Math.floor((gridW - gutter - 1) / 7) - 1); // inside a cell
      const gx = r.x + 1 + gutter; // left grid line
      const gy = r.y + 2; // weekday names
      const gridH = wide ? r.h - 4 : Math.min(r.h - 12, weeks * 4 + 1);
      const ch = Math.max(1, Math.floor((gridH - 1) / weeks) - 1); // inside a cell
      const X = (i: number) => gx + i * (cw + 1);
      const Y = (w: number) => gy + 1 + w * (ch + 1);
      const line = { fg: mix(c.border, c.accent, 0.25) };

      // weekday names, cyber caps
      for (let i = 0; i < 7; i++) {
        const n = colDay(i).toLocaleDateString(undefined, { weekday: cw >= 6 ? "short" : "narrow" }).replace(".", "").toUpperCase();
        ui.text(X(i) + 1, gy, n.slice(0, cw), { fg: wkd(i) ? c.accentAlt : c.subtle, attrs: BOLD });
      }
      // the grid lines
      for (let w = 0; w <= weeks; w++) {
        const y = Y(w);
        for (let i = 0; i <= 7; i++) {
          const x = X(i);
          const left = i === 0, right = i === 7, top = w === 0, bot = w === weeks;
          const ch0 = top ? (left ? "┌" : right ? "┐" : "┬") : bot ? (left ? "└" : right ? "┘" : "┴") : left ? "├" : right ? "┤" : "┼";
          ui.text(x, y, ch0, line);
          if (i < 7) ui.hline(x + 1, y, cw, line);
          if (w < weeks) ui.vline(x, y + 1, ch, line);
        }
      }
      // cells
      let selCell: Rect | null = null;
      for (let w = 0; w < weeks; w++) {
        const monday = addDays(first, w * 7 - offset);
        if (gutter) ui.text(r.x + 1, Y(w) + 1, `W${String(isoWeek(addDays(monday, 1 - ws()))).padStart(2, "0")}`, { fg: c.faint });
        for (let i = 0; i < 7; i++) {
          const d = addDays(monday, i);
          const other = d.getMonth() !== first.getMonth();
          const cell = { x: X(i) + 1, y: Y(w) + 1, w: cw, h: ch };
          const isSel = ymd(d) === ymd(this.day);
          const isToday = ymd(d) === ymd(today);
          const hot = ui.hovered(cell);
          const bg = isSel ? mix(c.accent, c.bg, focused ? 0.82 : 0.9) : hot ? c.highlight : -1;
          if (bg !== -1) ui.fill(cell, { bg });
          const st = bg !== -1 ? { bg } : {};
          const num = String(d.getDate()).padStart(2, " ");
          // the day number; today's is a solid accent tag
          if (isToday) ui.text(cell.x, cell.y, ` ${num.trim()} `, { fg: c.panel, bg: c.accent, attrs: BOLD });
          else ui.text(cell.x + 1, cell.y, num.trim(), { fg: other ? c.faint : isSel ? c.fg : wkd(i) ? c.accentAlt : c.muted, attrs: isSel ? BOLD : 0, ...st });
          if (isSel) selCell = cell;
          const evs = between(d, addDays(d, 1));
          if (ch >= 2 && cw >= 6) {
            // inside the cell, each event on a tinted strip with a bar of its calendar's
            // colour; an event gets two lines (its name wrapped) when the cell has room
            const room = ch - 1;
            // too many: the last line says how many more (but always show at least one)
            const shown = evs.length > room ? Math.max(1, room - 1) : evs.length;
            const per = shown > 0 && shown * 2 <= room ? 2 : 1;
            evs.slice(0, shown).forEach((e, k) => {
              const ey = cell.y + 1 + k * per;
              const col = colorOf(ui, e.cal);
              const tb = mix(col, c.bg, e.allDay ? (other ? 0.85 : 0.7) : other ? 0.92 : 0.86);
              ui.fill({ x: cell.x, y: ey, w: cell.w, h: per }, { bg: tb });
              ui.text(cell.x, ey, "▌", { fg: col, bg: tb });
              if (per === 2) ui.text(cell.x, ey + 1, "▌", { fg: col, bg: tb });
              // the hour first when there's room for it, then the name
              const time = !e.allDay && cw >= 14 ? `${hm(dayOf(e.start))} ` : "";
              const text = `${time}${e.title}`;
              const w = cell.w - 1;
              const fg = other ? c.muted : c.fg;
              if (per === 2 && strWidth(text) > w) {
                const cut = text.lastIndexOf(" ", w) > w / 2 ? text.lastIndexOf(" ", w) : w;
                ui.text(cell.x + 1, ey, text.slice(0, cut), { fg, bg: tb }, w);
                ui.text(cell.x + 1, ey + 1, text.slice(cut).trimStart(), { fg, bg: tb }, w);
              } else ui.text(cell.x + 1, ey, text, { fg, bg: tb }, w);
              if (time) ui.text(cell.x + 1, ey, time.trim(), { fg: mix(col, c.fg, 0.3), bg: tb });
            });
            if (evs.length > shown) {
              const more = `+${evs.length - shown}`;
              if (shown < room) ui.text(cell.x + 1, cell.y + 1 + shown, more, { fg: c.accentAlt, ...st }, cell.w - 1);
              else ui.textRight(cell.x + cell.w, cell.y, more, { fg: c.accentAlt, attrs: BOLD, ...st }); // next to the day number
            }
          } else {
            evs.slice(0, Math.max(0, cw - 3)).forEach((e, k) => ui.text(cell.x + 3 + k, cell.y, "•", { fg: colorOf(ui, e.cal), ...st }));
          }
          ui.hit(cell, { onClick: () => this.goto(d), onDouble: () => void addFlow(d), tip: `${dayTitle(d)}\n${evs.length ? evs.map((e) => `${when(e)} ${e.title}`).join("\n") : "nothing"}\ndouble-click: add` });
        }
      }
      // the selected day gets a neon frame
      if (selCell) {
        const s0 = selCell as Rect;
        // the frame shares the cell's tint, so frame and fill read as one block
        const hl = { fg: focused ? c.accent : c.subtle, bg: mix(c.accent, c.bg, focused ? 0.82 : 0.9), attrs: BOLD };
        ui.text(s0.x - 1, s0.y - 1, "┏", hl);
        ui.hline(s0.x, s0.y - 1, s0.w, hl, "━");
        ui.text(s0.x + s0.w, s0.y - 1, "┓", hl);
        ui.vline(s0.x - 1, s0.y, s0.h, hl, "┃");
        ui.vline(s0.x + s0.w, s0.y, s0.h, hl, "┃");
        ui.text(s0.x - 1, s0.y + s0.h, "┗", hl);
        ui.hline(s0.x, s0.y + s0.h, s0.w, hl, "━");
        ui.text(s0.x + s0.w, s0.y + s0.h, "┛", hl);
      }

      // ── the agenda: the selected day, then what's coming
      const ax = wide ? X(7) + 3 : r.x + 1;
      const ay = wide ? gy : Y(weeks) + 2;
      const aw = wide ? r.x + r.w - ax - 1 : r.w - 2;
      const bottom = r.y + r.h - 2;
      const dayHead = (y: number, label: string, hot: boolean) => {
        ui.text(ax, y, label.toUpperCase(), { fg: hot ? c.accent : c.fg, attrs: BOLD }, aw);
        ui.hline(ax + Math.min(aw - 1, strWidth(label) + 1), y, Math.max(0, aw - strWidth(label) - 1), { fg: c.faint });
      };
      dayHead(ay, dayTitle(this.day), ymd(this.day) === ymd(today));
      const evs = this.events;
      if (!evs.length) ui.text(ax, ay + 1, t("nothing · a / enter adds"), { fg: c.faint }, aw);
      let y = ay + 1;
      evs.forEach((e, k) => {
        if (y > bottom) return;
        const row = { x: ax, y, w: aw, h: 1 };
        const isSel = k === this.sel;
        const rbg = isSel ? mix(c.accent, c.bg, 0.75) : ui.hovered(row) ? c.highlight : -1;
        if (rbg !== -1) ui.fill(row, { bg: rbg });
        const st = rbg !== -1 ? { bg: rbg } : {};
        ui.text(ax, y, "▍", { fg: colorOf(ui, e.cal), ...st });
        ui.text(ax + 2, y, when(e).padEnd(11), { fg: c.subtle, ...st });
        const cal = calOf(e.cal)?.name ?? "";
        const rx = cal && aw > 44 ? ui.textRight(ax + aw, y, cal, { fg: c.faint, ...st }) : ax + aw;
        ui.text(ax + 14, y, e.title, { fg: c.fg, attrs: isSel ? BOLD : 0, ...st }, rx - ax - 15);
        ui.hit(row, { onClick: () => (this.sel = k), tip: `${e.title}${e.where ? `\n${e.where}` : ""}\nx / delete: remove · cal rm ${ref(e)}` });
        y++;
        if (e.where && y <= bottom) ui.text(ax + 14, y++, `@ ${e.where}`, { fg: c.faint }, aw - 14);
      });
      if (y + 3 < bottom) {
        y++;
        let last = "";
        for (const e of upcomingAfter(addDays(this.day, 1), 60)) {
          const s = dayOf(e.start);
          const key = ymd(s);
          if (y + (key !== last ? 2 : 1) > bottom) break;
          if (key !== last) {
            last = key;
            if (y > ay + 2) y++;
            dayHead(y++, dayTitle(s), false);
          }
          const row = { x: ax, y, w: aw, h: 1 };
          ui.text(ax, y, "▍", { fg: colorOf(ui, e.cal) });
          ui.text(ax + 2, y, when(e).padEnd(11), { fg: c.subtle });
          ui.text(ax + 14, y, e.title, { fg: ui.hovered(row) ? c.accent : c.muted }, aw - 14);
          ui.hit(row, { onClick: () => this.goto(s), tip: `${dayTitle(s)}\nclick: go to that day` });
          y++;
        }
      }
      ui.text(ax, r.y + r.h - 1, t("arrows · enter · a add · x remove · [ ] months · t today · c settings"), { fg: c.faint }, aw);
    }

    private header(ui: UI, r: Rect): void {
      const c = ui.c;
      let hx = r.x + 1;
      const btn = (label: string, cmd: () => void, tip: string, on = false) => {
        const rect = { x: hx, y: r.y, w: strWidth(label), h: 1 };
        const hot = ui.hovered(rect);
        ui.text(hx, r.y, label, hot || on ? { fg: c.panel, bg: c.accent, attrs: BOLD } : { fg: c.fg, bg: c.highlight });
        ui.hit(rect, { onClick: cmd, tip });
        hx += rect.w + 1;
      };
      if (this.view === "month") {
        btn(" ‹ ", () => this.onText("["), "previous month · [");
        const month = new Date(this.day.getFullYear(), this.day.getMonth(), 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase();
        hx = ui.gradientText(hx + 1, r.y, month, ui.theme.gradient) + 2;
        btn(" › ", () => this.onText("]"), "next month · ]");
        btn(t(" today "), () => this.goto(new Date()), "t");
        btn(t(" + add "), () => void addFlow(this.day), "a · or: cal add \"title\" <day> <time>");
        if (connected) btn(syncing ? ` ${ui.spinner()} sync ` : t(" ⟳ sync "), () => run("cal sync"), "s · cal sync");
      } else btn(t(" ‹ back "), () => (this.view = "month"), "esc");
      btn(t(" ⚙ settings "), () => (this.view = this.view === "settings" ? "month" : "settings"), "c · calendars, Google, local files", this.view === "settings");
      if (syncError && r.x + r.w - 1 - strWidth(syncError) > hx + 1) ui.textRight(r.x + r.w - 1, r.y, syncError, { fg: c.error });
    }

    /** The settings page: which calendars show, the default one, Google, the local files. */
    private renderSettings(ui: UI, r: Rect, focused: boolean): void {
      const c = ui.c;
      const w = Math.min(r.w - 4, 90);
      const x = r.x + Math.max(2, Math.floor((r.w - w) / 2));
      let y = r.y;
      const section = (title: string) => {
        ui.text(x, y, title, { fg: c.accent, attrs: BOLD });
        ui.hline(x + strWidth(title) + 1, y, w - strWidth(title) - 1, { fg: c.faint });
        y += 2;
      };
      // where the calendar lives
      section("WHERE");
      const modeBtn = (m: "local" | "google", label: string, hint: string) => {
        const on = mode === m || (m === "local" && mode === "ask" && !connected);
        const rect = { x, y, w, h: 1 };
        ui.text(x, y, on ? "◉" : "○", { fg: on ? c.accent : c.subtle });
        ui.text(x + 2, y, label, { fg: ui.hovered(rect) ? c.accent : c.fg, attrs: on ? BOLD : 0 });
        ui.text(x + 30, y, hint, { fg: c.faint }, w - 30);
        ui.hit(rect, { cmd: `cal mode ${m}`, tip: `cal mode ${m}` });
        y++;
      };
      modeBtn("local", t("In my vault only"), t("plain Markdown in calendar/ · offline, no account"));
      if (ib.google.available()) modeBtn("google", t("Vault + Google Calendar"), connected ? `connected · ${status()}` : t("signs in in your browser"));
      y++;
      // the calendars
      section("CALENDARS");
      const all = calendars();
      this.setSel = Math.max(0, Math.min(this.setSel, all.length - 1));
      all.forEach((cal, i) => {
        if (y >= r.y + r.h - 3) return;
        const row = { x, y, w, h: 1 };
        const sel = i === this.setSel && focused;
        if (sel || ui.hovered(row)) ui.fill(row, { bg: sel ? mix(c.accent, c.bg, 0.8) : c.highlight });
        const st = sel || ui.hovered(row) ? { bg: sel ? mix(c.accent, c.bg, 0.8) : c.highlight } : {};
        const shown = !hidden.includes(cal.id);
        ib.lib.checkbox(ui, x, y, shown, { hot: sel, bg: st.bg });
        ui.hit({ x, y, w: 3, h: 1 }, { cmd: `cal ${shown ? "hide" : "show"} ${q(cal.name)}`, tip: "space · show / hide" });
        ui.text(x + 4, y, "●", { fg: colorOf(ui, cal.id), ...st });
        ui.text(x + 6, y, cal.name, { fg: shown ? c.fg : c.muted, attrs: sel ? BOLD : 0, ...st }, w - 34);
        const tags = [cal.id === defaultCal ? "default" : "", cal.id === "local" ? "vault" : "google", cal.writable ? "" : "read-only"].filter(Boolean).join(" · ");
        ui.textRight(x + w, y, tags, { fg: cal.id === defaultCal ? c.success : c.faint, ...st });
        ui.hit({ x: x + 4, y, w: w - 4, h: 1 }, { onClick: () => (this.setSel = i), onDouble: () => run(`cal ${shown ? "hide" : "show"} ${q(cal.name)}`), tip: "space: show / hide · d: make it the default" });
        y++;
      });
      y++;
      if (connected && y < r.y + r.h - 2) {
        ui.button(x, y, t("⟳ sync now"), () => run("cal sync"), { cmd: "cal sync" });
        ui.button(x + 16, y, t("disconnect Google"), () => run("cal google disconnect"), { cmd: "cal google disconnect", accent: c.error });
        y += 2;
      }
      if (y < r.y + r.h - 1) ui.text(x, y, t("local calendar: calendar/YYYY-MM.md in your vault — one event per line, edit it anywhere"), { fg: c.faint }, w);
      ui.text(x, r.y + r.h - 1, t("↑↓ choose · space show/hide · d default · esc back"), { fg: c.faint }, w);
    }
  }

  ib.apps.register({
    kind: "calendar",
    title: "Calendar",
    description: "your agenda: local + Google calendars",
    icon: "▦",
    launcher: true,
    create: () => new CalendarApp(),
  });
  ib.palette.register({ id: "calendar.add", title: "Calendar: add an event", group: "calendar", run: () => void addFlow(startOfDay(new Date())) });
  ib.palette.register({ id: "calendar.open", title: "Calendar", group: "calendar", run: () => run("cal open") });

  // ── the agenda pop-up, shared by the month and week widgets ──────────────
  let popDay = startOfDay(new Date());
  const agendaPopup = {
    title: "calendar",
    size: { w: 72, h: 15 },
    hint: "←→↑↓ day · [ ] month · a add · enter: open the day",
    render(ui: UI, r: Rect) {
      const c = ui.c;
      const first = new Date(popDay.getFullYear(), popDay.getMonth(), 1);
      const offset = dow(first);
      const today = ymd(new Date());
      ui.text(r.x + 2, r.y, first.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase(), { fg: c.accent, attrs: BOLD });
      for (let i = 0; i < 7; i++) ui.text(r.x + 2 + i * 4, r.y + 2, colDay(i).toLocaleDateString(undefined, { weekday: "narrow" }).toUpperCase(), { fg: wkd(i) ? c.accentAlt : c.subtle });
      for (let k = 0; k < 42; k++) {
        const d = addDays(first, k - offset);
        if (d.getMonth() !== first.getMonth()) continue;
        const x = r.x + 2 + (k % 7) * 4, y = r.y + 3 + Math.floor(k / 7);
        const key = ymd(d);
        const sel = key === ymd(popDay);
        const evs = between(d, addDays(d, 1));
        const style = sel ? { fg: c.panel, bg: c.accent, attrs: BOLD } : key === today ? { fg: c.accent, attrs: BOLD } : { fg: evs.length ? c.fg : c.muted };
        ui.text(x, y, String(d.getDate()).padStart(2), style);
        if (evs.length) ui.text(x + 2, y, "•", { fg: colorOf(ui, evs[0].cal) });
        ui.hit({ x, y, w: 3, h: 1 }, { onClick: () => (popDay = d), onDouble: () => run(`cal open ${key}`), tip: evs.map((e) => `${when(e)} ${e.title}`).join("\n") || "nothing" });
      }
      // the chosen day
      const ax = r.x + 32, aw = r.w - 34;
      ui.vline(ax - 2, r.y, r.h - 1, { fg: c.faint });
      ui.text(ax, r.y, dayTitle(popDay).toUpperCase(), { fg: c.fg, attrs: BOLD }, aw);
      const evs = between(popDay, addDays(popDay, 1));
      if (!evs.length) ui.text(ax, r.y + 2, t("nothing · a adds"), { fg: c.faint });
      evs.slice(0, r.h - 4).forEach((e, i) => {
        ui.text(ax, r.y + 2 + i, "●", { fg: colorOf(ui, e.cal) });
        ui.text(ax + 2, r.y + 2 + i, when(e).padEnd(11), { fg: c.subtle });
        ui.text(ax + 14, r.y + 2 + i, e.title, { fg: c.fg }, aw - 14);
      });
      ui.button(ax, r.y + r.h - 1, t("+ add"), () => void addFlow(popDay), { tip: "a" });
    },
    onText: (t: string) => {
      if (t === "a" || t === "+") return void addFlow(popDay), true;
      if (t === "[") return (popDay = new Date(popDay.getFullYear(), popDay.getMonth() - 1, 1)), true;
      if (t === "]") return (popDay = new Date(popDay.getFullYear(), popDay.getMonth() + 1, 1)), true;
      if (t === "t") return (popDay = startOfDay(new Date())), true;
      return false;
    },
    onKey: (k: KeyInput, { close }: { close(): void }) => (k.combo === "enter" ? (close(), run(`cal open ${ymd(popDay)}`), true) : false),
    onAction: (a: Action) => {
      const move: Record<string, number> = { left: -1, right: 1, up: -7, down: 7 };
      if (a in move) return (popDay = addDays(popDay, move[a])), true;
      return false;
    },
  };

  // ── HOME widget: this month, days with events marked ────────────────────
  ib.widgets.register({
    id: "month",
    title: "calendar",
    // the core "calendar" widget draws this one: offer only that one
    picker: false,
    description: "this month: days with events marked (CALENDAR module)",
    size: { w: 4, h: 7 },
    min: { w: 2, h: 2 },
    open: "cal open",
    popup: agendaPopup,
    render(ui, r) {
      const c = ui.c;
      if (!loaded) return;
      refreshLocal();
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const offset = dow(first);
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const weeks = Math.ceil((offset + days) / 7);
      // an even grid, centred in the widget: same width for every column, same height for every week
      const cw = Math.max(3, Math.min(6, Math.floor((r.w - 1) / 7)));
      const ch = Math.max(1, Math.min(3, Math.floor((r.h - 2) / weeks)));
      const gx = r.x + Math.floor((r.w - cw * 7) / 2);
      const gy = r.y + 2 + Math.max(0, Math.floor((r.h - 2 - weeks * ch) / 2));
      const colX = (i: number) => gx + i * cw;
      ui.textCenter(r, r.y, first.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase(), { fg: c.fg, attrs: BOLD });
      if (r.h < 3) return;
      for (let i = 0; i < 7; i++) {
        const n = colDay(i).toLocaleDateString(undefined, { weekday: cw >= 6 ? "short" : "narrow" }).replace(".", "").slice(0, cw - 1);
        ui.text(colX(i) + cw - 1 - strWidth(n), r.y + 1, n, { fg: wkd(i) ? c.accentAlt : c.subtle });
      }
      for (let d = 1; d <= days; d++) {
        const k = offset + d - 1;
        const y = gy + Math.floor(k / 7) * ch;
        if (y >= r.y + r.h) break;
        const x = colX(k % 7);
        const date = new Date(now.getFullYear(), now.getMonth(), d);
        const evs = between(date, addDays(date, 1));
        const isToday = d === now.getDate();
        const label = String(d).padStart(cw - 1);
        ui.text(x, y, label, isToday ? { fg: c.panel, bg: c.accent, attrs: BOLD } : { fg: evs.length ? c.fg : c.muted, attrs: evs.length ? BOLD : 0 });
        if (evs.length && ch >= 2) ui.text(x + cw - 2 - (evs.length > 1 ? 1 : 0), y + 1, evs.length > 1 ? "••" : "•", { fg: colorOf(ui, evs[0].cal) });
        else if (evs.length && !isToday) ui.text(x - 1, y, "·", { fg: colorOf(ui, evs[0].cal) });
        ui.hit({ x, y, w: cw, h: Math.min(ch, 2) }, { cmd: `cal open ${ymd(date)}`, tip: `${dayTitle(date)}\n${evs.map((e) => `${when(e)} ${e.title}`).join("\n") || "nothing"}` });
      }
    },
  });

  // ── HOME widget: this week, day by day ───────────────────────────────────
  ib.widgets.register({
    id: "week",
    title: "this week",
    description: "the 7 days of this week with their events (CALENDAR module)",
    size: { w: 8, h: 4 },
    min: { w: 4, h: 2 },
    open: "cal open",
    popup: agendaPopup,
    render(ui, r) {
      const c = ui.c;
      if (!loaded) return;
      refreshLocal();
      const today = startOfDay(new Date());
      const monday = addDays(today, -dow(today));
      const cw = Math.floor(r.w / 7);
      for (let i = 0; i < 7; i++) {
        const d = addDays(monday, i);
        const x = r.x + i * cw;
        const isToday = ymd(d) === ymd(today);
        const head = `${d.toLocaleDateString(undefined, { weekday: "short" }).replace(".", "")} ${d.getDate()}`;
        ui.text(x + 1, r.y, head.slice(0, cw - 1), isToday ? { fg: c.panel, bg: c.accent, attrs: BOLD } : { fg: wkd(i) ? c.accentAlt : c.subtle, attrs: BOLD });
        if (i > 0) ui.vline(x, r.y, r.h, { fg: c.faint });
        between(d, addDays(d, 1)).slice(0, r.h - 1).forEach((e, k) => {
          const y = r.y + 1 + k;
          ui.text(x + 1, y, "▪", { fg: colorOf(ui, e.cal) });
          ui.text(x + 2, y, e.allDay ? e.title : `${hm(dayOf(e.start))} ${e.title}`, { fg: d < today ? c.muted : c.fg }, cw - 2);
        });
        ui.hit({ x, y: r.y, w: cw, h: r.h }, { cmd: `cal open ${ymd(d)}`, tip: dayTitle(d) });
      }
    },
  });

  // ── HOME widget: what's coming, as much as fits ──────────────────────────
  let nextSel = 0;
  ib.widgets.register({
    id: "next",
    title: "upcoming",
    description: "your next events — more of them as you make it bigger (CALENDAR module)",
    size: { w: 4, h: 4 },
    min: { w: 2, h: 1 },
    render(ui, r) {
      const c = ui.c;
      if (!loaded) return void ui.text(r.x + 1, r.y, `${ui.spinner()} loading…`, { fg: c.muted });
      refreshLocal();
      ui.animate(30_000); // "in 12 min" moves on
      const evs = upcoming(r.h * 2);
      if (!evs.length) {
        ui.text(r.x + 1, r.y, t("nothing coming up"), { fg: c.muted }, r.w - 2);
        if (r.h > 1) ui.hit({ x: r.x, y: r.y, w: r.w, h: 1 }, { cmd: "cal open", tip: "the CALENDAR app" });
        return;
      }
      // one line: just the next one
      if (r.h === 1) {
        const e = evs[0];
        const s = dayOf(e.start);
        const tail = ` ${e.allDay ? "" : until(s)}`;
        ui.text(r.x + 1, r.y, "●", { fg: colorOf(ui, e.cal) });
        const end = ui.textRight(r.x + r.w - 1, r.y, tail, { fg: c.accent });
        ui.text(r.x + 3, r.y, e.title, { fg: c.fg }, end - r.x - 4);
        ui.hit({ ...r }, { cmd: `cal open ${ymd(s)}`, tip: `${dayTitle(s)} · ${when(e)}` });
        return;
      }
      // grouped by day, as many lines as the widget has
      let y = r.y;
      let lastDay = "";
      for (const e of evs) {
        const s = dayOf(e.start);
        const key = ymd(e.allDay ? s : s);
        const needs = key !== lastDay ? 2 : 1;
        if (y + needs > r.y + r.h) break;
        if (key !== lastDay) {
          lastDay = key;
          const n = Math.round((startOfDay(s).getTime() - startOfDay(new Date()).getTime()) / DAY);
          const label = n <= 0 ? "TODAY" : n === 1 ? "TOMORROW" : s.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }).toUpperCase();
          ui.text(r.x + 1, y++, label, { fg: n <= 0 ? c.accent : c.subtle, attrs: BOLD }, r.w - 2);
        }
        const row = { x: r.x, y, w: r.w, h: 1 };
        const hot = ui.hovered(row);
        ui.text(r.x + 1, y, "●", { fg: colorOf(ui, e.cal) });
        const time = e.allDay ? "day" : hm(s);
        ui.text(r.x + 3, y, time.padEnd(5), { fg: c.subtle });
        const soon = !e.allDay && s.getTime() - Date.now() < 3 * 3600_000 && r.w >= 24 ? until(s) : "";
        const end = soon ? ui.textRight(r.x + r.w - 1, y, soon, { fg: c.warning }) : r.x + r.w;
        ui.text(r.x + 9, y, e.title, { fg: hot ? c.accent : c.fg }, end - r.x - 10);
        ui.hit(row, { cmd: `cal open ${ymd(s)}`, tip: `${e.title}\n${dayTitle(s)} · ${when(e)}${e.where ? `\n${e.where}` : ""}\n${calOf(e.cal)?.name}` });
        y++;
      }
    },
    open: "cal open",
    popup: {
      title: "upcoming",
      size: { w: 64, h: 16 },
      hint: "a add · ↑↓ · enter: that day",
      render(ui, r) {
        const c = ui.c;
        const evs = upcoming(40);
        nextSel = Math.max(0, Math.min(nextSel, evs.length - 1));
        let y = r.y;
        let last = "";
        let i = 0;
        for (const e of evs) {
          const s = dayOf(e.start);
          const key = ymd(s);
          if (y + (key !== last ? 2 : 1) > r.y + r.h - 1) break;
          if (key !== last) {
            last = key;
            ui.text(r.x + 2, y++, dayTitle(s).toUpperCase(), { fg: c.subtle, attrs: BOLD }, r.w - 4);
          }
          const row = { x: r.x, y, w: r.w, h: 1 };
          const sel = i === nextSel;
          if (sel) ui.fill(row, { bg: mix(c.accent, c.bg, 0.8) });
          const st = sel ? { bg: mix(c.accent, c.bg, 0.8) } : {};
          ui.text(r.x + 2, y, "▍", { fg: colorOf(ui, e.cal), ...st });
          ui.text(r.x + 4, y, when(e).padEnd(11), { fg: c.subtle, ...st });
          ui.text(r.x + 16, y, e.title, { fg: c.fg, attrs: sel ? BOLD : 0, ...st }, r.w - 30);
          ui.textRight(r.x + r.w - 2, y, e.allDay ? "" : until(s), { fg: c.faint, ...st });
          ui.hit(row, { cmd: `cal open ${key}`, tip: "go to that day" });
          y++;
          i++;
        }
        if (!evs.length) ui.text(r.x + 2, r.y + 1, t("nothing coming up · a adds an event"), { fg: c.muted });
        ui.button(r.x + 2, r.y + r.h - 1, t("+ add an event"), () => void addFlow(startOfDay(new Date())), { tip: "a" });
      },
      onText: (t) => (t === "a" || t === "+" ? (void addFlow(startOfDay(new Date())), true) : false),
      onKey: (k, { close }) => {
        if (k.combo !== "enter") return false;
        const e = upcoming(40)[nextSel];
        if (!e) return false;
        close();
        run(`cal open ${ymd(dayOf(e.start))}`);
        return true;
      },
      onAction: (a) => {
        if (a === "up") return (nextSel = Math.max(0, nextSel - 1)), true;
        if (a === "down") return (nextSel += 1), true;
        return false;
      },
    },
  });
}

export function deactivate(): void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  if (sayTimer) clearInterval(sayTimer); // the "events 30 min before" voice watch
  sayTimer = undefined;
}
