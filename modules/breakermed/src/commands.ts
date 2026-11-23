/**
 * breakerMED — the `med` command: the source of truth. The page runs these
 * (the LOG shows them), and so can keys, macros, scripts and THE MENU.
 */
import type { IcebreakerAPI, ShellContext } from "./icebreaker";
import type { Engine } from "./engine";
import { readSong, SONG_EXTS } from "./format";
import { demoMod } from "./demo";
import { readBmed, writeBmed } from "./format/bmed";
import { chipSong, templateSong } from "./template";
import { checkFormat, describe, encode, encodeLossy, encoderProblem, extOf, formatOf, isLossy, renderSong, trackUsed } from "./export";
import { bounce, sampleCommand, SAMPLE_USAGE } from "./commands-sample";
import { SYNTHS } from "./synths";
import { drumsCommand, DRUMS_USAGE, synthCommand, SYNTH_USAGE } from "./commands-synth";
import { writeMed, writeMod } from "./format/write";
import { songLength } from "./replayer";
import { invertChord, MAX_STRUM_MS, swingFactor } from "./song";
import { chordsOf, cleanEcho, DEFAULT_TRACKS, ECHO_MAX_MS, MAX_CHORD_NOTES, hex, lineNo, MAX_TRACKS, newSong, noteName, trackName, type Song } from "./song";
import { CHORD_COL, CMD_COL, Editor, parseNote } from "./edit";
import { undoRedo, type State } from "./app";
import { EFFECTS, GUIDE } from "./guide";
import { findPack, PACK, PACK_DIR } from "./pack";
import { placeholderFor } from "./placeholder";
import { RECOVERY_DIR, type Recovery } from "./autosave";
import { SCREENS, type Screen } from "./screens";


export function registerCommands(ib: IcebreakerAPI, engine: Engine, st: State): void {
  const { fmt, parseFlags, t } = ib.lib;

  // the module sees only songs/ (its permissions: vault:read:songs/, vault:write:songs/)
  const find = async (dir = "songs", depth = 0, out: string[] = []): Promise<string[]> => {
    if (depth > 5 || out.length > 500) return out;
    for (const e of await ib.vault.list(dir).catch(() => [])) {
      if (e.isDir) {
        if (e.name.toLowerCase().endsWith(".bmed")) out.push(e.path);
        else if (!e.name.startsWith(".")) await find(e.path, depth + 1, out);
      } else if (SONG_EXTS.some((x) => e.name.toLowerCase().endsWith(x) || e.name.toLowerCase().startsWith(x.slice(1) + "."))) out.push(e.path);
    }
    return out;
  };

  const open = async (ctx: ShellContext, path: string, given?: Uint8Array) => {
    const p = path.replace(/\/+$/, "").replace(/\/song\.json$/i, "");
    // the autosave kept changes that were never saved: offer them back
    const rec = given ? undefined : await st.autosave?.find(p);
    if (rec) {
      const when = new Date(rec.at).toLocaleString();
      const pick = await ib.ui.choose(`${p}: ${t("changes never saved")} (${t("autosaved")} ${when})`, [
        { label: t("recover them (the autosaved version)") },
        { label: t("open the saved file, keep the autosaved copy for later") },
        { label: t("open the saved file, throw the changes away") },
      ]);
      if (pick === null) return;
      if (pick === 0) return recover(ctx, rec);
      if (pick === 2) await st.autosave?.forget(p);
    }
    if (!given && /\.bmed$/i.test(p)) {
      // our own format: a folder, its song.json and its samples
      const song = await readBmed(await ib.vault.read(`${p}/song.json`), (f) => ib.vault.readBytes(`${p}/${f}`));
      await adopt(ctx, song, p);
    } else await adopt(ctx, readSong(given ?? (await ib.vault.readBytes(p)), p), p);
    if (!given) await ib.storage.set("last", p);
  };

  /** Save the song: our own format (.bmed, a folder: everything), or .mod / .med for other trackers. */
  const save = async (ctx: ShellContext, path: string) => {
    const s = need();
    const p = path.replace(/\/+$/, "");
    let warnings: string[] = [];
    if (/\.mod$/i.test(p) || /(^|\/)mod\.[^/]+$/i.test(p)) ({ warnings } = await writeOut(p, writeMod(s)));
    else if (/\.(med|mmd1)$/i.test(p)) ({ warnings } = await writeOut(p, writeMed(s)));
    else {
      const dir = /\.bmed$/i.test(p) ? p : `${p}.bmed`;
      await ib.vault.mkdir(`${dir}/samples`).catch(() => {});
      for (const f of writeBmed(s)) {
        if (typeof f.data === "string") await ib.vault.write(`${dir}/${f.path}`, f.data);
        else await ib.vault.writeBytes(`${dir}/${f.path}`, f.data);
      }
      const was = st.path;
      st.path = dir;
      st.editor!.dirty = false;
      st.savedAt = Date.now();
      ib.ui.notify(`saved · ${dir}`, "success");
      // saved: the autosave's copies of it are no use now
      await st.autosave?.forget(was);
      await st.autosave?.forget(dir);
      ctx.out(`${fmt.green("✓")} ${dir}/ (song.json + samples)\n`);
      return;
    }
    for (const w of warnings) ctx.out(`${fmt.dim("  ⚠ " + w)}\n`);
    ib.ui.notify(`saved · ${p}${warnings.length ? " (for other trackers: .bmed keeps everything)" : ""}`, "success");
    ctx.out(`${fmt.green("✓")} ${p}${warnings.length ? fmt.dim(" — for other trackers; .bmed keeps everything") : ""}\n`);
  };
  const writeOut = async (path: string, w: { bytes: Uint8Array; warnings: string[] }) => {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (dir) await ib.vault.mkdir(dir).catch(() => {});
    await ib.vault.writeBytes(path, w.bytes);
    return w;
  };
  /** where a song is saved when you don't say: next to where it came from, as .bmed */
  const defaultPath = () => {
    // always in songs/: the only folder the module may write (a new song, the demo: songs/<name>.bmed)
    const inSongs = st.path.startsWith("songs/");
    if (inSongs && /\.bmed$/i.test(st.path)) return st.path;
    const base = (st.path.split("/").pop() || "untitled").replace(/\.(med|mod|mmd\d|bmed)$/i, "").replace(/^(mod|med)\./i, "") || "untitled";
    const dir = inSongs ? st.path.slice(0, st.path.lastIndexOf("/")) : "songs";
    return `${dir}/${base}.bmed`;
  };

  /** is there a song (a .bmed folder) or a file at this path already */
  const exists = async (path: string): Promise<boolean> => {
    const p = path.replace(/\/+$/, "");
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const name = p.slice(dir ? dir.length + 1 : 0);
    const list = await ib.vault.list(dir).catch(() => []);
    return list.some((e) => e.name === name);
  };
  /** where `med save` writes: .bmed unless .mod / .med is said */
  const savedAs = (p: string) => (/\.(mod|med|mmd1|bmed)$/i.test(p) || /(^|\/)mod\.[^/]+$/i.test(p) ? p : `${p}.bmed`);
  /** the song has a file of its own (saved, or opened from songs/) */
  const hasHome = () => st.path.startsWith("songs/");
  /** a name for a song never saved: its title, or untitled — and a free one ("untitled 2") */
  const freeName = async () => {
    const base = defaultPath().replace(/\.bmed$/i, "");
    const titled = st.song?.title && st.song.title !== "untitled" ? `songs/${st.song.title.replace(/[\\/:*?"<>|]/g, "-")}` : base;
    for (let n = 1; n < 100; n++) {
      const p = `${titled}${n > 1 ? ` ${n}` : ""}.bmed`;
      if (!(await exists(p))) return p;
    }
    return `${titled}.bmed`;
  };
  /**
   * Save, never over another song without a yes: a song with no file asks for a
   * name (save as…); a path that holds another song asks before replacing it.
   * 0: saved · 1: not saved (cancelled, said in the LOG).
   */
  const saveSafely = async (ctx: ShellContext, given: string | null, o: { ask?: boolean; force?: boolean } = {}): Promise<number> => {
    need();
    let path = given;
    if (!path && !o.ask && hasHome()) path = defaultPath();
    if (!path) {
      const name = await ib.ui.prompt(t("save as"), { initial: await freeName(), placeholder: t("songs/my song.bmed (or .mod, .med)") });
      if (name === null || !name.trim()) return ctx.err("med save: not saved (no name given)\n"), 1;
      const p = name.trim();
      path = p.startsWith("songs/") ? p : `songs/${p.replace(/^\/+/, "")}`;
    }
    const target = savedAs(path);
    if (!o.force && target !== st.path && (await exists(target))) {
      const pick = await ib.ui.choose(`${target}: ${t("already there — replace it with this song?")}`, [{ label: t("replace it") }, { label: t("cancel: keep it") }], { selected: 1 });
      if (pick !== 0) return ctx.err(`med save: not saved (${target} kept)\n`), 1;
    }
    await save(ctx, path);
    return 0;
  };

  /**
   * Before another song takes the page: a song with changes asks first (save /
   * don't save / cancel). The autosave writes its copy first, whatever is chosen.
   * true: go on.
   */
  const mayReplace = async (ctx: ShellContext, what: string, force: boolean): Promise<boolean> => {
    if (!st.song || !st.editor?.dirty) return true;
    await st.autosave?.flush();
    if (force) return true;
    // a song never saved has no file name worth saying (every new one is "untitled.bmed")
    const name = !hasHome() ? "this new song" : `“${st.song.title && st.song.title !== "untitled" ? st.song.title : st.path.split("/").pop()}”`;
    const pick = await ib.ui.choose(`${hasHome() ? name : t(name)}: ${t("changes not saved")}`, [
      { label: t("save them first") },
      // the copy is said only when the autosave is on (0.12.2)
      { label: st.autosave?.on ? t("don't save (the autosave keeps a copy: med recover)") : t("don't save") },
      { label: t("cancel: keep the song") },
    ]);
    if (pick === 0) return (await saveSafely(ctx, null)) === 0;
    if (pick === 1) return true;
    ctx.err(`med ${what}: ${name} has changes that aren't saved — kept (med save first, or med ${what} --force)\n`);
    return false;
  };

  /** this song is the one on the page now */
  const adopt = async (ctx: ShellContext, song: Song, path: string) => {
    st.song = song;
    st.home = false;
    st.editor = new Editor(song);
    // each step of the history: the page again, and a copy soon (the autosave)
    st.editor.onChange = () => (ib.ui.redraw(), st.autosave?.changed());
    st.autosave?.reset();
    st.savedAt = 0;
    st.sel = null;
    st.col = 0;
    st.path = path;
    st.seq = st.line = st.track = 0;
    st.inst = Math.max(0, song.instruments.findIndex((i) => i.kind !== "empty"));
    st.error = "";
    await engine.load(song);
    const len = songLength(song);
    const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
    ctx.out(`${fmt.green("♫")} ${song.title || path}${/\.bmed$/i.test(path) ? "" : ` · ${song.format}`} · ${n(song.tracks, "track")} · ${n(song.blocks.length, "block")} · ${n(song.sequence.length, "position")} · ${song.instruments.filter((i) => i.kind !== "empty").length} instruments · ${Math.floor(len.seconds / 60)}:${String(Math.floor(len.seconds % 60)).padStart(2, "0")}\n`);
  };

  /** an autosaved copy on the page, as the song it's a copy of (unsaved: ● until med save) */
  const recover = async (ctx: ShellContext, rec: Recovery) => {
    const song = await st.autosave!.read(rec);
    await adopt(ctx, song, rec.path);
    st.editor!.dirty = true;
    ctx.out(`${fmt.green("↺")} recovered the autosaved ${rec.title} (${new Date(rec.at).toLocaleString()}) · med save keeps it\n`);
  };

  /** the pack's sounds that are in the vault (their files, under PACK_DIR) */
  const packHave = async () => {
    const out = new Set<string>();
    for (const dir of new Set(PACK.map((p) => p.file.split("/")[0])))
      for (const e of await ib.vault.list(`${PACK_DIR}/${dir}`).catch(() => [])) if (!e.isDir) out.add(`${dir}/${e.name}`);
    return out;
  };

  /** a track the user typed (from 1): its index, or why it isn't one */
  const trackArg = (s: Song, v: string | undefined): number | string => {
    const n = parseInt(v ?? "", 10);
    if (!/^\d+$/.test(v ?? "")) return `a track is 1–${s.tracks}`;
    return n >= 1 && n <= s.tracks ? n - 1 : `track ${n}: the song has ${s.tracks}`;
  };
  const posArg = (s: Song, v: string | undefined): number | string => {
    const n = parseInt(v ?? "", 16);
    return /^[0-9a-f]+$/i.test(v ?? "") && n < s.sequence.length ? n : `position ${(v ?? "?").toUpperCase().padStart(2, "0")}: the sequence has ${hex(0)}–${hex(s.sequence.length - 1)}`;
  };
  const blockArg = (s: Song, v: string | undefined): number | string => {
    const n = parseInt(v ?? "", 16);
    return /^[0-9a-f]+$/i.test(v ?? "") && n < s.blocks.length ? n : `block ${(v ?? "?").toUpperCase().padStart(3, "0")}: the song has ${hex(0, 3)}–${hex(s.blocks.length - 1, 3)}`;
  };
  /** the sequence, one position a line, the cursor's marked */
  const seqList = (s: Song) =>
    `${fmt.dim("pos  block")}\n${s.sequence.map((b, i) => `${i === st.seq ? "▸" : " "}${hex(i)}  ${hex(b, 3)}${s.blocks[b]?.name ? ` ${s.blocks[b].name}` : ""}`).join("\n")}\n`;

  const need = (): Song => {
    if (!st.song) throw new Error("no song loaded (med new · med open <file> · med demo)");
    return st.song;
  };

  ib.commands.register({
    name: "med",
    summary: "breakerMED: a tracker for .med (OctaMED) and .mod (ProTracker) songs",
    usage: [
      "med                        what's loaded, where it is",
      "med open [file]            a .med / .mod / .bmed in songs/ (no file: choose one)",
      "med ls                     the songs in the vault",
      "med demo                   a little song of ours, to try it right away",
      "med new [tracks] [--empty] [--force] a new song: 8 named tracks (up to 16), drums, synths and a first bar · --empty: a blank page",
      "med new --chip             a chiptune song: 2 pulses, a triangle, a noise (NES-style), chip instruments, a bar",
      "                           (new, open, demo: a song with changes asks first · --force: replace it, the autosave keeps a copy)",
      "med saveas                 save as… (a name asked in a window) · ⌘S saves, ⌘⇧S saves as on the page",
      "                           never over another song without asking (--force: no question) · a new song asks for its name",
      "med continue               back to the song in memory (after the page was closed)",
      "med save [file]            .bmed (ours: a folder, keeps everything — the default), .mod or .med (for other trackers)",
      "med export [file.wav|.aif|.flac] [--rate 48000] [--bits 16|24|32] [--stems | --only-stems | --tracks 1,3] [--normalize] [--tail 1.5]",
      "med export file.mp3|.m4a|.ogg|.opus [--quality …]   through the deck's encoder pack (encoders install, once)",
      "med track <n> name <text> · med track <n> vol <0–64> · med track <n> pan <-100–100> · med track <n> strum <0–200 ms>",
      "med play [song|block] [position] [line]",
      "med stop",
      "med pos <position> [line] [track]   move the cursor (and where play starts)",
      "med mute <track> · med solo <track>   (again: back)",
      "med paula on|off           stepped like the Amiga (on), or smooth",
      "med edit on|off            typing writes in the block (space on the page)",
      "med view center|edges      the block's view: the cursor's line in the middle (the default), or scrolling at the edges",
      "med follow on|off          while playing, the cursor follows the song (off: it stays where you edit · alt F)",
      "med click on|off           the metronome: a click on each beat while playing",
      "med step <0–16>            lines the cursor moves after a note (alt 0–9 on the page)",
      "med octave <1–8> · med ins <01–3F>   the octave and the instrument the keys play",
      "med guide [--text]         the guide on the page (? or the ? tab) · --text: here",
      "med screen block|instrument|song|export|guide   what the page shows (the tabs, alt B I S E, ?)",
      "med copy · cut · paste · clear   the selection (or the cell under the cursor) · med transpose <±semitones>",
      "med line insert|delete [--all]   a line at the cursor, in its track (--all: every track)",
      "med sampler [file]         load a sound into a free instrument (no file: choose one)",
      "med autosave [on|off] [every <10–300 s>]   a copy after each change, in songs/.recovery/ (never over the song)",
      "med recover [list | <n> | forget <n>]   the autosaved copies never saved: back on the page, or forgotten",
      "med pack · med pack load <name>   the starter sound pack (sampled by people: SOUND_DESIGN.md) — which are there, load one",
      "med note <line> <track> <C-3|^^^|---> [instrument] [command]   write a cell (line in decimal, track from 1)",
      "med block                  the blocks: their length, the positions that play them",
      "med block new [lines] · med block copy · med block lines <n> · med block rm <block> (one in no position)",
      "med seq                    the sequence: position → block",
      "med seq new|copy|rm [position] · med seq set <position> <block> · med seq add <block> · med seq move <position> up|down",
      "med tracks <1–16> · med tempo <n> · med speed <n> · med lpb <n>",
      "med chord <line> <track> <0–F>   the chord a note plays (its own column, after the instrument)",
      "med chords · med chords on|off · med chords set <1–F> <name> <semitones…> · med chords invert <1–F> [1|2|3] · med chords reset",
      "med swing <0–100>          every other line longer (0 straight, 100 triplets)",
      "med echo off | normal|cross [ms] [depth 1–6]   OctaMED's echo on the whole mix",
      "med undo · med redo",
      ...SAMPLE_USAGE,
      ...SYNTH_USAGE,
      ...DRUMS_USAGE,
      "med effects                every command (00–2E) in one line each",
      "med info                   the song's settings",
    ].join("\n"),
    examples: [["med export --stems", "the song as WAV (24 bits, 48 kHz), and each track on its own"], ["med export songs/x.flac --rate 44100", "FLAC, CD quality"], ["med export songs/x.mp3 --stems", "MP3 (V0), and each track on its own (encoders install first)"], ["med play", "play from the cursor"], ["med play block", "play this block again and again"], "med mute 2", "med effects"],
    complete: () => ["open", "ls", "demo", "new", "save", "export", "sample", "bounce", "synth", "fm", "drums", "kits", "kit", "grit", "presets", "settings", "preset", "bake", "show", "up", "down", "filter", "load", "chop", "onsets", "stretch", "fade", "pitch", "reverse", "crush", "normalize", "trim", "loop", "pingpong", "--rate", "--bits", "--quality", "--stems", "--only-stems", "--tracks", "--normalize", "track", "name", "vol", "pan", "edit", "step", "note", "chord", "chords", "reset", "echo", "normal", "cross", "swing", "strum", "invert", "--empty", "--chip", "chip", "table", "block", "seq", "tracks", "tempo", "speed", "lpb", "undo", "redo", "new", "copy", "rm", "set", "add", "lines", "play", "stop", "pos", "mute", "solo", "paula", "effects", "info", "song", "block", "on", "off"],
    async run(ctx: ShellContext) {
      const { rest: positional, flags } = parseFlags(ctx.args, ["rate", "bits", "tracks", "tail", "quality"]);
      if (positional[0] === "sample" || positional[0] === "smp") {
        try {
          return await sampleCommand(ib, st, ctx, positional.slice(1), flags);
        } catch (err) {
          return ctx.err(`med: ${err instanceof Error ? err.message : err}\n`), 1;
        }
      }
      const synth = SYNTHS.find((x) => x.cmd === positional[0]);
      if (synth || positional[0] === "drums") {
        try {
          return await (synth ? synthCommand(ib, st, ctx, positional.slice(1), synth) : drumsCommand(ib, st, ctx, positional.slice(1)));
        } catch (err) {
          return ctx.err(`med: ${err instanceof Error ? err.message : err}\n`), 1;
        }
      }
      if (positional[0] === "bounce") return bounce(ib, engine, st, ctx, flags);
      const [sub = "", ...rest] = positional;
      try {
        switch (sub) {
          case "": {
            if (!st.song) return ctx.out(`${fmt.dim("no song loaded")} · med new · med open <file> · med demo · med ls\n`), 0;
            const s = st.song;
            ctx.out(`♫ ${s.title || st.path} (${st.path})\n  ${engine.playing ? fmt.green(`playing (${engine.mode})`) : "stopped"} · position ${hex(st.seq)} · block ${hex(s.sequence[st.seq] ?? 0, 3)} · line ${lineNo(st.line)}\n`);
            return 0;
          }
          case "ls": {
            const songs = await find();
            ctx.out(songs.length ? songs.join("\n") + "\n" : fmt.dim("no song in songs/ yet (.bmed, .med, .mod — med new, or drop one in it)\n"));
            return 0;
          }
          case "open": {
            let path = rest.join(" ");
            if (!path) {
              const songs = await find();
              if (!songs.length) {
                // said on the page too (START's "open" did nothing visible before)
                st.error = "no song in songs/ yet: N for a new one, or put a .bmed, .med or .mod in songs/";
                ib.ui.notify(st.error, "warning");
                return ctx.err(`med open: ${st.error}\n`), 1;
              }
              const i = await ib.ui.choose(t("open a song"), songs.map((p) => ({ label: p })));
              if (i === null) return 1;
              path = songs[i];
            }
            if (!(await mayReplace(ctx, "open", !!flags.force))) return 1;
            await open(ctx, ctx.resolve(path));
            void ib.apps.open("breakermed");
            return 0;
          }
          case "filter": {
            const s = need();
            st.editor!.settings("LED filter", (x) => (x.flags.filter = rest[0] === "on" ? true : rest[0] === "off" ? false : !x.flags.filter));
            ctx.out(s.flags.filter ? "the A500's LED filter: on (a soft, warm top)\n" : "the A500's LED filter: off\n");
            return 0;
          }
          case "export": {
            const s = need();
            const target = rest.length ? ctx.resolve(rest.join(" ")) : defaultPath().replace(/\.bmed$/i, ".wav");
            const format = formatOf(target);
            if (!format) return ctx.err("med export: .wav .aif .flac — or .mp3 .m4a .ogg .opus (the deck's encoder pack)\n"), 1;
            // Opus is always 48 kHz
            const rate = format === "opus" ? 48000 : flags.rate ? parseInt(String(flags.rate), 10) : 48000;
            const bits = (flags.bits ? parseInt(String(flags.bits), 10) : format === "flac" ? 16 : 24) as 16 | 24 | 32;
            if (![16, 24, 32].includes(bits)) return ctx.err("med export: --bits 16, 24 or 32\n"), 1;
            const quality = typeof flags.quality === "string" ? flags.quality.toLowerCase() : "";
            const why = checkFormat(format, bits, rate, quality);
            if (why) return ctx.err(`med export: ${why}\n`), 1;
            if (isLossy(format)) {
              const problem = await encoderProblem(ib.audio, format);
              if (problem) return ctx.err(`med export: ${problem}\n`), 1;
            }
            const base = /\.(wav|aiff?|flac|mp3|m4a|ogg|opus)$/i.test(target) ? target.replace(/\.[^.]+$/, "") : target;
            const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
            const opts = { rate, bits, paula: engine.paula, muted: engine.muted, normalize: !!flags.normalize, tail: flags.tail ? Math.max(0, Math.min(10, parseFloat(String(flags.tail)) || 0)) : 1.5 };
            const jobs: { path: string; solo?: number[]; label: string }[] = [];
            if (!flags["only-stems"]) jobs.push({ path: `${base}.${extOf(format)}`, label: "master" });
            if (flags.stems || flags["only-stems"] || flags.tracks) {
              const wanted = flags.tracks ? String(flags.tracks).split(",").map((x) => parseInt(x, 10) - 1).filter((t) => t >= 0 && t < s.tracks) : [...Array(s.tracks).keys()].filter((t) => trackUsed(s, t));
              for (const t of wanted) {
                const name = trackName(s, t).replace(/[\\/:*?"<>|]/g, "-");
                jobs.push({ path: `${base} stems/${String(t + 1).padStart(2, "0")} ${name}.${extOf(format)}`, solo: [t], label: name });
              }
            }
            if (dir) await ib.vault.mkdir(dir).catch(() => {});
            if (jobs.some((j) => j.solo)) await ib.vault.mkdir(`${base} stems`).catch(() => {});
            for (const job of jobs) {
              let shown = 0;
              // a stem: before the limiter, so the stems add up to the mix (a limiter on each would not)
              const pcm = await renderSong(s, { ...opts, solo: job.solo, limit: !job.solo }, (p) => {
                if (p - shown >= 0.25 && p < 1) (shown = p), ctx.out(fmt.dim(`  ${job.label}: ${Math.round(p * 100)} %\n`));
              });
              const title = job.solo ? `${s.title || "untitled"} — ${job.label}` : s.title || "";
              const bytes = isLossy(format) ? await encodeLossy(ib.audio, pcm, format, quality, title) : encode(pcm, format, bits);
              await ib.vault.writeBytes(job.path, bytes);
              ctx.out(`${fmt.green("✓")} ${job.path} ${fmt.dim(`(${(bytes.length / 1048576).toFixed(1)} MB)`)}\n`);
            }
            ctx.out(fmt.dim(`  ${describe(format, bits, rate, quality)}${opts.normalize ? " · normalized" : ""}\n`));
            return 0;
          }
          case "save": {
            need();
            return saveSafely(ctx, rest.length ? ctx.resolve(rest.join(" ")) : null, { force: !!flags.force });
          }
          case "saveas": {
            // save as…: a name asked in a window (in songs/: the module's folder)
            need();
            return saveSafely(ctx, null, { ask: true, force: !!flags.force });
          }
          case "continue": {
            // back to the song in memory (the page shows START after it was closed)
            need();
            st.home = false;
            void ib.apps.open("breakermed");
            return 0;
          }
          case "new": {
            // 8 tracks (or what you say, up to 16), one empty block, the demo's four instruments to start with
            const n = rest[0] ? parseInt(rest[0], 10) : DEFAULT_TRACKS;
            if (!(n >= 1 && n <= MAX_TRACKS)) return ctx.err(`med new [tracks 1–${MAX_TRACKS}]\n`), 1;
            if (!(await mayReplace(ctx, "new", !!flags.force))) return 1;
            // the template (named tracks, drums, synths, a first bar) — or a blank page with the demo's samples
            const song = flags.chip ? chipSong() : flags.empty ? newSong(n) : templateSong(n);
            if (flags.empty) (song.instruments = readSong(demoMod()).instruments), (song.title = "untitled");
            await adopt(ctx, song, "untitled.bmed");
            void ib.apps.open("breakermed");
            return 0;
          }
          case "track": {
            const s = need();
            const tr = trackArg(s, rest[0]);
            const [, what, ...value] = rest;
            if (typeof tr === "string") return ctx.err(`med track: ${tr}\n`), 1;
            if (!what) return ctx.err(`med track <1–${s.tracks}> name <text> | vol <0–64> | pan <-100–100> | strum <0–${MAX_STRUM_MS} ms>\n`), 1;
            const v = value.join(" ");
            if (what === "name") st.editor!.setTrack(tr, { name: v }), ctx.out(`track ${tr + 1}: “${trackName(s, tr)}”\n`);
            else if (what === "vol" && /^\d+$/.test(v) && +v <= 64) st.editor!.setTrack(tr, { volume: +v }), ctx.out(`${trackName(s, tr)}: volume ${s.trackVolume[tr]}\n`);
            else if (what === "pan" && /^-?\d+$/.test(v)) st.editor!.setTrack(tr, { pan: Math.max(-100, Math.min(100, +v)) / 100 }), ctx.out(`${trackName(s, tr)}: pan ${Math.round(s.trackPan[tr] * 100)}\n`);
            else if (what === "strum" && /^\d+$/.test(v) && +v <= MAX_STRUM_MS) {
              st.editor!.setTrack(tr, { strum: +v });
              ctx.out(+v ? `${trackName(s, tr)}: its chords strummed, ${v} ms a note\n` : `${trackName(s, tr)}: its chords all at once\n`);
            } else return ctx.err(`med track <n> name <text> | vol <0–64> | pan <-100–100> | strum <0–${MAX_STRUM_MS} ms>\n`), 1;
            return 0;
          }
          case "demo":
            if (!(await mayReplace(ctx, "demo", !!flags.force))) return 1;
            await open(ctx, "demo.mod", demoMod());
            void ib.apps.open("breakermed");
            return 0;
          case "play": {
            const s = need();
            const mode = rest[0] === "block" ? "block" : "song";
            // a word that is neither a mode nor a number: refused (it used to play the song)
            const odd = rest.find((x, i) => !(i === 0 && (x === "song" || x === "block")) && !/^[0-9a-f]+$/i.test(x));
            if (odd !== undefined) return ctx.err(`med play: "${odd}"? med play [song|block] [position] [line]\n`), 1;
            const nums = rest.filter((x, i) => !(i === 0 && (x === "song" || x === "block")));
            const seq = nums[0] !== undefined ? parseInt(nums[0], 16) : st.seq;
            const line = nums[1] !== undefined ? parseInt(nums[1], 10) : nums[0] !== undefined ? 0 : st.line;
            if (seq >= s.sequence.length) return ctx.err(`med: position ${hex(seq)} isn't in the sequence (0–${hex(s.sequence.length - 1)})\n`), 1;
            // follow off: the cursor stays where you edit
            if (st.follow) (st.seq = seq), (st.line = line);
            await engine.play(mode, { seq, line });
            ctx.out(`▶ playing the ${mode} from position ${hex(seq)}, line ${lineNo(line)}\n`);
            return 0;
          }
          case "stop":
            engine.stop();
            ctx.out("■ stopped\n");
            return 0;
          case "pos": {
            const s = need();
            const seq = parseInt(rest[0] ?? "0", 16);
            if (!(seq >= 0 && seq < s.sequence.length)) return ctx.err(`med pos: position ${(rest[0] ?? "?").toUpperCase()} isn't in the sequence (00–${hex(s.sequence.length - 1)})\n`), 1;
            st.seq = seq;
            st.line = rest[1] ? parseInt(rest[1], 10) || 0 : 0;
            if (rest[2]) st.track = Math.max(0, Math.min(s.tracks - 1, (parseInt(rest[2], 10) || 1) - 1));
            if (engine.playing) await engine.play(engine.mode ?? "song", { seq: st.seq, line: st.line });
            ctx.out(`position ${hex(st.seq)} → block ${hex(s.sequence[st.seq], 3)} · line ${lineNo(st.line)}\n`);
            return 0;
          }
          case "mute":
          case "solo": {
            const s = need();
            const tr = trackArg(s, rest[0]);
            if (typeof tr === "string") return ctx.err(`med ${sub}: ${tr}\n`), 1;
            // undoable (⌘Z), but not a change to the song: the file doesn't keep mutes
            const before = new Set(engine.muted);
            const after = new Set(engine.muted);
            if (sub === "mute") after.has(tr) ? after.delete(tr) : after.add(tr);
            else {
              const alone = after.size === s.tracks - 1 && !after.has(tr);
              after.clear();
              if (!alone) for (let i = 0; i < s.tracks; i++) if (i !== tr) after.add(i);
            }
            const put = (m: Set<number>) => () => (engine.muted.clear(), m.forEach((x) => engine.muted.add(x)));
            st.editor!.act(sub, put(after), put(before), { view: true });
            ctx.out(engine.muted.size ? `muted: ${[...engine.muted].map((x) => x + 1).sort((a, b) => a - b).join(" ")}\n` : "every track plays\n");
            return 0;
          }
          case "paula": {
            engine.paula = rest[0] === "on" ? true : rest[0] === "off" ? false : !engine.paula;
            await ib.storage.set("paula", engine.paula);
            ctx.out(engine.paula ? "PAULA: stepped, gritty, like the Amiga\n" : "SMOOTH: interpolated\n");
            return 0;
          }
          case "view": {
            // the block's view: the cursor's line in the middle, or a view that scrolls at its edges
            const v = rest[0] === "center" || rest[0] === "centre" ? "center" : rest[0] === "edges" ? "edges" : rest[0] === undefined ? null : "bad";
            if (v === "bad") return ctx.err("med view center|edges (the cursor's line in the middle, or a view that scrolls at its edges)\n"), 1;
            if (v) (st.view = v), await ib.storage.set("view", v);
            ctx.out(st.view === "center" ? "view: the cursor's line in the middle (ProTracker)\n" : "view: scrolls at its edges (OctaMED)\n");
            return 0;
          }
          case "follow": {
            st.follow = rest[0] === "on" ? true : rest[0] === "off" ? false : !st.follow;
            await ib.storage.set("follow", st.follow);
            ctx.out(st.follow ? "follow: the cursor follows the song as it plays\n" : "follow off: the cursor stays where you edit, the line heard is lit\n");
            return 0;
          }
          case "click":
          case "metronome": {
            st.metronome = rest[0] === "on" ? true : rest[0] === "off" ? false : !st.metronome;
            engine.metronome = st.metronome;
            await ib.storage.set("metronome", st.metronome);
            ctx.out(st.metronome ? "metronome: a click on each beat while playing (louder on the bar)\n" : "metronome off\n");
            return 0;
          }
          case "edit": {
            need();
            st.edit = rest[0] === "on" ? true : rest[0] === "off" ? false : !st.edit;
            if (st.edit) engine.stop();
            ctx.out(st.edit ? "edit mode: typing writes in the block\n" : "edit mode off: the keys only play\n");
            return 0;
          }
          case "echo": {
            // med echo off | normal|cross [ms] [depth 1–6]: OctaMED's echo on the whole mix
            const s = need();
            const [type, msS, depthS] = rest;
            if (type === "off") st.editor!.settings("echo", (x) => delete x.echo);
            else if (type === "normal" || type === "cross") {
              const e = cleanEcho({ type, ms: msS ? parseInt(msS, 10) : s.echo?.ms ?? 250, depth: depthS ? parseInt(depthS, 10) : s.echo?.depth ?? 2 });
              if (!e || (msS && !(parseInt(msS, 10) > 0)) || (depthS && !(parseInt(depthS, 10) >= 1 && parseInt(depthS, 10) <= 6))) return ctx.err(`med echo off | normal|cross [ms 1–${ECHO_MAX_MS}] [depth 1–6: 1 long, 6 short]\n`), 1;
              st.editor!.settings("echo", (x) => (x.echo = e));
            } else if (type !== undefined) return ctx.err(`med echo off | normal|cross [ms 1–${ECHO_MAX_MS}] [depth 1–6: 1 long, 6 short]\n`), 1;
            const e = s.echo;
            ctx.out(e ? `echo: ${e.type} · ${e.ms} ms · depth ${e.depth} (each repeat at 1/${2 ** e.depth})\n` : "echo: off\n");
            return 0;
          }
          case "chord": {
            // med chord <line> <track> <0–F>: the chord a note plays (0: none)
            const s = need();
            const [lineS, trackS, chordS] = rest;
            const line = parseInt(lineS ?? "", 10), track = parseInt(trackS ?? "", 10) - 1;
            const n = parseInt(chordS ?? "", 16);
            const b = s.blocks[s.sequence[st.seq]];
            if (!b || !(line >= 0 && line < b.lines) || !(track >= 0 && track < s.tracks) || !(n >= 0 && n <= 15) || !/^[0-9a-f]$/i.test(chordS ?? "")) return ctx.err("med chord <line> <track 1–n> <0–F> (0: none · med chords: the table)\n"), 1;
            st.editor!.writeHex(s.sequence[st.seq], line, track, CHORD_COL, n);
            if (n) s.chordColumn = true;
            const def = chordsOf(s)[n - 1];
            ctx.out(`${fmt.green("✓")} ${lineNo(line)} · ${trackName(s, track)}: ${n ? `chord ${n.toString(16).toUpperCase()} ${def?.name ?? ""}` : "no chord"}\n`);
            return 0;
          }
          case "chords": {
            const s = need();
            const [op, ...args] = rest;
            if (op === "on" || op === "off") {
              st.editor!.settings("chord column", (x) => (x.chordColumn = op === "on"));
              ctx.out(`the chord column: ${op}\n`);
              return 0;
            }
            if (op === "set") {
              // med chords set <1–F> <name> <semitones…>: one line of the song's own table
              const n = parseInt(args[0] ?? "", 16);
              const name = args[1] ?? "";
              const notes = args.slice(2).map((x) => parseInt(x, 10));
              if (!(n >= 1 && n <= 15) || !name || !notes.length || notes.some((x) => !(x >= -24 && x <= 24) || x === 0) || notes.length > MAX_CHORD_NOTES)
                return ctx.err(`med chords set <1–F> <name> <semitones over the note, 1 to ${MAX_CHORD_NOTES} of them, -24…24> (e.g. med chords set 1 maj 4 7)\n`), 1;
              st.editor!.chords(n, { name: name.slice(0, 8), notes });
              ctx.out(`${fmt.green("✓")} chord ${n.toString(16).toUpperCase()}: ${name} (+${notes.join(" +")})\n`);
              return 0;
            }
            if (op === "invert") {
              // med chords invert <1–F> <1–3>: that line of the table, turned over (the third, then the fifth in the bass)
              const n = parseInt(args[0] ?? "", 16), k = parseInt(args[1] ?? "1", 10);
              const d = chordsOf(s)[n - 1];
              if (!d || !(k >= 1 && k <= 3)) return ctx.err("med chords invert <1–F> [1|2|3] (once: the third in the bass, twice: the fifth…)\n"), 1;
              const notes = invertChord(d.notes, k);
              if (!notes.length || notes.some((x) => x < -24 || x > 24)) return ctx.err("med chords invert: that chord can't turn over\n"), 1;
              const name = `${d.name.replace(/\/\d$/, "")}/${k}`.slice(0, 8);
              st.editor!.chords(n, { name, notes });
              ctx.out(`${fmt.green("✓")} chord ${n.toString(16).toUpperCase()}: ${name} (${notes.map((x) => (x > 0 ? `+${x}` : x)).join(" ")})\n`);
              return 0;
            }
            if (op === "reset") {
              st.editor!.chords(0, null);
              ctx.out("the chord table: back to the default\n");
              return 0;
            }
            ctx.out(chordsOf(s).map((d, i) => `  ${(i + 1).toString(16).toUpperCase()}  ${d.name.padEnd(6)} ${d.notes.map((x) => (x > 0 ? `+${x}` : x)).join(" ")}`).join("\n") + `\n${fmt.dim(`the chord column: ${s.chordColumn ? "on" : "off"} (med chords on|off)`)}\n`);
            return 0;
          }
          case "octave": {
            const n = parseInt(rest[0] ?? "", 10);
            if (!(n >= 1 && n <= 8)) return ctx.err("med octave 1–8 (the piano's bottom row)\n"), 1;
            st.octave = n - 1;
            ctx.out(`octave ${n}: the keys' bottom row is C-${n}\n`);
            return 0;
          }
          case "ins": {
            const s = need();
            const n = parseInt(rest[0] ?? "", 16);
            if (!(n >= 1 && n <= Math.min(63, s.instruments.length + 1))) return ctx.err(`med ins 01–${hex(Math.min(63, s.instruments.length + 1))} (the instrument the keys play)\n`), 1;
            st.inst = n - 1;
            const ins = s.instruments[n - 1];
            ctx.out(`instrument ${hex(n)}${ins && ins.kind !== "empty" ? ` · ${ins.name || ins.kind}` : " · empty (med sample, med synth… make it)"}\n`);
            return 0;
          }
          case "guide": {
            if (flags.text) return ctx.out(GUIDE.map((p) => `${p.title}\n${p.rows.map(([a, b]) => `  ${fmt.cyan(a.padEnd(22))} ${b}`).join("\n")}`).join("\n\n") + "\n"), 0;
            if (st.screen !== "guide") st.back = st.screen;
            st.screen = "guide";
            void ib.apps.open("breakermed");
            ctx.out("the guide is on the page: ↑↓ to read, ? to go back · med guide --text: here\n");
            return 0;
          }
          case "screen": {
            const id = rest[0] as Screen;
            if (!SCREENS.some((x) => x.id === id)) return ctx.err(`med screen ${SCREENS.map((x) => x.id).join("|")}\n`), 1;
            if (id === "guide" && st.screen !== "guide") st.back = st.screen;
            st.screen = id;
            if (st.song) st.home = false;
            void ib.apps.open("breakermed");
            return 0;
          }
          case "copy":
          case "cut":
          case "paste":
          case "clear":
          case "transpose": {
            const s = need();
            const e = st.editor!;
            const block = s.sequence[st.seq];
            // the selection, or the cell under the cursor
            const sel = st.sel && st.sel.block === block ? st.sel : { block, line0: st.line, line1: st.line, track0: st.track, track1: st.track };
            const size = `${sel.line1 - sel.line0 + 1} line${sel.line1 > sel.line0 ? "s" : ""} × ${sel.track1 - sel.track0 + 1} track${sel.track1 > sel.track0 ? "s" : ""}`;
            if (sub === "copy") (st.clip = e.copy(sel)), ctx.out(`copied ${size}\n`);
            else if (sub === "cut") (st.clip = e.cut(sel)), (st.sel = null), ctx.out(`cut ${size}\n`);
            else if (sub === "clear") e.clearSelection(sel), ctx.out(`cleared ${size}\n`);
            else if (sub === "paste") {
              if (!st.clip) return ctx.err("med paste: nothing copied (med copy)\n"), 1;
              e.paste(block, st.line, st.track, st.clip);
              ctx.out(`pasted at line ${lineNo(st.line)}, ${trackName(s, st.track)}\n`);
            } else {
              const n = parseInt(rest[0] ?? "", 10);
              if (!(n >= -48 && n <= 48 && n !== 0)) return ctx.err("med transpose <±1–48 semitones> (12: an octave)\n"), 1;
              e.transpose(sel, n);
              ctx.out(`transposed ${n > 0 ? "+" : ""}${n} · ${size}\n`);
            }
            return 0;
          }
          case "line": {
            const s = need();
            const tracks = flags.all ? [...Array(s.tracks).keys()] : [st.track];
            if (rest[0] === "insert") st.editor!.insertLine(s.sequence[st.seq], st.line, tracks), ctx.out(`a line inserted at ${lineNo(st.line)}\n`);
            else if (rest[0] === "delete") st.editor!.deleteLine(s.sequence[st.seq], st.line, tracks), ctx.out(`line ${lineNo(st.line)} deleted\n`);
            else return ctx.err("med line insert|delete [--all]\n"), 1;
            return 0;
          }
          case "autosave": {
            const a = st.autosave!;
            const [what, value] = rest;
            if (what === "on" || what === "off") await a.configure({ on: what === "on" });
            else if (what === "every") {
              const n = parseInt(value ?? "", 10);
              if (!(n >= 10 && n <= 300)) return ctx.err("med autosave every <10–300 seconds>\n"), 1;
              await a.configure({ every: n });
            } else if (what !== undefined) return ctx.err("med autosave [on|off] [every <10–300 s>]\n"), 1;
            const last = a.lastAt ? ` · last copy ${new Date(a.lastAt).toLocaleTimeString()}` : "";
            ctx.out(a.on ? `${fmt.green("● autosave on")} · 1.5 s after a change, every ${a.every} s at most while playing${last} · ${RECOVERY_DIR}/\n` : `${fmt.dim("○ autosave off")}${a.error ? ` (${a.error})` : ""} · med autosave on\n`);
            return 0;
          }
          case "recover": {
            const a = st.autosave!;
            const list = await a.list();
            const [what, n] = rest;
            const pickN = (x: string | undefined) => list[parseInt(x ?? "", 10) - 1];
            if (what === "forget") {
              const r = pickN(n);
              if (!r) return ctx.err(`med recover forget <1–${list.length}>\n`), 1;
              await a.forget(r.path);
              ctx.out(`forgot the autosaved ${r.title} (its folder stays in ${RECOVERY_DIR}/ until the next copy)\n`);
              return 0;
            }
            if (!list.length) return ctx.out("nothing to recover: every change was saved\n"), 0;
            if (what === "list" || (what === undefined && list.length > 1)) {
              list.forEach((r, i) => ctx.out(`${i + 1}  ${(r.path.split("/").pop() ?? r.path).padEnd(24)} ${fmt.dim(`${r.title !== "untitled" ? `“${r.title}” · ` : ""}${new Date(r.at).toLocaleString()} · ${r.path}`)}\n`));
              ctx.out(fmt.dim("med recover <n>: back on the page · med recover forget <n>\n"));
              return 0;
            }
            const r = what === undefined ? list[0] : pickN(what);
            if (!r) return ctx.err(`med recover <1–${list.length}>\n`), 1;
            if (r.path !== st.path && !(await mayReplace(ctx, "recover", !!flags.force))) return 1;
            await recover(ctx, r);
            void ib.apps.open("breakermed");
            return 0;
          }
          case "pack": {
            // the starter pack: which sounds a musician has made (in the vault), which are still placeholders
            if (rest[0] === "load") {
              const p = findPack(rest[1] ?? "");
              if (!p) return ctx.err(`med pack load <name>: ${PACK.map((x) => x.file.split("/").pop()!.replace(/\.wav$/, "")).join(" · ")}\n`), 1;
              if (!(await packHave()).has(p.file)) {
                // nobody has recorded it yet: a computed stand-in, until the real one is in songs/sound-pack/
                if (!st.song) await adopt(ctx, templateSong(), "untitled.bmed");
                const s = need();
                let n = s.instruments.findIndex((x) => x.kind === "empty");
                if (n < 0) n = s.instruments.length;
                if (n >= 63) return ctx.err("med pack load: the 63 instruments are taken\n"), 1;
                const ins = placeholderFor(p);
                st.editor!.addInstruments([ins], n);
                st.inst = n;
                st.screen = "instrument";
                void ib.apps.open("breakermed");
                ctx.out(`${fmt.green("✓")} ${hex(n + 1)} ${ins.name}: a computed placeholder, until someone records ${p.file} (SOUND_DESIGN.md)\n`);
                return 0;
              }
              return ib.shell.run(`med sampler ${PACK_DIR}/${p.file}`);
            }
            let have = 0;
            const found = await packHave();
            for (const p of PACK) {
              const there = found.has(p.file);
              if (there) have++;
              ctx.out(`${there ? fmt.green("✓") : fmt.dim("·")} ${p.file.padEnd(28)} ${fmt.dim(`${there ? "" : "placeholder (computed) · "}${p.what}${p.pitch ? ` · ${p.pitch}` : ""}${p.loop ? " · loops" : ""}`)}\n`);
            }
            ctx.out(`${have}/${PACK.length} recorded in ${PACK_DIR}/ · the others load as computed placeholders until people record them (SOUND_DESIGN.md)\n`);
            return 0;
          }
          case "sampler": {
            // a song first if there's none (a new one), then the first free slot, then the sound
            if (!st.song) await adopt(ctx, templateSong(), "untitled.bmed");
            const s = need();
            let n = s.instruments.findIndex((x) => x.kind === "empty");
            if (n < 0) n = s.instruments.length;
            if (n >= 63) return ctx.err("med sampler: the 63 instruments are taken\n"), 1;
            st.inst = n;
            st.screen = "instrument";
            void ib.apps.open("breakermed");
            return sampleCommand(ib, st, ctx, [hex(n + 1), "load", ...rest], flags);
          }
          case "step": {
            const n = parseInt(rest[0] ?? "", 10);
            if (!(n >= 0 && n <= 16)) return ctx.err("med step 0–16\n"), 1;
            st.step = n;
            ctx.out(`step ${n}: the cursor moves ${n} line${n === 1 ? "" : "s"} after a note\n`);
            return 0;
          }
          case "note": {
            const s = need();
            const [lineS, trackS, noteS, instS, cmdS] = rest;
            const line = parseInt(lineS ?? "", 10), track = parseInt(trackS ?? "", 10) - 1;
            const note = noteS ? parseNote(noteS) : null;
            const b = s.blocks[s.sequence[st.seq]];
            const tr = trackArg(s, trackS);
            if (typeof tr === "string") return ctx.err(`med note: ${tr}\n`), 1;
            if (b && !(line >= 0 && line < b.lines)) return ctx.err(`med note: line ${(lineS ?? "?").toUpperCase()}: the block has 0–${b.lines - 1}\n`), 1;
            if (instS && !(/^[0-9a-f]{1,2}$/i.test(instS) && parseInt(instS, 16) <= 63)) return ctx.err(`med note: instrument ${instS.toUpperCase()}: they are 01–3F\n`), 1;
            if (noteS && note === null) return ctx.err(`med note: "${noteS}" isn't a note (C-3, C#4, ^^^ a note off, --- none)\n`), 1;
            if (!b || !(line >= 0 && line < b.lines) || !(track >= 0 && track < s.tracks) || note === null) return ctx.err("med note <line> <track 1–n> <C-3|^^^|---> [instrument hex] [command 0C20]\n"), 1;
            // a bad command refuses the whole cell (nothing written)
            if (cmdS && !/^[0-9a-f]{4}$/i.test(cmdS)) return ctx.err(`med note: "${cmdS}" isn't a command (4 hex digits, like 0C20)\n`), 1;
            const e = st.editor!;
            const bn = s.sequence[st.seq];
            if (note) e.writeNote(bn, line, track, note, instS ? parseInt(instS, 16) || 0 : 0);
            else e.clear(bn, line, track, 0);
            if (cmdS) [...cmdS].forEach((d, i) => e.writeHex(bn, line, track, CMD_COL + i, parseInt(d, 16)));
            const c = s.blocks[bn].cells[line][track];
            // what was written, the way the block shows it (a script or the LOG can check it)
            ctx.out(`${fmt.green("✓")} ${lineNo(line)} · ${trackName(s, track)}: ${c.note ? noteName(c.note) : "---"} ${c.inst ? hex(c.inst) : ".."}${cmdS ? ` ${cmdS.toUpperCase()}` : ""}\n`);
            return 0;
          }
          case "block": {
            const s = need();
            const e = st.editor!;
            const what = rest[0];
            const unused = " (not in the sequence: med seq add, or a position's menu → use block)";
            if (what === undefined) {
              // the blocks: their length, and which positions play them
              ctx.out(s.blocks.map((b, i) => {
                const at = s.sequence.flatMap((x, k) => (x === i ? [hex(k)] : []));
                return `${i === s.sequence[st.seq] ? "▸" : " "}${hex(i, 3)}  ${String(b.lines).padStart(4)} lines${b.name ? ` · ${b.name}` : ""}${at.length ? fmt.dim(` · positions ${at.join(" ")}`) : fmt.dim(unused)}`;
              }).join("\n") + "\n");
            } else if (what === "new") {
              const n = e.newBlock(rest[1] ? parseInt(rest[1], 10) || 64 : s.blocks[s.sequence[st.seq]]?.lines ?? 64);
              ctx.out(`block ${hex(n, 3)}${unused}\n`);
            } else if (what === "copy") ctx.out(`block ${hex(e.cloneBlock(s.sequence[st.seq]), 3)}${unused}\n`);
            else if (what === "lines") {
              const n = parseInt(rest[1] ?? "", 10);
              if (!(n >= 1 && n <= 3200)) return ctx.err(`med block lines: ${rest[1] ?? "?"} — a block has 1–3200 lines\n`), 1;
              e.setLines(s.sequence[st.seq], n);
              ctx.out(`block ${hex(s.sequence[st.seq], 3)}: ${n} line${n === 1 ? "" : "s"}\n`);
            } else if (what === "rm") {
              const n = blockArg(s, rest[1] ?? hex(s.sequence[st.seq], 3));
              if (typeof n === "string") return ctx.err(`med block rm: ${n}\n`), 1;
              const at = s.sequence.flatMap((x, k) => (x === n ? [hex(k)] : []));
              if (at.length) return ctx.err(`med block rm: block ${hex(n, 3)} plays at position${at.length > 1 ? "s" : ""} ${at.join(" ")} (take it out of the sequence first)\n`), 1;
              if (!e.blockDelete(n)) return ctx.err("med block rm: a song keeps one block at least\n"), 1;
              ctx.out(`deleted block ${hex(n, 3)} (⌘Z: back)${n < s.blocks.length ? " · the blocks after it moved down a number" : ""}\n`);
            } else return ctx.err("med block [new [lines] | copy | lines <n> | rm <block>]\n"), 1;
            return 0;
          }
          case "seq": {
            const s = need();
            const e = st.editor!;
            const [what, a, b] = rest;
            if (what === undefined) return ctx.out(seqList(s)), 0;
            const pos = a !== undefined ? parseInt(a, 16) : st.seq;
            // a position or a block that isn't there: said
            if (["rm", "set", "copy", "move"].includes(what) && a !== undefined) {
              const p = posArg(s, a);
              if (typeof p === "string") return ctx.err(`med seq ${what}: ${p}\n`), 1;
            }
            if (what === "set" || what === "add") {
              const bk = blockArg(s, what === "set" ? b : a);
              if (typeof bk === "string") return ctx.err(`med seq ${what}: ${bk}\n`), 1;
            }
            const said = (p: number) => ctx.out(`position ${hex(p)} → block ${hex(s.sequence[p], 3)}\n`);
            if (what === "move") {
              const d = b === "up" ? -1 : b === "down" ? 1 : 0;
              if (!d) return ctx.err("med seq move <position> up|down\n"), 1;
              if (!e.seqMove(pos, d)) return ctx.err(`med seq move: position ${hex(pos)} is already at the ${d < 0 ? "top" : "bottom"}\n`), 1;
              st.seq = pos + d;
              said(st.seq);
              return 0;
            }
            if (what === "new") {
              const n = e.newBlock(s.blocks[s.sequence[st.seq]]?.lines ?? 64);
              e.seqInsert(pos + 1, n);
              st.seq = Math.min(s.sequence.length - 1, pos + 1);
            } else if (what === "copy") {
              const n = e.cloneBlock(s.sequence[pos] ?? 0);
              e.seqInsert(pos + 1, n);
              st.seq = Math.min(s.sequence.length - 1, pos + 1);
            } else if (what === "rm") {
              if (s.sequence.length <= 1) return ctx.err("med seq rm: the sequence keeps one position at least\n"), 1;
              e.seqDelete(pos);
              ctx.out(`removed position ${hex(pos)}\n`);
            } else if (what === "set") e.seqSet(pos, parseInt(b ?? "", 16)), said(pos);
            else if (what === "add") e.seqInsert(s.sequence.length, parseInt(a ?? "", 16)), said(s.sequence.length - 1);
            else return ctx.err("med seq [new|copy|rm [position] · set <position> <block> · add <block> · move <position> up|down]\n"), 1;
            if (what === "new" || what === "copy") said(st.seq);
            st.seq = Math.max(0, Math.min(s.sequence.length - 1, st.seq));
            st.line = 0;
            return 0;
          }
          case "tracks": {
            need();
            const n = parseInt(rest[0] ?? "", 10);
            const most = Math.max(MAX_TRACKS, need().tracks);
            if (!(n >= 1 && n <= most)) return ctx.err(`med tracks 1–${most}\n`), 1;
            engine.stop();
            st.editor!.setTracks(n);
            ctx.out(`${n} track${n === 1 ? "" : "s"}\n`);
            return 0;
          }
          case "tempo":
          case "speed":
          case "lpb": {
            need();
            const n = parseInt(rest[0] ?? "", 10);
            const [lo, hi] = sub === "tempo" ? [1, 255] : sub === "speed" ? [1, 32] : [1, 32];
            if (!(n >= lo && n <= hi)) return ctx.err(`med ${sub}: ${rest[0] ?? "?"} — ${lo}–${hi}\n`), 1;
            st.editor!.settings(sub, (x) => (sub === "tempo" ? (x.tempo = n) : sub === "speed" ? (x.speed = n) : (x.lpb = n)));
            ctx.out(sub === "tempo" ? `tempo ${n}${need().tempoMode === "spd" ? " (SPD)" : " BPM"}\n` : sub === "speed" ? `speed ${n} ticks a line\n` : `${n} lines a beat\n`);
            return 0;
          }
          case "swing": {
            // med swing <0–100>: every other line longer (100 = a triplet feel)
            const s = need();
            const n = rest[0] === "off" ? 0 : parseInt(rest[0] ?? "", 10);
            if (rest[0] === undefined) return ctx.out(`swing: ${s.swing ?? 0} · med swing <0–100> (0 straight, 50 a lazy shuffle, 100 triplets)\n`), 0;
            if (!(n >= 0 && n <= 100)) return ctx.err("med swing <0–100> | off (0 straight, 50 a lazy shuffle, 100 triplets)\n"), 1;
            st.editor!.settings("swing", (x) => (n ? (x.swing = n) : delete x.swing));
            ctx.out(n ? `swing ${n}: every other line ${Math.round((swingFactor(n, 0) / swingFactor(n, 1)) * 100) / 100}× the next\n` : "swing off: straight\n");
            return 0;
          }
          case "undo":
          case "redo": {
            need();
            const label = undoRedo(st, sub === "redo");
            ctx.out(label ? `${sub === "undo" ? "undone" : "redone"}: ${label}\n` : `nothing to ${sub}\n`);
            return 0;
          }
          case "effects":
            for (const [k, v] of EFFECTS) ctx.out(`${fmt.cyan(k.padEnd(13))} ${v}\n`);
            return 0;
          case "info": {
            const s = need();
            const len = songLength(s);
            ctx.out(
              [
                `title       ${s.title || "—"}`,
                `file        ${st.path}${/\.bmed$/i.test(st.path) ? "" : ` (${s.format})`}`,
                `tracks      ${s.tracks} · blocks ${s.blocks.length} · positions ${s.sequence.length}`,
                `tempo       ${s.tempoMode.toUpperCase()} ${s.tempo} · speed ${s.speed} · lines a beat ${s.lpb}`,
                `transpose   ${s.transpose} · master volume ${s.masterVolume}`,
                `slides      ${s.flags.ptSlides ? "ProTracker" : "OctaMED"} · volumes ${s.flags.volHex ? "hex" : "decimal"} · ${s.flags.hardwareMix ? "Amiga voices" : "mixing"}`,
                `echo        ${s.echo ? `${s.echo.type} · ${s.echo.ms} ms · depth ${s.echo.depth}` : "off"} · LED filter ${s.flags.filter ? "on" : "off"}${s.chordColumn ? " · chords" : ""}${s.swing ? ` · swing ${s.swing}` : ""}`,
                `length      ${Math.floor(len.seconds / 60)}:${String(Math.floor(len.seconds % 60)).padStart(2, "0")} (${len.lines} lines)`,
                `instruments`,
                ...s.instruments.map((i, n) => (i.kind === "empty" ? "" : `  ${hex(n + 1)} ${i.name.padEnd(22)} ${i.kind.padEnd(6)} ${i.kind === "analog" || i.kind === "fm" || i.kind === "chip" ? "  synth" : i.kind === "drums" ? "   kit" : `${String(i.data.length).padStart(7)} frames`} · vol ${i.volume}${i.loopLength ? ` · loop ${i.loopStart}+${i.loopLength}` : ""}${i.transpose ? ` · ${i.transpose > 0 ? "+" : ""}${i.transpose}` : ""}`)).filter(Boolean),
              ].join("\n") + "\n",
            );
            return 0;
          }
          case "note": {
            // med note: the name of a note number (for scripts)
            ctx.out(noteName(parseInt(rest[0] ?? "0", 10)) + "\n");
            return 0;
          }
          default:
            return ctx.err(`med: unknown "${sub}" (med -h)\n`), 1;
        }
      } catch (e) {
        st.error = e instanceof Error ? e.message : String(e);
        ctx.err(`med: ${st.error}\n`);
        return 1;
      }
    },
  });
}
