/**
 * MUSIC — your music, as a module. Two sources, one set of controls:
 *
 *   LOCAL   a folder of audio files played by ICEBREAKER itself (a mini
 *           iTunes: artists, albums, tracks, queue, shuffle, repeat).
 *           Tags are read, cover art never is: no images in the deck.
 *   SYSTEM  what's playing on this computer (Spotify, Music; any MPRIS
 *           player through playerctl on Linux).
 *
 *   music                    what's playing
 *   music toggle | play | pause | next | prev | stop
 *   music play <search>      play what matches (track, album or artist)
 *   music album <name> · music artist <name>
 *   music folder [path] · music scan · music lib [artists|albums]
 *   music shuffle [on|off] · music repeat [off|all|one] · music queue
 *   music seek 1:30 | +10 | -10 · music vol [0-100 | + | -] · music open
 *
 * While a local track is loaded, the controls drive it; otherwise they drive
 * the system player. Native side: audio.rs (local) and media.rs (system).
 */
import type { App } from "../../src/apps/types";
import type { Rect } from "../../src/core/grid";
import type { Action, KeyInput } from "../../src/core/input";
import type { IcebreakerAPI } from "../../src/plugins/api";
import type { LocalTrack, MediaStatus, PlayerStatus } from "../../src/platform/types";
import type { UI } from "../../src/ui/ui";

const ACTIONS: Record<string, string> = { toggle: "toggle", "play-pause": "toggle", play: "play", pause: "pause", next: "next", skip: "next", prev: "prev", previous: "prev", back: "prev" };
type Repeat = "off" | "all" | "one";
let tick: ReturnType<typeof setInterval> | null = null;

export function activate(ib: IcebreakerAPI): void {
  ib.settings.register([
    { key: "folder", label: "music folder", type: "action", value: () => folder.split(/[\\/]/).filter(Boolean).pop() ?? "—", run: async () => {
      const p = await ib.ui.pickFolder("YOUR MUSIC FOLDER", folder || undefined);
      if (p?.trim()) await ib.shell.run(`music folder ${ib.lib.q(p.trim())}`);
    }, help: "Where your music files are (mp3, flac, m4a…): the library is read from there." },
    { key: "shuffle", label: "shuffle", type: "action", value: () => (shuffle ? "on" : "off"), cmd: "music shuffle", help: "Play the queue in a random order." },
    { key: "scan", label: "scan the folder again", type: "action", value: () => `${lib.length}`, cmd: "music scan", help: "Read the music folder again (new files, removed ones)." },
  ]);
  const { BOLD, strWidth, fmt, q, mix, fuzzyFilter } = ib.lib;
  const run = (line: string) => void ib.shell.run(line);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ── local library + player ───────────────────────────────────────────────
  const player = ib.media.player;
  let folder = "~/Music";
  let lib: LocalTrack[] = [];
  let scanning = false;
  let queue: string[] = [];
  let qi = -1;
  let shuffle = false;
  let repeat: Repeat = "off";
  let local: PlayerStatus | null = null;
  let localAt = 0;
  const byPath = new Map<string, LocalTrack>();
  const index = () => {
    byPath.clear();
    for (const t of lib) byPath.set(t.path, t);
  };
  const sortKey = (t: LocalTrack) => `${t.artist.toLowerCase()}\u0000${t.year.toString().padStart(4, "0")}\u0000${t.album.toLowerCase()}\u0000${String(t.disc).padStart(3, "0")}${String(t.track).padStart(4, "0")}\u0000${t.title.toLowerCase()}`;
  const sortLib = () => lib.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const ready = (async () => {
    folder = await ib.storage.get("folder", folder);
    lib = await ib.storage.get<LocalTrack[]>("library", []);
    shuffle = await ib.storage.get("shuffle", false);
    repeat = await ib.storage.get<Repeat>("repeat", "off");
    index();
    ib.ui.redraw();
  })();
  const saveLib = async () => {
    await ib.storage.set("folder", folder);
    await ib.storage.set("library", lib);
  };

  const artists = () => [...new Set(lib.map((t) => t.artist || "unknown artist"))];
  const albumsOf = (artist?: string) => {
    const seen = new Map<string, { album: string; artist: string; year: number; n: number }>();
    for (const t of lib) {
      if (artist && (t.artist || "unknown artist") !== artist) continue;
      const k = `${t.artist}\u0000${t.album}`;
      const a = seen.get(k);
      if (a) a.n++;
      else seen.set(k, { album: t.album || "unknown album", artist: t.artist, year: t.year, n: 1 });
    }
    return [...seen.values()];
  };
  const tracksOf = (album?: string, artist?: string) => lib.filter((t) => (album === undefined || (t.album || "unknown album") === album) && (artist === undefined || t.artist === artist || (!t.artist && artist === "unknown artist")));

  async function scan(): Promise<number> {
    scanning = true;
    ib.ui.redraw();
    try {
      lib = await player.scan(folder);
      sortLib();
      index();
      await saveLib();
      return lib.length;
    } finally {
      scanning = false;
      ib.ui.redraw();
    }
  }

  const current = () => (qi >= 0 ? byPath.get(queue[qi]) ?? null : null);
  async function playAt(i: number): Promise<void> {
    if (i < 0 || i >= queue.length) return;
    qi = i;
    const t = byPath.get(queue[i]);
    await player.load(queue[i], true, t?.duration);
    void ib.stats.add("played", 1, { label: "tracks played", kind: "counter" }).catch(() => {});
    setTimeout(() => void pollLocal(), 150);
  }
  async function playList(paths: string[], start = 0): Promise<void> {
    if (!paths.length) return;
    let list = [...paths];
    if (shuffle) {
      const first = list.splice(start, 1)[0];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      list = [first, ...list];
      start = 0;
    }
    queue = list;
    await playAt(start);
  }
  async function step(dir: 1 | -1, auto = false): Promise<void> {
    if (!queue.length) return;
    if (auto && repeat === "one") return playAt(qi);
    if (dir < 0 && local && local.position > 3) return playAt(qi); // back to the start first
    let n = qi + dir;
    if (n >= queue.length) {
      if (repeat === "off" && auto) {
        await player.control("stop");
        qi = -1;
        return void pollLocal();
      }
      n = 0;
    }
    if (n < 0) n = repeat === "off" ? 0 : queue.length - 1;
    await playAt(n);
  }
  async function pollLocal(): Promise<void> {
    if (!player.available()) return;
    local = await player.status().catch(() => null);
    localAt = Date.now();
    if (local?.error) ib.ui.notify(local.error, "warning");
    if (local?.ended && local.path) await step(1, true);
    ib.ui.redraw();
  }
  if (tick) clearInterval(tick);
  tick = setInterval(() => {
    if (local?.path || qi >= 0) void pollLocal();
  }, 1000);
  const localActive = () => !!local?.path;
  const localStatus = (): MediaStatus | null => {
    if (!local?.path) return null;
    const t = byPath.get(local.path);
    const name = local.path.split(/[\\/]/).pop() ?? "";
    return {
      player: `local${shuffle ? " · shuffle" : ""}${repeat !== "off" ? ` · repeat ${repeat}` : ""}`,
      playing: local.playing,
      title: t?.title ?? name,
      artist: t?.artist ?? "",
      album: t?.album ?? "",
      position: local.position + (local.playing ? (Date.now() - localAt) / 1000 : 0),
      duration: local.duration || t?.duration || 0,
      volume: local.volume,
    };
  };

  /** Tracks matching a search: the best artist, album or track match. */
  function search(query: string): LocalTrack[] {
    const ql = query.toLowerCase();
    const artist = artists().find((a) => a.toLowerCase() === ql);
    if (artist) return tracksOf(undefined, artist);
    const album = albumsOf().find((a) => a.album.toLowerCase() === ql);
    if (album) return tracksOf(album.album, album.artist || undefined);
    return fuzzyFilter(query, lib, (t) => `${t.title} ${t.artist} ${t.album}`, 500);
  }

  // ── state of the system player: polled while the widget is on screen ────
  let status: MediaStatus | null = null;
  let at = 0;
  let error: string | null = null;
  let loading = false;
  let polledAt = 0;

  const poll = async (): Promise<void> => {
    if (localActive()) return void (await pollLocal());
    if (loading || !ib.media.available()) return;
    loading = true;
    polledAt = Date.now();
    try {
      status = await ib.media.status();
      at = Date.now();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
      ib.ui.redraw();
    }
  };
  /** What the widget and `music` show: the local player first. */
  const shown = (): MediaStatus | null => localStatus() ?? status;
  ib.modules.expose("status", { doc: "status() → what's playing { title, artist, playing, position, duration } or null", fn: () => shown() });
  ib.modules.expose("control", { doc: 'control("play" | "pause" | "toggle" | "next" | "prev")', fn: (a: string) => ib.shell.run(`music ${a}`) });
  const position = () => {
    const s = shown();
    if (!s) return 0;
    if (localActive()) return Math.min(s.duration || Infinity, s.position);
    return Math.min(s.duration || Infinity, s.position + (s.playing ? (Date.now() - at) / 1000 : 0));
  };

  const control = async (action: string) => {
    if (localActive() || (action === "play" && qi >= 0)) {
      if (action === "next") return step(1);
      if (action === "prev") return step(-1);
      if (action === "vol+" || action === "vol-") {
        const v = Math.max(0, Math.min(100, (local?.volume ?? 80) + (action === "vol+" ? 10 : -10)));
        await player.control(`vol:${v}`);
      } else await player.control(action);
      return void setTimeout(() => void pollLocal(), 120);
    }
    await ib.media.control(action);
    // the player needs a moment before it reports the new state
    setTimeout(() => void poll(), 300);
    setTimeout(() => void poll(), 1200);
  };

  ib.commands.register({
    name: "music",
    aliases: ["np"],
    summary: "your music: local files and what's playing (MUSIC module)",
    usage: [
      "music                    what's playing",
      "music toggle | play | pause | next | prev | stop",
      "music play <search>      play a track, album or artist from your folder",
      "music album <name> [--from n] · music artist <name>",
      "music folder [path]      where your music is (default ~/Music)",
      "music scan               read the folder again",
      "music lib [artists | albums | <search>]",
      "music shuffle [on|off] · music repeat [off|all|one]",
      "music queue · music seek 1:30 | +10 | -10",
      "music vol [0-100 | + | -] · music open",
    ].join("\n"),
    examples: [
      ["music folder ~/Music", "then: music scan"],
      ["music play daft punk", "everything that matches"],
      ['music album "Discovery"', "an album, in order"],
      ["music shuffle on", "mix the queue"],
      ["music next", "skip"],
      ["music vol 30", "volume to 30 %"],
    ],
    man: "LOCAL: mp3, m4a/aac, flac, wav, ogg, aiff. Tags give artist / album / title; untagged files use their folders (Artist/Album/track.mp3). Cover art is never read.\nSYSTEM: macOS: Spotify and Music (macOS asks once to let ICEBREAKER control them). Linux: any MPRIS player through playerctl. Windows: not yet.\nWhile a local track is loaded, toggle/next/prev/vol drive it; `music stop` hands the controls back to the system player.",
    complete: () => ["toggle", "play", "pause", "next", "prev", "stop", "album", "artist", "folder", "scan", "lib", "shuffle", "repeat", "queue", "seek", "vol", "open"],
    async run(ctx) {
      await ready;
      const [a, ...more] = ctx.args;
      const b = more[0];
      const arg = more.join(" ").trim();
      const needLocal = () => {
        if (!player.available()) throw new Error("the local player needs the desktop app");
      };
      try {
        switch (a) {
          case undefined: {
            await poll();
            if (error && !localActive()) return ctx.err(`music: ${error}\n`), 1;
            const s = shown();
            if (!s) return ctx.out(fmt.dim(lib.length ? `nothing playing · ${lib.length} tracks in ${folder} (music play <search>)\n` : "nothing playing\n")), 0;
            ctx.out(`${s.playing ? fmt.green("▶") : fmt.yellow("❚❚")} ${fmt.bold(s.title)} ${fmt.dim("—")} ${s.artist}${s.album ? fmt.dim(` · ${s.album}`) : ""}\n`);
            ctx.out(fmt.dim(`${s.player} · ${clock(position())}${s.duration ? ` / ${clock(s.duration)}` : ""}${s.volume !== null ? ` · vol ${Math.round(s.volume)}%` : ""}${localActive() ? ` · ${qi + 1}/${queue.length}` : ""}\n`));
            return 0;
          }
          case "vol": case "volume": {
            if (!b) {
              await poll();
              const v = shown()?.volume;
              return ctx.out(v !== null && v !== undefined ? `${Math.round(v)}%\n` : "unknown\n"), 0;
            }
            const action = b === "+" ? "vol+" : b === "-" ? "vol-" : /^\d{1,3}%?$/.test(b) ? `vol:${parseInt(b)}` : "";
            if (!action) return ctx.err("usage: music vol 0-100 | + | -\n"), 1;
            await control(action);
            return 0;
          }
          case "play": {
            if (!arg) return await control("play"), 0;
            needLocal();
            const flags = arg.match(/^--path\s+(.+)$/);
            if (flags) {
              const p = flags[1].replace(/^["']|["']$/g, "");
              const t = byPath.get(p);
              const album = t ? tracksOf(t.album || "unknown album", t.artist || undefined).map((x) => x.path) : [p];
              await playList(album, Math.max(0, album.indexOf(p)));
            } else {
              const found = search(arg);
              if (!found.length) return ctx.err(`music: nothing matches "${arg}"${lib.length ? "" : " (empty library: music folder <path> then music scan)"}\n`), 1;
              await playList(found.map((t) => t.path));
            }
            const t = current();
            ctx.out(`${fmt.green("▶")} ${fmt.bold(t?.title ?? "")} ${fmt.dim(`— ${t?.artist ?? ""} · ${queue.length} in the queue`)}\n`);
            return 0;
          }
          case "album": case "artist": {
            needLocal();
            const { flags, rest } = ib.lib.parseFlags(more, ["from", "artist"]);
            const name = rest.join(" ").trim();
            if (!name) return ctx.err(`usage: music ${a} <name>\n`), 1;
            let tracks: LocalTrack[];
            if (a === "artist") {
              const hit = fuzzyFilter(name, artists(), (x) => x, 1)[0];
              tracks = hit ? tracksOf(undefined, hit) : [];
            } else {
              const pool = albumsOf(typeof flags.artist === "string" ? flags.artist : undefined);
              const hit = pool.find((x) => x.album.toLowerCase() === name.toLowerCase()) ?? fuzzyFilter(name, pool, (x) => `${x.album} ${x.artist}`, 1)[0];
              tracks = hit ? tracksOf(hit.album, hit.artist || undefined) : [];
            }
            if (!tracks.length) return ctx.err(`music: no ${a} "${name}"\n`), 1;
            const from = typeof flags.from === "string" ? Math.max(0, Number(flags.from) - 1) : 0;
            await playList(tracks.map((t) => t.path), Math.min(from, tracks.length - 1));
            ctx.out(`${fmt.green("▶")} ${fmt.bold(current()?.title ?? "")} ${fmt.dim(`— ${tracks[0].album} · ${tracks.length} tracks`)}\n`);
            return 0;
          }
          case "stop": {
            if (localActive() || qi >= 0) {
              await player.control("stop");
              qi = -1;
              queue = [];
              await pollLocal();
              ctx.out(fmt.dim("stopped · the controls are back on the system player\n"));
            } else await control("pause");
            return 0;
          }
          case "folder": {
            if (!arg) return ctx.out(`${folder}${lib.length ? fmt.dim(` · ${lib.length} tracks`) : ""}\n`), 0;
            folder = arg.replace(/^["']|["']$/g, "");
            await ib.storage.set("folder", folder);
            ctx.out(fmt.dim(`scanning ${folder}…\n`));
            const n = await scan();
            ctx.out(`${fmt.green("✓")} ${n} tracks · ${artists().length} artists · ${albumsOf().length} albums\n`);
            return 0;
          }
          case "scan": case "rescan": {
            needLocal();
            ctx.out(fmt.dim(`scanning ${folder}…\n`));
            const n = await scan();
            ctx.out(`${fmt.green("✓")} ${n} tracks · ${artists().length} artists · ${albumsOf().length} albums\n`);
            return 0;
          }
          case "lib": case "library": case "ls": {
            if (!lib.length) return ctx.out(fmt.dim(`empty — music folder <path> (now: ${folder})\n`)), 0;
            if (!arg) return ctx.out(`${lib.length} tracks · ${artists().length} artists · ${albumsOf().length} albums ${fmt.dim(`in ${folder}`)}\n`), 0;
            if (arg === "artists") for (const x of artists()) ctx.out(`${x} ${fmt.dim(`· ${albumsOf(x).length} albums`)}\n`);
            else if (arg === "albums") for (const x of albumsOf()) ctx.out(`${fmt.bold(x.album)} ${fmt.dim(`— ${x.artist}${x.year ? ` · ${x.year}` : ""} · ${x.n} tracks`)}\n`);
            else for (const t of search(arg).slice(0, 50)) ctx.out(`${t.title} ${fmt.dim(`— ${t.artist} · ${t.album} · ${clock(t.duration)}`)}\n`);
            return 0;
          }
          case "shuffle": {
            shuffle = b === "on" ? true : b === "off" ? false : !shuffle;
            await ib.storage.set("shuffle", shuffle);
            if (shuffle && queue.length > 1 && qi >= 0) {
              const cur = queue[qi];
              const rest = queue.filter((_, i) => i !== qi);
              for (let i = rest.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [rest[i], rest[j]] = [rest[j], rest[i]];
              }
              queue = [cur, ...rest];
              qi = 0;
            }
            ctx.out(`shuffle ${shuffle ? fmt.green("on") : "off"}\n`);
            ib.ui.redraw();
            return 0;
          }
          case "repeat": {
            const order: Repeat[] = ["off", "all", "one"];
            repeat = order.includes(b as Repeat) ? (b as Repeat) : order[(order.indexOf(repeat) + 1) % 3];
            await ib.storage.set("repeat", repeat);
            ctx.out(`repeat ${repeat}\n`);
            ib.ui.redraw();
            return 0;
          }
          case "queue": {
            if (!queue.length) return ctx.out(fmt.dim("the queue is empty\n")), 0;
            queue.slice(Math.max(0, qi - 2), qi + 15).forEach((p, k) => {
              const i = Math.max(0, qi - 2) + k;
              const t = byPath.get(p);
              ctx.out(`${i === qi ? fmt.green("▶") : " "} ${fmt.dim(String(i + 1).padStart(3))} ${t?.title ?? p} ${fmt.dim(`— ${t?.artist ?? ""}`)}\n`);
            });
            return 0;
          }
          case "seek": {
            if (!localActive()) return ctx.err("music: seek works on local tracks\n"), 1;
            const m = /^([+-])?(?:(\d+):)?(\d+)$/.exec(b ?? "");
            if (!m) return ctx.err("usage: music seek 1:30 | +10 | -10\n"), 1;
            const secs = Number(m[2] ?? 0) * 60 + Number(m[3]);
            const to = m[1] ? position() + (m[1] === "-" ? -secs : secs) : secs;
            await player.control(`seek:${Math.max(0, to)}`);
            setTimeout(() => void pollLocal(), 120);
            return 0;
          }
          case "open": ib.apps.open("music"); return 0;
          default: {
            const action = ACTIONS[a];
            if (!action) return ctx.err(`music: "${a}"? try music -h\n`), 1;
            if (!localActive() && !ib.media.available()) return ctx.err("music: needs the desktop app\n"), 1;
            await control(action);
            return 0;
          }
        }
      } catch (e) {
        ctx.err(`music: ${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      }
    },
  });

  // ── the MUSIC app: a mini iTunes, text only ──────────────────────────────
  type Col = 0 | 1 | 2;
  class MusicApp implements App {
    readonly kind = "music";
    readonly key = "music";
    private col: Col = 0;
    private sel = [0, 0, 0];
    private scroll = [0, 0, 0];
    /** "/" searches: THE field (ib.lib.Field) */
    private readonly search = new ib.lib.Field({ icon: "⌕", onChange: () => ((this.col = 2), (this.sel[2] = 0)) });
    private get query(): string {
      return this.search.text;
    }
    private typing = false;

    title() {
      return "Music";
    }
    status() {
      return `${lib.length} tracks · ${folder}`;
    }
    private artistList() {
      return ["all artists", ...artists()];
    }
    private albumList() {
      const a = this.sel[0] > 0 ? this.artistList()[this.sel[0]] : undefined;
      return albumsOf(a);
    }
    private trackList(): LocalTrack[] {
      if (this.query) return fuzzyFilter(this.query, lib, (t) => `${t.title} ${t.artist} ${t.album}`, 400);
      const al = this.albumList()[this.sel[1]];
      return al ? tracksOf(al.album, al.artist || undefined) : [];
    }
    private len(col: Col) {
      return col === 0 ? this.artistList().length : col === 1 ? this.albumList().length : this.trackList().length;
    }
    private playSel(): void {
      if (this.col === 0) {
        const a = this.artistList()[this.sel[0]];
        run(this.sel[0] === 0 ? "music play --path " + q(lib[0]?.path ?? "") : `music artist ${q(a)}`);
      } else if (this.col === 1) {
        const al = this.albumList()[this.sel[1]];
        if (al) run(`music album ${q(al.album)}${al.artist ? ` --artist ${q(al.artist)}` : ""}`);
      } else {
        const t = this.trackList()[this.sel[2]];
        if (!t) return;
        if (this.query) run(`music play --path ${q(t.path)}`);
        else {
          const al = this.albumList()[this.sel[1]];
          run(`music album ${q(al.album)}${al.artist ? ` --artist ${q(al.artist)}` : ""} --from ${this.sel[2] + 1}`);
        }
      }
    }

    onText(t: string): boolean {
      if (this.typing) {
        if (/^[\r\n]+$/.test(t)) return (this.typing = false), true;
        return this.search.onText(t);
      }
      switch (t) {
        case "/": this.typing = true; this.search.clear(); return true;
        case " ": run("music toggle"); return true;
        case "n": run("music next"); return true;
        case "p": run("music prev"); return true;
        case "s": run("music shuffle"); return true;
        case "r": run("music repeat"); return true;
        case "+": case "=": run("music vol +"); return true;
        case "-": run("music vol -"); return true;
        case "x": run("music stop"); return true;
        case "f": void this.pickFolder(); return true;
        default: return false;
      }
    }
    onKey(k: KeyInput): boolean {
      if (this.typing) {
        if (k.combo === "esc") return (this.typing = false), this.search.clear(), true;
        if (k.combo === "enter") return (this.typing = false), true;
        return this.search.onKey(k) || k.combo.length === 1;
      }
      if (k.combo === "esc" && this.query) return this.search.clear(), true;
      if (k.combo === "tab") return (this.col = ((this.col + 1) % 3) as Col), true;
      if (k.combo === "shift+tab") return (this.col = ((this.col + 2) % 3) as Col), true;
      if (k.combo === "left" && this.col > 0) return (this.col = (this.col - 1) as Col), true;
      if (k.combo === "right" && this.col < 2) return (this.col = (this.col + 1) as Col), true;
      return false;
    }
    onAction(a: Action): boolean {
      const n = this.len(this.col);
      const move = (d: number) => {
        this.sel[this.col] = Math.max(0, Math.min(n - 1, this.sel[this.col] + d));
        if (this.col === 0) this.sel[1] = this.sel[2] = 0;
        if (this.col === 1) this.sel[2] = 0;
      };
      switch (a) {
        case "up": move(-1); return true;
        case "down": move(1); return true;
        case "page-up": move(-10); return true;
        case "page-down": move(10); return true;
        case "confirm": this.playSel(); return true;
        default: return false;
      }
    }
    private async pickFolder(): Promise<void> {
      // the deck's file browser (cancelled: nothing changes; `music folder <path>` types it)
      const v = await ib.ui.pickFolder("YOUR MUSIC FOLDER", folder || undefined);
      if (v?.trim()) run(`music folder ${q(v.trim())}`);
    }

    render(ui: UI, r: Rect, focused: boolean): void {
      const c = ui.c;
      if (!lib.length) {
        const y = r.y + Math.floor(r.h / 2) - 2;
        ui.textCenter(r, y, scanning ? `${ui.spinner()} reading ${folder}…` : "no music yet", { fg: c.muted, attrs: BOLD });
        if (!scanning) {
          ui.textCenter(r, y + 1, `folder: ${folder}`, { fg: c.faint });
          const bx = r.x + Math.floor(r.w / 2) - 12;
          ui.button(bx, y + 3, "scan", () => run("music scan"), { cmd: "music scan" });
          ui.button(bx + 9, y + 3, "choose folder", () => void this.pickFolder(), { tip: "f · music folder <path>" });
        } else ui.animate(100);
        return;
      }
      // search line
      const sy = r.y;
      const sbg = c.panelAlt;
      ui.fill({ x: r.x + 1, y: sy, w: r.w - 2, h: 1 }, { bg: sbg });
      this.search.render(ui, { x: r.x + 1, y: sy, w: r.w - 30, h: 1 }, { focused: this.typing && focused, active: this.typing, bg: sbg, placeholder: this.typing ? "" : "search  (/)" });
      ui.hit({ x: r.x + 1, y: sy, w: r.w - 30, h: 1 }, { onClick: () => ((this.typing = true), this.search.clear()), tip: "search titles, artists, albums" });
      ui.textRight(r.x + r.w - 2, sy, `${lib.length} tracks · ${scanning ? "scanning…" : folder}`, { fg: c.faint, bg: sbg });

      // three columns + now playing bar
      const barH = 3;
      const top = sy + 2;
      const h = r.h - (top - r.y) - barH;
      const w0 = Math.floor((r.w - 2) * 0.24), w1 = Math.floor((r.w - 2) * 0.3);
      const cols: { x: number; w: number; title: string; items: string[]; hints: string[] }[] = [
        { x: r.x + 1, w: w0, title: "ARTISTS", items: this.artistList(), hints: [] },
        { x: r.x + 2 + w0, w: w1, title: "ALBUMS", items: this.albumList().map((a) => a.album), hints: this.albumList().map((a) => (a.year ? String(a.year) : "")) },
        { x: r.x + 3 + w0 + w1, w: r.w - w0 - w1 - 4, title: this.query ? "RESULTS" : "TRACKS", items: this.trackList().map((t) => t.title), hints: this.trackList().map((t) => (this.query ? `${t.artist} · ${clock(t.duration)}` : clock(t.duration))) },
      ];
      const playing = local?.path ?? "";
      const tracks = this.trackList();
      cols.forEach((col, ci) => {
        const on = this.col === ci;
        ui.text(col.x, top - 1, col.title, { fg: on && focused ? c.accent : c.subtle, attrs: BOLD });
        if (ci > 0) ui.vline(col.x - 1, top - 1, h + 1, { fg: c.border });
        const viewH = h;
        const sel = this.sel[ci];
        if (sel < this.scroll[ci]) this.scroll[ci] = sel;
        if (sel >= this.scroll[ci] + viewH) this.scroll[ci] = sel - viewH + 1;
        const s0 = this.scroll[ci];
        col.items.slice(s0, s0 + viewH).forEach((label, k) => {
          const i = s0 + k;
          const y = top + k;
          const row = { x: col.x, y, w: col.w, h: 1 };
          const isSel = i === sel;
          const bg = isSel ? (on && focused ? mix(c.accent, c.bg, 0.72) : c.highlight) : ui.hovered(row) ? c.panelAlt : -1;
          if (bg !== -1) ui.fill(row, { bg });
          const st = bg !== -1 ? { bg } : {};
          const isPlaying = ci === 2 && tracks[i]?.path === playing;
          const num = ci === 2 && !this.query ? `${String(tracks[i]?.track || i + 1).padStart(2)} ` : "";
          const lx = ui.text(col.x + 1, y, isPlaying ? (local?.playing ? "▶ " : "❚❚") : num, { fg: isPlaying ? c.accent : c.faint, ...st });
          const hint = col.hints[i] ?? "";
          const hx = hint ? ui.textRight(col.x + col.w - 1, y, hint, { fg: c.faint, ...st }) : col.x + col.w;
          ui.text(isPlaying ? lx + 1 : lx, y, label, { fg: isPlaying ? c.accent : isSel ? c.fg : c.muted, attrs: isSel || isPlaying ? BOLD : 0, ...st }, hx - lx - 2);
          ui.hit(row, {
            onClick: () => {
              this.col = ci as Col;
              this.sel[ci] = i;
              if (ci === 0) this.sel[1] = this.sel[2] = 0;
              if (ci === 1) this.sel[2] = 0;
            },
            onDouble: () => {
              this.col = ci as Col;
              this.sel[ci] = i;
              this.playSel();
            },
            tip: "double-click / enter: play",
          });
        });
        ui.hit({ x: col.x, y: top, w: col.w, h: viewH }, {
          onWheel: (d) => (this.scroll[ci] = Math.max(0, Math.min(Math.max(0, col.items.length - viewH), this.scroll[ci] + d))),
        });
      });

      // now playing
      const by = r.y + r.h - barH;
      ui.hline(r.x + 1, by, r.w - 2, { fg: c.border });
      const s = localStatus();
      const t = current();
      if (s && t) {
        ui.text(r.x + 2, by + 1, s.playing ? "▶" : "❚❚", { fg: c.accent, attrs: BOLD });
        ui.text(r.x + 5, by + 1, t.title, { fg: c.fg, attrs: BOLD }, Math.floor(r.w / 2));
        ui.text(r.x + 5, by + 2, `${t.artist} · ${t.album}`, { fg: c.muted }, Math.floor(r.w / 2));
        const pw = Math.max(10, Math.floor(r.w * 0.3));
        const px = r.x + r.w - pw - 14;
        const pos = position();
        const ratio = s.duration ? pos / s.duration : 0;
        ui.text(px - 6, by + 1, clock(pos).padStart(5), { fg: c.subtle });
        ui.bar(px, by + 1, pw, ratio);
        ui.text(px + pw + 1, by + 1, clock(s.duration), { fg: c.subtle });
        ui.hit({ x: px, y: by + 1, w: pw, h: 1 }, { onClick: (m) => run(`music seek ${Math.floor(((m.x - px) / pw) * s.duration)}`), tip: "click to jump · music seek 1:30" });
        if (ui.now) ui.animate(250);
      } else ui.text(r.x + 2, by + 1, "nothing playing · enter plays the selection", { fg: c.faint });
      // controls
      let cx = r.x + r.w - 46;
      // THE button; a mode that's on (shuffle, repeat) in the accent, the rest quiet
      const ctl = (label: string, cmd: string, tip: string, on = false) => (cx += ui.button(cx, by + 2, label, () => {}, { cmd, tip, quiet: !on }) + 1);
      ctl("|◀◀", "music prev", "p");
      ctl(s?.playing ? "❚❚" : "▶", "music toggle", "space");
      ctl("▶▶|", "music next", "n");
      ctl("shuffle", "music shuffle", "s", shuffle);
      ctl(`repeat ${repeat}`, "music repeat", "r", repeat !== "off");
      ctl("−", "music vol -", "-");
      ctl("+", "music vol +", `+ · volume ${Math.round(local?.volume ?? 80)}%`);
    }
  }

  ib.apps.register({
    kind: "music",
    title: "Music",
    description: "your music folder: artists, albums, tracks (no cover art)",
    icon: "♪",
    launcher: true,
    create: () => new MusicApp(),
  });
  ib.palette.register({ id: "music.open", title: "Music library", group: "music", run: () => run("music open") });

  // ── the widget ──

  const BARS = " ▁▂▃▄▅▆▇█";

  ib.widgets.register({
    id: "now",
    title: "music",
    description: "what's playing (Spotify, Music…) with play / pause / skip",
    size: { w: 4, h: 4 },
    min: { w: 2, h: 2 },
    render(ui, r) {
      const c = ui.c;
      if (!ib.media.available() && !localActive()) return void ui.text(r.x + 1, r.y, "music needs the desktop app", { fg: c.muted }, r.w - 2);
      if (!localActive() && Date.now() - polledAt > (shown()?.playing ? 2000 : 4000)) void poll();
      const status = shown();
      ui.animate(status?.playing ? 120 : 1000);
      if (error && !localActive()) {
        ui.text(r.x + 1, r.y, `⚠ ${error}`, { fg: c.error }, r.w - 2);
        if (r.h > 1) ui.text(r.x + 1, r.y + 1, "enter: retry", { fg: c.faint });
        return;
      }
      if (!status && loading && !at) return void ui.textCenter(r, r.y + Math.floor((r.h - 1) / 2), `${ui.spinner()} listening…`, { fg: c.muted });
      // nothing playing: the same widget (buttons included), "nothing playing" where the title goes
      const idle = !status;
      const s: MediaStatus = status ?? { player: "music", playing: false, title: "nothing playing", artist: lib.length ? `${lib.length} tracks · ▶ plays your library` : "Spotify, Music, or: music folder <path>", album: "", position: 0, duration: 0, volume: null };
      const w = r.w - 2;
      const x0 = r.x + 1;
      // what fits, top to bottom: header, title, artist, progress, controls
      const rows = r.h >= 5 ? ["head", "title", "artist", "progress"] : r.h === 4 ? ["head", "title", "progress"] : r.h === 3 ? ["mini", "progress"] : r.h === 2 ? ["mini"] : [];
      let y = r.y + Math.max(0, Math.floor((r.h - rows.length - 1) / 2));

      const title = s.title || "—";
      const marquee = (text: string, room: number) => {
        if (strWidth(text) <= room) return text;
        const loop = [...`${text}     ·     `];
        const off = Math.floor(ui.now / 220) % loop.length;
        return [...loop.slice(off), ...loop.slice(0, off)].join("");
      };
      const eq = 7;
      const drawEq = (ex: number, ey: number) => {
        for (let i = 0; i < eq; i++) {
          const v = s.playing ? (Math.sin(ui.now / (140 + i * 37) + i * 1.7) + Math.sin(ui.now / (230 + i * 19) + i)) / 4 + 0.5 : 0.08;
          ui.text(ex + i, ey, BARS[Math.max(1, Math.min(8, Math.round(v * 8)))], { fg: i % 2 ? c.accent : c.accentAlt });
        }
      };

      for (const row of rows) {
        if (row === "head") {
          ui.text(x0, y, `♪ ${s.player.toLowerCase()}`, { fg: c.accentAlt });
          if (w > 16) drawEq(x0 + w - eq, y);
        } else if (row === "title") ui.text(x0, y, marquee(title, w), { fg: idle ? c.muted : c.fg, attrs: idle ? 0 : BOLD }, w);
        else if (row === "artist") ui.text(x0, y, [s.artist, s.album].filter(Boolean).join(" · "), { fg: idle ? c.faint : c.muted }, w);
        else if (row === "mini") {
          ui.text(x0, y, "♪", { fg: c.accentAlt });
          ui.text(x0 + 2, y, marquee(`${title} — ${s.artist}`, w - 2), { fg: c.fg, attrs: BOLD }, w - 2);
        } else if (row === "progress") {
          if (s.duration > 0) {
            const pos = position();
            const left = clock(pos), right = clock(s.duration);
            const bw = Math.max(4, w - left.length - right.length - 2);
            const filled = Math.round((pos / s.duration) * bw);
            ui.text(x0, y, left, { fg: c.subtle });
            const bx = x0 + left.length + 1;
            ui.text(bx, y, "━".repeat(Math.max(0, filled)), { fg: c.accent });
            if (filled < bw) ui.text(bx + filled, y, filled > 0 ? "╸" : "─", { fg: c.accent });
            ui.text(bx + filled + 1, y, "─".repeat(Math.max(0, bw - filled - 1)), { fg: c.faint });
            ui.text(bx + bw + 1, y, right, { fg: c.subtle });
          } else ui.text(x0, y, idle ? "" : s.playing ? "playing" : "paused", { fg: c.subtle });
        }
        y++;
      }

      // controls · volume
      const cy = Math.min(r.y + r.h - 1, y);
      const btns: [string, string, string][] = [
        ["|◀◀", "music prev", "previous"],
        [s.playing ? " ❚❚ " : " ▶ ", "music toggle", s.playing ? "pause" : "play"],
        ["▶▶|", "music next", "next"],
      ];
      const total = btns.reduce((n, [l]) => n + strWidth(l) + 3, -3);
      let bx = x0 + Math.max(0, Math.floor((w - total) / 2) - (w > 30 && s.volume !== null ? 6 : 0));
      for (const [label, cmd, tip] of btns) {
        const rect = { x: bx, y: cy, w: strWidth(label), h: 1 };
        const hot = ui.hovered(rect);
        ui.text(bx, cy, label, { fg: hot ? c.panel : cmd === "music toggle" ? c.accent : c.fg, bg: hot ? c.accent : undefined, attrs: BOLD });
        ui.hit(rect, { cmd, tip });
        bx += strWidth(label) + 3;
      }
      if (w > 30 && s.volume !== null) {
        const n = 5;
        const lv = Math.round((s.volume / 100) * n);
        const vx = x0 + w - (n + 4);
        ui.text(vx, cy, "−", { fg: c.subtle });
        ui.hit({ x: vx, y: cy, w: 1, h: 1 }, { cmd: "music vol -", tip: `volume ${Math.round(s.volume)}%` });
        ui.text(vx + 2, cy, "▮".repeat(lv) + "▯".repeat(n - lv), { fg: c.accent });
        ui.text(vx + n + 3, cy, "+", { fg: c.subtle });
        ui.hit({ x: vx + n + 3, y: cy, w: 1, h: 1 }, { cmd: "music vol +", tip: `volume ${Math.round(s.volume)}%` });
      }
    },
    activate: () => {
      if (error) {
        error = null;
        void poll();
      } else if (!shown() && lib.length) run("music open");
      else run("music toggle");
    },
    open: "music open",
    popup: {
      title: "music",
      size: { w: 66, h: 17 },
      hint: "space ▶❚❚ · n p · + - volume · s shuffle · r repeat",
      render(ui, r) {
        const c = ui.c;
        const s = shown();
        const playing = !!s?.playing;
        ui.animate(playing ? 33 : 500);
        const w = r.w - 4, x0 = r.x + 2;
        if (!s) {
          ui.textCenter(r, r.y + 3, "♪", { fg: c.accent, attrs: BOLD });
          ui.textCenter(r, r.y + 5, lib.length ? `nothing playing · ${lib.length} tracks in ${folder}` : "nothing playing", { fg: c.muted });
          ui.textCenter(r, r.y + 6, lib.length ? "enter: your library" : "music folder <path> · or play something in Spotify / Music", { fg: c.faint });
          return;
        }
        // source · title · artist
        ui.text(x0, r.y, s.player.toUpperCase(), { fg: c.accentAlt, attrs: BOLD }, w);
        ui.gradientText(x0, r.y + 1, (s.title || "—").slice(0, w), ui.theme.gradient, BOLD, (ui.now / 6000) % 1);
        ui.text(x0, r.y + 2, [s.artist, s.album].filter(Boolean).join("  ·  "), { fg: c.muted }, w);
        // a spectrum: smooth bars, alive while it plays
        const bars = " ▁▂▃▄▅▆▇█";
        const rows = 4, top = r.y + 4;
        for (let i = 0; i < w; i++) {
          const f = i / w;
          const v = playing
            ? 0.18 + 0.82 * Math.abs(Math.sin(ui.now / (210 + (i % 7) * 23) + i * 0.6) * Math.sin(ui.now / 530 + f * 4.2)) * (1 - f * 0.45)
            : 0.06;
          const level = v * rows * 8;
          const col = mix(ui.theme.gradient[0] ?? c.accent, ui.theme.gradient[ui.theme.gradient.length - 1] ?? c.accentAlt, f);
          for (let k = 0; k < rows; k++) {
            const fill = Math.max(0, Math.min(8, Math.round(level - (rows - 1 - k) * 8)));
            if (fill) ui.text(x0 + i, top + k, bars[fill], { fg: k === 0 ? mix(col, 0xffffff, 0.25) : col });
          }
        }
        // progress with a knob
        const py = top + rows + 1;
        if (s.duration) {
          const pos = position();
          const bw = w - 14;
          const k = Math.round((pos / s.duration) * (bw - 1));
          ui.text(x0, py, clock(pos).padStart(5), { fg: c.subtle });
          ui.text(x0 + 7, py, "━".repeat(k), { fg: c.accent });
          ui.text(x0 + 7 + k, py, "●", { fg: mix(c.accent, 0xffffff, 0.3), attrs: BOLD });
          ui.text(x0 + 8 + k, py, "─".repeat(Math.max(0, bw - 1 - k)), { fg: c.faint });
          ui.text(x0 + 8 + bw, py, clock(s.duration), { fg: c.subtle });
          if (localActive()) ui.hit({ x: x0 + 7, y: py, w: bw, h: 1 }, { onClick: (m) => run(`music seek ${Math.floor(((m.x - x0 - 7) / bw) * s.duration)}`), tip: "click to jump" });
        }
        // controls, centred
        const cy = py + 2;
        const ctl: [string, string, boolean][] = [
          ...(localActive() || qi >= 0 ? ([["⤮", "music shuffle", shuffle]] as [string, string, boolean][]) : []),
          ["⏮", "music prev", false],
          [playing ? "❚❚" : "▶", "music toggle", true],
          ["⏭", "music next", false],
          ...(localActive() || qi >= 0 ? ([[repeat === "one" ? "⟲¹" : "⟲", "music repeat", repeat !== "off"]] as [string, string, boolean][]) : []),
        ];
        const total = ctl.reduce((n, [l]) => n + strWidth(l) + 4, -2);
        let cx = r.x + Math.floor((r.w - total) / 2);
        for (const [label, cmd, on] of ctl) {
          const lw = strWidth(label) + 2;
          const rect = { x: cx, y: cy, w: lw, h: 1 };
          const hot = ui.hovered(rect);
          const big = cmd === "music toggle";
          ui.text(cx, cy, ` ${label} `, hot || big ? { fg: c.panel, bg: hot ? c.accentAlt : c.accent, attrs: BOLD } : { fg: on ? c.accent : c.muted, attrs: on ? BOLD : 0 });
          ui.hit(rect, { cmd, tip: cmd });
          cx += lw + 2;
        }
        // volume
        if (s.volume !== null) {
          const vy = cy + 2, n = 20, lv = Math.round((s.volume / 100) * n);
          const vx = r.x + Math.floor((r.w - n - 8) / 2);
          ui.text(vx, vy, "−", { fg: c.subtle });
          ui.hit({ x: vx, y: vy, w: 1, h: 1 }, { cmd: "music vol -" });
          for (let i = 0; i < n; i++) ui.text(vx + 2 + i, vy, i < lv ? "▮" : "▯", { fg: i < lv ? mix(c.accent, c.accentAlt, i / n) : c.faint });
          ui.text(vx + n + 3, vy, "+", { fg: c.subtle });
          ui.hit({ x: vx + n + 3, y: vy, w: 1, h: 1 }, { cmd: "music vol +" });
          ui.text(vx + n + 5, vy, `${Math.round(s.volume)}%`, { fg: c.faint });
        }
        // up next
        if (queue.length && qi >= 0 && r.h > 14) {
          const next = queue.slice(qi + 1, qi + 1 + (r.h - 14));
          if (next.length) {
            ui.text(x0, cy + 4, "UP NEXT", { fg: c.subtle, attrs: BOLD });
            next.forEach((p, k) => {
              const tr = byPath.get(p);
              ui.text(x0 + 9, cy + 4 + k, tr?.title ?? p, { fg: c.muted }, w - 30);
              ui.textRight(x0 + w, cy + 4 + k, tr?.artist ?? "", { fg: c.faint });
            });
          }
        }
      },
      onText: (t) => {
        const map: Record<string, string> = { " ": "music toggle", n: "music next", p: "music prev", "+": "music vol +", "=": "music vol +", "-": "music vol -", s: "music shuffle", r: "music repeat" };
        if (!map[t]) return false;
        run(map[t]);
        return true;
      },
    },
  });
}

export function deactivate(): void {
  if (tick) clearInterval(tick);
  tick = null;
}
