/**
 * breakerMED — `med sample …`, `med bounce`, `med filter`: the sampler's tools
 * as commands (the INSTRUMENT screen's buttons run these). Every change goes
 * through the editor: ⌘Z / `med undo` brings the sound back.
 */
import { PACK, PACK_DIR } from "./pack";
import { placeholderFor } from "./placeholder";
import type { IcebreakerAPI, ShellContext } from "./icebreaker";
import type { Engine } from "./engine";
import type { State } from "./app";
import { renderSong } from "./export";
import { readSample, SAMPLE_EXTS } from "./format/sample";
import { chop, crush, fade, HQ_RATE, normalize, onsets, pitch, reverse, sliceAt, stretch, toMono, trim } from "./sampler";
import { emptyInstrument, heardRate, hex, trackName, type Instrument } from "./song";

export const SAMPLE_USAGE = [
  "med sample <n|.> load [file] [--amiga]   a sound file in songs/ (wav, aif, iff/8svx, mp3, m4a, ogg…)",
  "med sample <n|.> chop <slices> | chop onsets    slices become new instruments",
  "med sample <n|.> stretch <×> [grain]     longer / shorter, same pitch, the Amiga way (it grinds)",
  "med sample <n|.> fade in|out [ms] · pitch <semitones> [--smooth] · reverse",
  "med sample <n|.> crush [bits] [hold]     destructive 8-bit (default) and lower rate (hold > 1)",
  "med sample <n|.> normalize · trim · loop <start> <length> | off | pingpong",
  "med sample <n|.> name <text> · vol <0–64> · fine <-8…7> · transpose <semitones> · clear · info",
  "med bounce [--tracks 1,3] [--song]       the block (or the song) rendered into a new instrument",
  "med filter on|off                        the A500's LED filter (also 0FF9 / 0FF8)",
];

export async function sampleCommand(ib: IcebreakerAPI, st: State, ctx: ShellContext, rest: string[], flags: Record<string, string | true>): Promise<number> {
  const { fmt } = ib.lib;
  const song = st.song;
  const e = st.editor;
  if (!song || !e) return ctx.err("no song loaded (med open <file>)\n"), 1;
  const [which, op, ...args] = rest;
  const n = which === "." || which === undefined ? st.inst : parseInt(which, 16) - 1;
  if (!(n >= 0 && n < 63)) return ctx.err("med sample <01–3F | .> <tool> … (med -h)\n"), 1;
  while (song.instruments.length <= n) song.instruments.push(emptyInstrument());
  const ins = song.instruments[n];
  const name = `${hex(n + 1)} ${ins.name || "(no name)"}`;
  const needSound = () => {
    if (!ins.data.length) throw new Error(`instrument ${hex(n + 1)} is empty (med sample ${hex(n + 1)} load <file>)`);
  };
  const ms = (x: string | undefined, d: number) => Math.round(((x !== undefined ? parseFloat(x) : d) / 1000) * heardRate(ins));
  const change = (label: string, fn: (i: Instrument) => void) => {
    needSound();
    e.instrument(n, label, fn);
    ctx.out(`${fmt.green("✓")} ${name}: ${label}\n`);
  };
  switch (op) {
    case undefined:
    case "info": {
      const secs = ins.data.length / heardRate(ins);
      ctx.out(`${name} · ${ins.kind} · ${ins.data.length} frames (~${secs.toFixed(2)} s at C-3${ins.rate ? `, ${ins.rate} Hz` : ""}) · vol ${ins.volume} · fine ${ins.finetune} · transpose ${ins.transpose}${ins.loopLength ? ` · loop ${ins.loopStart}+${ins.loopLength}${ins.pingPong ? " ping-pong" : ""}` : ""}\n`);
      return 0;
    }
    case "load": {
      let file = args.join(" ");
      if (!file) {
        const found: string[] = [];
        const walk = async (dir: string, depth: number) => {
          if (depth > 4 || found.length > 300) return;
          for (const x of await ib.vault.list(dir).catch(() => [])) {
            if (x.isDir) {
              if (!x.name.startsWith(".") && !x.name.endsWith(".bmed")) await walk(x.path, depth + 1);
            } else if (SAMPLE_EXTS.some((ext) => x.name.toLowerCase().endsWith(ext))) found.push(x.path);
          }
        };
        await walk("songs", 0); // the module sees only songs/
        // and the starter pack's sounds nobody has recorded yet: computed placeholders
        const missing = PACK.filter((p) => !found.includes(`${PACK_DIR}/${p.file}`));
        const labels = [...found, ...missing.map((p) => `pack: ${p.file.split("/").pop()!.replace(/\.wav$/, "")} (placeholder) · ${p.what}`)];
        const i = await ib.ui.choose(found.length ? ib.lib.t("load a sound") : ib.lib.t("load a sound (none in songs/ yet: the pack's placeholders)"), labels.map((label) => ({ label })));
        if (i === null) return 1;
        if (i >= found.length) {
          const p = missing[i - found.length];
          const ins = placeholderFor(p);
          e.addInstruments([ins], n);
          st.inst = n;
          ctx.out(`${fmt.green("✓")} ${hex(n + 1)} ${ins.name}: computed, until someone records ${p.file} (SOUND_DESIGN.md)\n`);
          return 0;
        }
        file = found[i];
      } else file = ctx.resolve(file);
      const bytes = await ib.vault.readBytes(file);
      const loaded = await readSample(bytes, file, (b) => ib.audio.decode(b), !!flags.amiga);
      e.addInstruments([loaded], n);
      st.inst = n;
      ctx.out(`${fmt.green("✓")} ${hex(n + 1)} ${loaded.name}: ${loaded.data.length} frames${flags.amiga ? " (Amiga rate)" : ""}\n`);
      return 0;
    }
    case "chop": {
      needSound();
      const parts = args[0] === "onsets" ? sliceAt(ins.data, onsets(ins.data)) : chop(ins.data, parseInt(args[0] ?? "4", 10) || 4);
      const made = e.addInstruments(parts.map((d, k) => ({ ...ins, name: `${ins.name || "slice"} ${k + 1}`.slice(0, 40), data: d, loopStart: 0, loopLength: 0, pingPong: false })));
      ctx.out(`${fmt.green("✓")} ${name}: ${made.length} slice(s) → ${made.map((k) => hex(k + 1)).join(" ")}${made.length < parts.length ? fmt.dim(` (${parts.length - made.length} didn't fit: 63 instruments at most)`) : ""}\n`);
      return 0;
    }
    case "stretch": {
      const f = parseFloat(args[0] ?? "2");
      if (!(f > 0)) return ctx.err("med sample <n> stretch <factor, e.g. 2 or 0.5> [grain]\n"), 1;
      change(`stretch ×${f}`, (i) => (i.data = stretch(i.data, f, parseInt(args[1] ?? "512", 10) || 512)));
      return 0;
    }
    case "fade": {
      const dir = args[0] === "in" ? "in" : args[0] === "out" ? "out" : null;
      if (!dir) return ctx.err("med sample <n> fade in|out [ms]\n"), 1;
      change(`fade ${dir}`, (i) => (i.data = fade(i.data, dir, args[1] ? ms(args[1], 0) : i.data.length)));
      return 0;
    }
    case "pitch": {
      const s = parseFloat(args[0] ?? "");
      if (!Number.isFinite(s)) return ctx.err("med sample <n> pitch <semitones> [--smooth]\n"), 1;
      change(`pitch ${s > 0 ? "+" : ""}${s}`, (i) => {
        const k = 2 ** (s / 12);
        i.data = pitch(i.data, s, !!flags.smooth);
        i.loopStart = Math.round(i.loopStart / k);
        i.loopLength = Math.round(i.loopLength / k);
      });
      return 0;
    }
    case "reverse": change("reverse", (i) => ((i.data = reverse(i.data)), (i.loopLength = 0))); return 0;
    case "crush": {
      const bits = parseInt(args[0] ?? "8", 10) || 8, hold = parseInt(args[1] ?? "1", 10) || 1;
      change(`crush ${bits} bits${hold > 1 ? ` ×${hold}` : ""}`, (i) => (i.data = crush(i.data, bits, hold)));
      return 0;
    }
    case "normalize": change("normalize", (i) => (i.data = normalize(i.data))); return 0;
    case "trim":
      change("trim", (i) => {
        const r = trim(i.data);
        i.data = r.data;
        i.loopStart = Math.max(0, i.loopStart - r.start);
      });
      return 0;
    case "loop": {
      if (args[0] === "off") change("no loop", (i) => ((i.loopStart = 0), (i.loopLength = 0), (i.pingPong = false)));
      else if (args[0] === "pingpong") change("ping-pong loop", (i) => ((i.pingPong = !i.pingPong), i.loopLength || ((i.loopStart = 0), (i.loopLength = i.data.length))));
      else {
        const a = parseInt(args[0] ?? "", 10), b = parseInt(args[1] ?? "", 10);
        if (!(a >= 0 && b > 2)) return ctx.err("med sample <n> loop <start> <length> | off | pingpong\n"), 1;
        change(`loop ${a}+${b}`, (i) => ((i.loopStart = a), (i.loopLength = b)));
      }
      return 0;
    }
    case "name": e.instrument(n, "name", (i) => (i.name = args.join(" ").slice(0, 40))); return 0;
    case "vol": case "fine": case "transpose": {
      const v = parseInt(args[0] ?? "", 10);
      const [lo, hi] = op === "vol" ? [0, 64] : op === "fine" ? [-8, 7] : [-48, 48];
      if (!(v >= lo && v <= hi)) return ctx.err(`med sample <n> ${op} ${lo}…${hi}\n`), 1;
      e.instrument(n, op, (i) => (op === "vol" ? (i.volume = v) : op === "fine" ? (i.finetune = v) : (i.transpose = v)));
      return 0;
    }
    case "clear": e.instrument(n, "clear", (i) => Object.assign(i, emptyInstrument())); return 0;
    default:
      return ctx.err(`med sample: unknown "${op}"\n${SAMPLE_USAGE.join("\n")}\n`), 1;
  }
}

/** `med bounce`: the block (or the song) with these tracks, rendered into a new instrument. */
export async function bounce(ib: IcebreakerAPI, engine: Engine, st: State, ctx: ShellContext, flags: Record<string, string | true>): Promise<number> {
  const song = st.song, e = st.editor;
  if (!song || !e) return ctx.err("no song loaded\n"), 1;
  const solo = flags.tracks ? String(flags.tracks).split(",").map((x) => parseInt(x, 10) - 1).filter((t) => t >= 0 && t < song.tracks) : undefined;
  const view = flags.song ? song : { ...song, sequence: [song.sequence[st.seq] ?? 0] };
  const pcm = await renderSong(view, { rate: Math.round(HQ_RATE), bits: 32, paula: engine.paula, solo, muted: engine.muted, tail: 0.25 });
  const ins = emptyInstrument();
  ins.name = `bounce ${solo ? solo.map((t) => trackName(song, t)).join("+") : "all"}`.slice(0, 40);
  ins.data = toMono(pcm.channels, pcm.rate, pcm.rate);
  ins.transpose = 12;
  ins.kind = "sample";
  const [k] = e.addInstruments([ins]);
  if (k === undefined) return ctx.err("no free instrument (63 at most)\n"), 1;
  st.inst = k;
  ctx.out(`${ib.lib.fmt.green("✓")} ${hex(k + 1)} ${ins.name}: ${ins.data.length} frames (C-3 plays it as it was)\n`);
  return 0;
}
