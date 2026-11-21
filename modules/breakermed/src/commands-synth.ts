/**
 * breakerMED — `med synth …`, `med fm …` and `med drums …`: our computed
 * instruments' settings as commands (the INSTRUMENT screen's presets and kits run these). Every change goes through the editor:
 * ⌘Z / `med undo` brings the old settings back.
 */
import type { IcebreakerAPI, ShellContext } from "./icebreaker";
import type { State } from "./app";
import { findIn, nudgeIn, setIn, showIn } from "./dsp/params";
import { putSettings, settingsOf, type SynthKind } from "./synths";
import { bakeDrum, bakeSynth } from "./dsp/bake";
import { DRUM_KITS, DRUM_NAMES, DRUM_NOTES, DRUM_SETTINGS, drumKit, findDrum, setDrum } from "./dsp/drums";
import { emptyInstrument, hex, type Instrument } from "./song";
import { CHIP_LIKE, chipPresetsFor, CHIPS, parseTable } from "./dsp/chip";

export const SYNTH_USAGE = [
  "med synth <n|.> new [preset]             the instrument becomes an analog synth (presets: med synth presets)",
  "med fm <n|.> new [preset]                the instrument becomes an FM synth (presets: med fm presets)",
  "med synth|fm <n|.> preset <name> · set <setting> <value> · up|down <setting> · show · settings",
  "med synth|fm <n|.> bake                  the synth as a sample of its C-3 (for the sampler's tools)",
  "med chip <n|.> new [preset]              the instrument becomes a chip synth (2a03 dmg sid ay psg pce · med chip presets)",
  "med chip <n|.> set chip|wave|duty|noise|arp|sweep… <value> · table <32 hex digits>   its own wavetable",
];

/** `med synth …` (the analog synth) and `med fm …` (the FM synth): the same commands, each its own settings */
export async function synthCommand(ib: IcebreakerAPI, st: State, ctx: ShellContext, rest: string[], sk: SynthKind): Promise<number> {
  const { fmt } = ib.lib;
  const c = `med ${sk.cmd}`;
  if (rest[0] === "presets" || rest[0] === "settings") {
    ctx.out(rest[0] === "presets" ? (sk.kind === "chip" ? CHIPS.map((ch) => `${ch.padEnd(5)} ${CHIP_LIKE[ch]}\n      ${chipPresetsFor(ch).join(" · ")}`).join("\n") + "\n" : `${sk.presets.join(" · ")}\n`) : sk.params.map((d) => `  ${d.key.padEnd(15)} ${d.label.padEnd(18)} ${d.choices ? d.choices.join(" | ") : `${d.min}…${d.max}${d.unit ? ` ${d.unit}` : ""}`}`).join("\n") + "\n");
    return 0;
  }
  const song = st.song, e = st.editor;
  if (!song || !e) return ctx.err("no song loaded (med open <file>)\n"), 1;
  const [which, op = "show", ...args] = rest;
  const n = which === "." || which === undefined ? st.inst : parseInt(which, 16) - 1;
  if (!(n >= 0 && n < 63)) return ctx.err(`${c} <01–3F | .> new|preset|set|show … (med -h)\n`), 1;
  while (song.instruments.length <= n) song.instruments.push(emptyInstrument());
  const ins = song.instruments[n];
  const id = hex(n + 1);
  const own = (i: Instrument) => settingsOf(i, sk)!;
  const needSynth = () => {
    if (ins.kind !== sk.kind || !settingsOf(ins, sk)) throw new Error(`instrument ${id} isn't ${sk.what} (${c} ${id} new)`);
  };
  // a name of ours ("synth acid", "fm bell") follows the preset; yours stays
  const ours = new RegExp(`^${sk.cmd}( |$)`);
  switch (op) {
    case "new": {
      const name = args[0] ?? "";
      if (name && !sk.presets.includes(name)) return ctx.err(`no preset "${name}": ${sk.presets.join(" · ")}\n`), 1;
      e.instrument(n, `${sk.cmd} ${name || "new"}`, (i) => {
        const keep = i.kind === sk.kind && i.name ? i.name : `${sk.cmd} ${name}`.trim();
        Object.assign(i, emptyInstrument(), { kind: sk.kind, name: keep });
        putSettings(i, sk, sk.preset(name || undefined));
      });
      st.inst = n;
      ctx.out(`${fmt.green("✓")} ${id}: ${sk.what}${name ? ` (${name})` : ""} · play it, or ${c} ${id} ${sk.example}\n`);
      return 0;
    }
    case "preset": {
      needSynth();
      const name = args[0] ?? "";
      if (!sk.presets.includes(name)) return ctx.err(`presets: ${sk.presets.join(" · ")}\n`), 1;
      e.instrument(n, `preset ${name}`, (i) => {
        putSettings(i, sk, sk.preset(name));
        if (ours.test(i.name)) i.name = `${sk.cmd} ${name}`;
      });
      ctx.out(`${fmt.green("✓")} ${id}: ${name}\n`);
      return 0;
    }
    case "set": case "up": case "down": {
      needSynth();
      const def = findIn(sk.params, args[0] ?? "");
      if (!def) return ctx.err(`${c} ${id} ${op} <setting>${op === "set" ? " <value>" : ""} · settings: ${c} settings\n`), 1;
      if (op === "set" && args[1] === undefined) return ctx.err(`${c} ${id} set ${def.key} <${def.choices ? def.choices.join("|") : `${def.min}…${def.max}`}>\n`), 1;
      if (op === "set") setIn(sk.params, structuredClone(own(ins)), def.key, args[1]); // a bad value stops here, before the undo step
      e.instrument(n, def.label, (i) => (op === "set" ? setIn(sk.params, own(i), def.key, args[1]) : nudgeIn(sk.params, own(i), def.key, op === "up" ? 1 : -1, args[1] === "big")));
      if (op === "set") ctx.out(`${fmt.green("✓")} ${id} ${def.label}: ${showIn(own(song.instruments[n]), def)}\n`);
      return 0;
    }
    case "table": {
      // med chip <n> table <32 digits>: the instrument's own wave (0–F: 4 bits, or 0–V: 5 bits)
      needSynth();
      if (sk.kind !== "chip") return ctx.err(`${c}: unknown "table"\n`), 1;
      const v = parseTable(args.join(""));
      if (!v) return ctx.err(`${c} ${id} table <32 digits: 0–F (4 bits) or 0–V (5 bits)> e.g. 0123456789ABCDEFFEDCBA9876543210\n`), 1;
      e.instrument(n, "wavetable", (i) => i.chip && Object.assign(i.chip, { custom: v, table: "custom", wave: "wave" }));
      ctx.out(`${fmt.green("✓")} ${id}: its own wavetable (wave: wave, table: custom)\n`);
      return 0;
    }
    case "bake": {
      needSynth();
      const baked = bakeSynth(ins);
      const [k] = e.addInstruments([{ ...baked, name: `${ins.name} (sample)`.slice(0, 40) }]);
      if (k === undefined) return ctx.err("no free instrument (63 at most)\n"), 1;
      st.inst = k;
      ctx.out(`${fmt.green("✓")} ${hex(k + 1)}: ${id} as a sample (${baked.data.length} frames)\n`);
      return 0;
    }
    case "show": case "info": {
      needSynth();
      ctx.out(`${id} ${ins.name || "(no name)"} · ${sk.what.replace(/^an? /, "")}\n` + sk.params.map((d) => `  ${d.label.padEnd(18)} ${showIn(own(ins), d)}`).join("\n") + "\n");
      return 0;
    }
    default:
      return ctx.err(`${c}: unknown "${op}"\n${SYNTH_USAGE.join("\n")}\n`), 1;
  }
}

// ── the drum machine ──────────────────────────────────────────────────────

export const DRUMS_USAGE = [
  "med drums <n|.> new [kit]                the instrument becomes a drum machine (med drums kits: classic punch tight lofi boom house…)",
  "med drums <n|.> kit <name> · set <drum> tune|decay|level|tone <value> · grit <bits> [hold] · show",
  "med drums <n|.> bake <drum>              one drum as a sample · drums: C kick C# rim D snare D# clap E closed hat",
  "                                         F low tom F# open hat G mid tom G# cowbell A high tom A# crash B ride",
];

export async function drumsCommand(ib: IcebreakerAPI, st: State, ctx: ShellContext, rest: string[]): Promise<number> {
  const { fmt } = ib.lib;
  if (rest[0] === "kits") return ctx.out(`${Object.keys(DRUM_KITS).join(" · ")}\n`), 0;
  const song = st.song, e = st.editor;
  if (!song || !e) return ctx.err("no song loaded (med open <file>)\n"), 1;
  const [which, op = "show", ...args] = rest;
  const n = which === "." || which === undefined ? st.inst : parseInt(which, 16) - 1;
  if (!(n >= 0 && n < 63)) return ctx.err("med drums <01–3F | .> new|kit|set|grit|show … (med -h)\n"), 1;
  while (song.instruments.length <= n) song.instruments.push(emptyInstrument());
  const ins = song.instruments[n];
  const id = hex(n + 1);
  const needKit = () => {
    if (ins.kind !== "drums" || !ins.drums) throw new Error(`instrument ${id} isn't a drum machine (med drums ${id} new)`);
  };
  const drumArg = (x: string | undefined) => {
    const d = findDrum(x ?? "");
    if (d < 0) throw new Error(`which drum? ${DRUM_NAMES.map((name, i) => `${DRUM_NOTES[i]} ${name}`).join(" · ")}`);
    return d;
  };
  switch (op) {
    case "new": case "kit": {
      const name = args[0] ?? (op === "new" ? "classic" : "");
      if (!DRUM_KITS[name]) return ctx.err(`kits: ${Object.keys(DRUM_KITS).join(" · ")}\n`), 1;
      if (op === "kit") needKit();
      e.instrument(n, `kit ${name}`, (i) => {
        if (op === "new") Object.assign(i, emptyInstrument(), { kind: "drums", name: i.kind === "drums" && i.name ? i.name : `drums ${name}` });
        else if (/^drums( |$)/.test(i.name)) i.name = `drums ${name}`;
        i.drums = drumKit(name);
      });
      st.inst = n;
      if (op === "new") ctx.out(`${fmt.green("✓")} ${id}: a drum machine (${name}) · C kick, D snare, E closed hat, F# open hat… one a note of any octave\n`);
      else ctx.out(`${fmt.green("✓")} ${id}: ${name}\n`);
      return 0;
    }
    case "set": {
      needKit();
      const d = drumArg(args[0]);
      const key = DRUM_SETTINGS.find((s) => s.key === args[1])?.key;
      const v = parseFloat(args[2] ?? "");
      if (!key || !Number.isFinite(v)) return ctx.err(`med drums ${id} set <drum> ${DRUM_SETTINGS.map((s) => `${s.key} ${s.min}…${s.max}`).join(" | ")}\n`), 1;
      e.instrument(n, `${DRUM_NAMES[d]} ${key}`, (i) => setDrum(i.drums!, d, key, v));
      ctx.out(`${fmt.green("✓")} ${id} ${DRUM_NAMES[d]} ${key}: ${song.instruments[n].drums!.drums[d][key]}\n`);
      return 0;
    }
    case "grit": {
      needKit();
      const bits = parseInt(args[0] ?? "", 10), hold = parseInt(args[1] ?? "1", 10);
      if (!(bits >= 1 && bits <= 16) || !(hold >= 1 && hold <= 16)) return ctx.err(`med drums ${id} grit <bits 1–16, 16 = clean> [hold 1–16]\n`), 1;
      e.instrument(n, "grit", (i) => ((i.drums!.bits = bits), (i.drums!.hold = hold)));
      ctx.out(`${fmt.green("✓")} ${id}: ${bits >= 16 && hold <= 1 ? "clean" : `${bits} bits${hold > 1 ? `, ×${hold}` : ""}`}\n`);
      return 0;
    }
    case "bake": {
      needKit();
      const d = drumArg(args[0]);
      const baked = bakeDrum(ins, d);
      const [k] = e.addInstruments([baked]);
      if (k === undefined) return ctx.err("no free instrument (63 at most)\n"), 1;
      st.inst = k;
      ctx.out(`${fmt.green("✓")} ${hex(k + 1)} ${baked.name}: ${id}'s ${DRUM_NAMES[d]} as a sample (${baked.data.length} frames)\n`);
      return 0;
    }
    case "show": case "info": {
      needKit();
      const k = ins.drums!;
      ctx.out(
        `${id} ${ins.name || "(no name)"} · drum machine${k.bits < 16 || k.hold > 1 ? ` · grit ${k.bits} bits ×${k.hold}` : ""}\n` +
          `       ${"drum".padEnd(11)} tune decay level tone\n` +
          k.drums.map((d, i) => `  ${DRUM_NOTES[i].padEnd(3)}  ${DRUM_NAMES[i].padEnd(11)} ${String(d.tune).padStart(4)} ${d.decay.toFixed(1).padStart(5)} ${d.level.toFixed(2).padStart(5)} ${d.tone.toFixed(2).padStart(4)}`).join("\n") +
          "\n",
      );
      return 0;
    }
    default:
      return ctx.err(`med drums: unknown "${op}"\n${DRUMS_USAGE.join("\n")}\n`), 1;
  }
}
