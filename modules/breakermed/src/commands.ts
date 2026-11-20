/**
 * breakerMED — the `med` command: the source of truth. The page runs these
 * (the LOG shows them), and so can keys, macros, scripts and THE MENU.
 */
import type { IcebreakerAPI, ShellContext } from "./icebreaker";
import type { Engine } from "./engine";
import { readSong, SONG_EXTS } from "./format";
import { demoMod } from "./demo";
import { songLength } from "./replayer";
import { hex, noteName, type Song } from "./song";
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
        if (!e.name.startsWith(".")) await find(e.path, depth + 1, out);
      } else if (SONG_EXTS.some((x) => e.name.toLowerCase().endsWith(x) || e.name.toLowerCase().startsWith(x.slice(1) + "."))) out.push(e.path);
    }
    return out;
  };

  const open = async (ctx: ShellContext, path: string, given?: Uint8Array) => {
    const bytes = given ?? (await ib.vault.readBytes(path));
    const song = readSong(bytes, path);
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
    if (!given) await ib.storage.set("last", path);
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
      "med effects                every command (00–2E) in one line each",
      "med info                   the song's settings",
    ].join("\n"),
    examples: [["med open songs/axel.mod", "load a song"], ["med play", "play from the cursor"], ["med play block", "play this block again and again"], "med mute 2", "med effects"],
    complete: () => ["open", "ls", "demo", "edit", "step", "note", "block", "seq", "tracks", "tempo", "speed", "lpb", "undo", "redo", "new", "copy", "rm", "set", "add", "lines", "play", "stop", "pos", "mute", "solo", "paula", "effects", "info", "song", "block", "on", "off"],
    async run(ctx: ShellContext) {
      const { rest: positional } = parseFlags(ctx.args);
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
              if (!songs.length) return ctx.err("no .med / .mod in the vault (drop one in it)\n"), 1;
              const i = await ib.ui.choose("OPEN A SONG", songs.map((p) => ({ label: p })));
              if (i === null) return 1;
              path = songs[i];
            }
            await open(ctx, ctx.resolve(path));
            void ib.apps.open("breakermed");
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
            if (!(n >= 1 && n <= 60)) return ctx.err("med tracks 1–60\n"), 1;
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
