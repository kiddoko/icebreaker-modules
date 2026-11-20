/**
 * breakerMED — the `med` command: the source of truth. The page runs these
 * (the LOG shows them), and so can keys, macros, scripts and THE MENU.
 */
import type { IcebreakerAPI, ShellContext } from "./icebreaker";
import type { Engine } from "./engine";
import { readSong, SONG_EXTS } from "./format";
import { demoMod } from "./demo";
import { readBmed, writeBmed } from "./format/bmed";
import { checkFormat, encode, renderSong, trackUsed, type ExportFormat } from "./export";
import { bounce, sampleCommand, SAMPLE_USAGE } from "./commands-sample";
import { writeMed, writeMod } from "./format/write";
import { songLength } from "./replayer";
import { DEFAULT_TRACKS, hex, MAX_TRACKS, newSong, noteName, trackName, type Song } from "./song";
import { Editor, parseNote } from "./edit";
import type { State } from "./app";

const EFFECTS: [string, string][] = [
  ["00xy", "arpeggio: the note, +x, +y semitones"],
  ["01xx / 02xx", "slide the pitch up / down"],
  ["03xx", "slide to the note (xx: speed)"],
  ["04xy", "vibrato (x speed, y depth, twice ProTracker's)"],
  ["05xy / 06xy", "03 / 04 going on, with a volume slide"],
  ["07xy", "tremolo"],
  ["09xx", "speed: ticks a line (01–20)"],
  ["0Axy / 0Dxy", "volume slide (x up, y down)"],
  ["0Bxx", "jump to position xx"],
  ["0Cxx", "volume (decimal 00–64, or hex in hex mode)"],
  ["0Fxx", "tempo · 0F00 next block · F1 note twice · F2 half a line late · F3 three times · FE stop · FF note off"],
  ["11x / 12x", "fine slide up / down"],
  ["14xy", "vibrato, ProTracker's depth"],
  ["15x", "finetune (-8…7)"],
  ["16x", "loop: 1600 marks, 16x plays x more times"],
  ["18x", "cut the note at tick x"],
  ["19xx", "start xx × 256 frames into the sample"],
  ["1Ax / 1Bx", "fine volume up / down"],
  ["1Dxx", "next block, at line xx"],
  ["1Ex", "play the line x more times"],
  ["1Fxy", "note x ticks late · y: again every y ticks"],
  ["2Exx", "pan (F0 left … 00 middle … 10 right)"],
];

export function registerCommands(ib: IcebreakerAPI, engine: Engine, st: State): void {
  const { fmt, parseFlags } = ib.lib;

  const find = async (dir = "", depth = 0, out: string[] = []): Promise<string[]> => {
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
      st.path = dir;
      st.editor!.dirty = false;
      ctx.out(`${fmt.green("✓")} ${dir}/ (song.json + samples)\n`);
      return;
    }
    for (const w of warnings) ctx.out(`${fmt.dim("  ⚠ " + w)}\n`);
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
    if (/\.bmed$/i.test(st.path)) return st.path;
    const base = (st.path.split("/").pop() || "untitled").replace(/\.(med|mod|mmd\d|bmed)$/i, "").replace(/^(mod|med)\./i, "") || "untitled";
    const dir = st.path.includes("/") ? st.path.slice(0, st.path.lastIndexOf("/")) : "songs";
    return `${dir}/${base}.bmed`;
  };

  /** this song is the one on the page now */
  const adopt = async (ctx: ShellContext, song: Song, path: string) => {
    st.song = song;
    st.editor = new Editor(song);
    st.editor.onChange = () => ib.ui.redraw();
    st.sel = null;
    st.col = 0;
    st.path = path;
    st.seq = st.line = st.track = 0;
    st.inst = Math.max(0, song.instruments.findIndex((i) => i.kind !== "empty"));
    st.error = "";
    await engine.load(song);
    const len = songLength(song);
    ctx.out(`${fmt.green("♫")} ${song.title || path} · ${song.format} · ${song.tracks} tracks · ${song.blocks.length} blocks · ${song.sequence.length} positions · ${song.instruments.filter((i) => i.kind !== "empty").length} instruments · ${Math.floor(len.seconds / 60)}:${String(Math.floor(len.seconds % 60)).padStart(2, "0")}\n`);
  };

  const need = (): Song => {
    if (!st.song) throw new Error("no song loaded (med open <file>)");
    return st.song;
  };

  ib.commands.register({
    name: "med",
    summary: "breakerMED: a tracker for .med (OctaMED) and .mod (ProTracker) songs",
    usage: [
      "med                        what's loaded, where it is",
      "med open [file]            a .med / .mod of the vault (no file: choose one)",
      "med ls                     the songs in the vault",
      "med demo                   a little song of ours, to try it right away",
      "med new [tracks]           a new song: 8 tracks (up to 16), the demo's instruments to start",
      "med save [file]            .bmed (ours: a folder, keeps everything — the default), .mod or .med (for other trackers)",
      "med export [file.wav|.aif|.flac] [--rate 48000] [--bits 16|24|32] [--stems | --only-stems | --tracks 1,3] [--normalize] [--tail 1.5]",
      "med track <n> name <text> · med track <n> vol <0–64> · med track <n> pan <-100–100>",
      "med play [song|block] [position] [line]",
      "med stop",
      "med pos <position> [line]  move the cursor (and where play starts)",
      "med mute <track> · med solo <track>   (again: back)",
      "med paula on|off           stepped like the Amiga (on), or smooth",
      "med edit on|off            typing writes in the block (space on the page)",
      "med step <0–9>             lines the cursor moves after a note",
      "med note <line> <track> <C-3|^^^|---> [instrument] [command]   write a cell (hex line, track from 1)",
      "med block new [lines] · med block copy · med block lines <n>",
      "med seq new|copy|rm [position] · med seq set <position> <block> · med seq add <block>",
      "med tracks <n> · med tempo <n> · med speed <n> · med lpb <n>",
      "med undo · med redo",
      ...SAMPLE_USAGE,
      "med effects                every command (00–2E) in one line each",
      "med info                   the song's settings",
    ].join("\n"),
    examples: [["med export --stems", "the song as WAV (24 bits, 48 kHz), and each track on its own"], ["med export songs/x.flac --rate 44100", "FLAC, CD quality"], ["med play", "play from the cursor"], ["med play block", "play this block again and again"], "med mute 2", "med effects"],
    complete: () => ["open", "ls", "demo", "new", "save", "export", "sample", "bounce", "filter", "load", "chop", "onsets", "stretch", "fade", "pitch", "reverse", "crush", "normalize", "trim", "loop", "pingpong", "--rate", "--bits", "--stems", "--only-stems", "--tracks", "--normalize", "track", "name", "vol", "pan", "edit", "step", "note", "block", "seq", "tracks", "tempo", "speed", "lpb", "undo", "redo", "new", "copy", "rm", "set", "add", "lines", "play", "stop", "pos", "mute", "solo", "paula", "effects", "info", "song", "block", "on", "off"],
    async run(ctx: ShellContext) {
      const { rest: positional, flags } = parseFlags(ctx.args, ["rate", "bits", "tracks", "tail"]);
      if (positional[0] === "sample" || positional[0] === "smp") {
        try {
          return await sampleCommand(ib, st, ctx, positional.slice(1), flags);
        } catch (err) {
          return ctx.err(`med: ${err instanceof Error ? err.message : err}\n`), 1;
        }
      }
      if (positional[0] === "bounce") return bounce(ib, engine, st, ctx, flags);
      const [sub = "", ...rest] = positional;
      try {
        switch (sub) {
          case "": {
            if (!st.song) return ctx.out(`${fmt.dim("no song loaded")} · med open <file> · med ls\n`), 0;
            const s = st.song;
            ctx.out(`♫ ${s.title || st.path} (${st.path})\n  ${engine.playing ? fmt.green(`playing (${engine.mode})`) : "stopped"} · position ${hex(st.seq)} · block ${hex(s.sequence[st.seq] ?? 0, 3)} · line ${hex(st.line)}\n`);
            return 0;
          }
          case "ls": {
            const songs = await find();
            ctx.out(songs.length ? songs.join("\n") + "\n" : fmt.dim("no .med / .mod in the vault (drop one in it)\n"));
            return 0;
          }
          case "open": {
            let path = rest.join(" ");
            if (!path) {
              const songs = await find();
              if (!songs.length) return ctx.err("no song in the vault (.bmed, .med, .mod — drop one in it, or med new)\n"), 1;
              const i = await ib.ui.choose("OPEN A SONG", songs.map((p) => ({ label: p })));
              if (i === null) return 1;
              path = songs[i];
            }
            await open(ctx, ctx.resolve(path));
            void ib.apps.open("breakermed");
            return 0;
          }
          case "filter": {
            const s = need();
            s.flags.filter = rest[0] === "on" ? true : rest[0] === "off" ? false : !s.flags.filter;
            st.editor!.dirty = true;
            ctx.out(s.flags.filter ? "the A500's LED filter: on (a soft, warm top)\n" : "the A500's LED filter: off\n");
            return 0;
          }
          case "export": {
            const s = need();
            const target = rest.length ? ctx.resolve(rest.join(" ")) : defaultPath().replace(/\.bmed$/i, ".wav");
            const ext = (/\.(wav|aiff?|flac)$/i.exec(target)?.[1] ?? "wav").toLowerCase();
            const format: ExportFormat = ext.startsWith("aif") ? "aiff" : (ext as ExportFormat);
            const rate = flags.rate ? parseInt(String(flags.rate), 10) : 48000;
            const bits = (flags.bits ? parseInt(String(flags.bits), 10) : format === "flac" ? 16 : 24) as 16 | 24 | 32;
            if (![16, 24, 32].includes(bits)) return ctx.err("med export: --bits 16, 24 or 32\n"), 1;
            const why = checkFormat(format, bits, rate);
            if (why) return ctx.err(`med export: ${why}\n`), 1;
            const base = /\.(wav|aiff?|flac)$/i.test(target) ? target.replace(/\.[^.]+$/, "") : target;
            const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
            const opts = { rate, bits, paula: engine.paula, muted: engine.muted, normalize: !!flags.normalize, tail: flags.tail ? Math.max(0, Math.min(10, parseFloat(String(flags.tail)) || 0)) : 1.5 };
            const jobs: { path: string; solo?: number[]; label: string }[] = [];
            if (!flags["only-stems"]) jobs.push({ path: `${base}.${format === "aiff" ? "aif" : format}`, label: "master" });
            if (flags.stems || flags["only-stems"] || flags.tracks) {
              const wanted = flags.tracks ? String(flags.tracks).split(",").map((x) => parseInt(x, 10) - 1).filter((t) => t >= 0 && t < s.tracks) : [...Array(s.tracks).keys()].filter((t) => trackUsed(s, t));
              for (const t of wanted) {
                const name = trackName(s, t).replace(/[\\/:*?"<>|]/g, "-");
                jobs.push({ path: `${base} stems/${String(t + 1).padStart(2, "0")} ${name}.${format === "aiff" ? "aif" : format}`, solo: [t], label: name });
              }
            }
            if (dir) await ib.vault.mkdir(dir).catch(() => {});
            if (jobs.some((j) => j.solo)) await ib.vault.mkdir(`${base} stems`).catch(() => {});
            for (const job of jobs) {
              let shown = 0;
              const pcm = await renderSong(s, { ...opts, solo: job.solo }, (p) => {
                if (p - shown >= 0.25 && p < 1) (shown = p), ctx.out(fmt.dim(`  ${job.label}: ${Math.round(p * 100)} %\n`));
              });
              const bytes = encode(pcm, format, bits);
              await ib.vault.writeBytes(job.path, bytes);
              ctx.out(`${fmt.green("✓")} ${job.path} ${fmt.dim(`(${(bytes.length / 1048576).toFixed(1)} MB)`)}\n`);
            }
            ctx.out(fmt.dim(`  ${format.toUpperCase()} · ${bits === 32 ? "32-bit float" : `${bits} bits`} · ${rate} Hz${opts.normalize ? " · normalized" : ""}\n`));
            return 0;
          }
          case "save": {
            need();
            const path = rest.length ? ctx.resolve(rest.join(" ")) : defaultPath();
            await save(ctx, path);
            return 0;
          }
          case "new": {
            // 8 tracks (or what you say, up to 16), one empty block, the demo's four instruments to start with
            const n = rest[0] ? parseInt(rest[0], 10) : DEFAULT_TRACKS;
            if (!(n >= 1 && n <= MAX_TRACKS)) return ctx.err(`med new [tracks 1–${MAX_TRACKS}]\n`), 1;
            const song = newSong(n);
            song.instruments = readSong(demoMod()).instruments;
            song.title = "untitled";
            await adopt(ctx, song, "untitled.bmed");
            void ib.apps.open("breakermed");
            return 0;
          }
          case "track": {
            const s = need();
            const tr = parseInt(rest[0] ?? "", 10) - 1;
            const [, what, ...value] = rest;
            if (!(tr >= 0 && tr < s.tracks) || !what) return ctx.err(`med track <1–${s.tracks}> name <text> | vol <0–64> | pan <-100–100>\n`), 1;
            const v = value.join(" ");
            if (what === "name") st.editor!.setTrack(tr, { name: v });
            else if (what === "vol" && /^\d+$/.test(v)) st.editor!.setTrack(tr, { volume: +v });
            else if (what === "pan" && /^-?\d+$/.test(v)) st.editor!.setTrack(tr, { pan: Math.max(-100, Math.min(100, +v)) / 100 });
            else return ctx.err(`med track <n> name <text> | vol <0–64> | pan <-100–100>\n`), 1;
            return 0;
          }
          case "demo":
            await open(ctx, "demo.mod", demoMod());
            void ib.apps.open("breakermed");
            return 0;
          case "play": {
            const s = need();
            const mode = rest[0] === "block" ? "block" : "song";
            const nums = rest.filter((x) => /^[0-9a-f]+$/i.test(x) && x !== "block");
            const seq = nums[0] !== undefined ? parseInt(nums[0], 16) : st.seq;
            const line = nums[1] !== undefined ? parseInt(nums[1], 16) : nums[0] !== undefined ? 0 : st.line;
            if (seq >= s.sequence.length) return ctx.err(`med: position ${hex(seq)} isn't in the sequence (0–${hex(s.sequence.length - 1)})\n`), 1;
            st.seq = seq;
            st.line = line;
            await engine.play(mode, { seq, line });
            return 0;
          }
          case "stop":
            engine.stop();
            return 0;
          case "pos": {
            const s = need();
            const seq = parseInt(rest[0] ?? "0", 16);
            if (!(seq >= 0 && seq < s.sequence.length)) return ctx.err(`med: position 0–${hex(s.sequence.length - 1)}\n`), 1;
            st.seq = seq;
            st.line = rest[1] ? parseInt(rest[1], 16) || 0 : 0;
            if (engine.playing) await engine.play(engine.mode ?? "song", { seq: st.seq, line: st.line });
            return 0;
          }
          case "mute":
          case "solo": {
            const s = need();
            const tr = parseInt(rest[0] ?? "", 10) - 1;
            if (!(tr >= 0 && tr < s.tracks)) return ctx.err(`med: a track is 1–${s.tracks}\n`), 1;
            if (sub === "mute") engine.muted.has(tr) ? engine.muted.delete(tr) : engine.muted.add(tr);
            else {
              const alone = engine.muted.size === s.tracks - 1 && !engine.muted.has(tr);
              engine.muted.clear();
              if (!alone) for (let i = 0; i < s.tracks; i++) if (i !== tr) engine.muted.add(i);
            }
            ctx.out(engine.muted.size ? `muted: ${[...engine.muted].map((x) => x + 1).sort((a, b) => a - b).join(" ")}\n` : "every track plays\n");
            return 0;
          }
          case "paula": {
            engine.paula = rest[0] === "on" ? true : rest[0] === "off" ? false : !engine.paula;
            await ib.storage.set("paula", engine.paula);
            ctx.out(engine.paula ? "PAULA: stepped, gritty, like the Amiga\n" : "SMOOTH: interpolated\n");
            return 0;
          }
          case "edit": {
            need();
            st.edit = rest[0] === "on" ? true : rest[0] === "off" ? false : !st.edit;
            if (st.edit) engine.stop();
            ctx.out(st.edit ? "edit mode: typing writes in the block\n" : "edit mode off: the keys only play\n");
            return 0;
          }
          case "step": {
            const n = parseInt(rest[0] ?? "", 10);
            if (!(n >= 0 && n <= 16)) return ctx.err("med step 0–16\n"), 1;
            st.step = n;
            return 0;
          }
          case "note": {
            const s = need();
            const [lineS, trackS, noteS, instS, cmdS] = rest;
            const line = parseInt(lineS ?? "", 16), track = parseInt(trackS ?? "", 10) - 1;
            const note = noteS ? parseNote(noteS) : null;
            const b = s.blocks[s.sequence[st.seq]];
            if (!b || !(line >= 0 && line < b.lines) || !(track >= 0 && track < s.tracks) || note === null) return ctx.err("med note <line (hex)> <track 1–n> <C-3|^^^|---> [instrument hex] [command 0C20]\n"), 1;
            const e = st.editor!;
            const bn = s.sequence[st.seq];
            if (note) e.writeNote(bn, line, track, note, instS ? parseInt(instS, 16) || 0 : 0);
            else e.clear(bn, line, track, 0);
            if (cmdS && /^[0-9a-f]{4}$/i.test(cmdS)) [...cmdS].forEach((d, i) => e.writeHex(bn, line, track, 3 + i, parseInt(d, 16)));
            return 0;
          }
          case "block": {
            const s = need();
            const e = st.editor!;
            const what = rest[0];
            if (what === "new") {
              const n = e.newBlock(rest[1] ? parseInt(rest[1], 10) || 64 : s.blocks[s.sequence[st.seq]]?.lines ?? 64);
              ctx.out(`block ${hex(n, 3)}\n`);
            } else if (what === "copy") ctx.out(`block ${hex(e.cloneBlock(s.sequence[st.seq]), 3)}\n`);
            else if (what === "lines") {
              const n = parseInt(rest[1] ?? "", 10);
              if (!(n >= 1 && n <= 3200)) return ctx.err("med block lines 1–3200\n"), 1;
              e.setLines(s.sequence[st.seq], n);
            } else return ctx.err("med block new [lines] | copy | lines <n>\n"), 1;
            return 0;
          }
          case "seq": {
            const s = need();
            const e = st.editor!;
            const [what, a, b] = rest;
            const pos = a !== undefined ? parseInt(a, 16) : st.seq;
            if (what === "new") {
              const n = e.newBlock(s.blocks[s.sequence[st.seq]]?.lines ?? 64);
              e.seqInsert(pos + 1, n);
              st.seq = Math.min(s.sequence.length - 1, pos + 1);
            } else if (what === "copy") {
              const n = e.cloneBlock(s.sequence[pos] ?? 0);
              e.seqInsert(pos + 1, n);
              st.seq = Math.min(s.sequence.length - 1, pos + 1);
            } else if (what === "rm") e.seqDelete(pos);
            else if (what === "set") e.seqSet(pos, parseInt(b ?? "", 16));
            else if (what === "add") e.seqInsert(s.sequence.length, parseInt(a ?? "", 16));
            else return ctx.err("med seq new|copy|rm [position] · set <position> <block> · add <block>\n"), 1;
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
            return 0;
          }
          case "tempo":
          case "speed":
          case "lpb": {
            const s = need();
            const n = parseInt(rest[0] ?? "", 10);
            const [lo, hi] = sub === "tempo" ? [1, 255] : sub === "speed" ? [1, 32] : [1, 32];
            if (!(n >= lo && n <= hi)) return ctx.err(`med ${sub} ${lo}–${hi}\n`), 1;
            if (sub === "tempo") s.tempo = n;
            else if (sub === "speed") s.speed = n;
            else s.lpb = n;
            st.editor!.dirty = true;
            return 0;
          }
          case "undo":
          case "redo": {
            need();
            const label = sub === "undo" ? st.editor!.undo() : st.editor!.redo();
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
                `file        ${st.path} (${s.format})`,
                `tracks      ${s.tracks} · blocks ${s.blocks.length} · positions ${s.sequence.length}`,
                `tempo       ${s.tempoMode.toUpperCase()} ${s.tempo} · speed ${s.speed} · lines a beat ${s.lpb}`,
                `transpose   ${s.transpose} · master volume ${s.masterVolume}`,
                `slides      ${s.flags.ptSlides ? "ProTracker" : "OctaMED"} · volumes ${s.flags.volHex ? "hex" : "decimal"} · ${s.flags.hardwareMix ? "Amiga voices" : "mixing"}`,
                `length      ${Math.floor(len.seconds / 60)}:${String(Math.floor(len.seconds % 60)).padStart(2, "0")} (${len.lines} lines)`,
                `instruments`,
                ...s.instruments.map((i, n) => (i.kind === "empty" ? "" : `  ${hex(n + 1)} ${i.name.padEnd(22)} ${i.kind.padEnd(6)} ${String(i.data.length).padStart(7)} frames · vol ${i.volume}${i.loopLength ? ` · loop ${i.loopStart}+${i.loopLength}` : ""}${i.transpose ? ` · ${i.transpose > 0 ? "+" : ""}${i.transpose}` : ""}`)).filter(Boolean),
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
