/**
 * breakerMED — `med synth …`: the analog synth's settings as commands (the
 * INSTRUMENT screen's rows run these). Every change goes through the editor:
 * ⌘Z / `med undo` brings the old settings back.
 */
import type { IcebreakerAPI, ShellContext } from "./icebreaker";
import type { State } from "./app";
import { ANALOG_PARAMS, ANALOG_PRESETS, analogPreset, findParam, nudgeParam, setParam, showParam } from "./dsp/analog";
import { bakeSynth } from "./dsp/bake";
import { emptyInstrument, hex } from "./song";

export const SYNTH_USAGE = [
  "med synth <n|.> new [preset]             the instrument becomes an analog synth (presets: med synth presets)",
  "med synth <n|.> preset <name> · set <setting> <value> · up|down <setting> · show",
  "med synth <n|.> bake                     the synth as a sample of its C-3 (for the sampler's tools)",
];

export async function synthCommand(ib: IcebreakerAPI, st: State, ctx: ShellContext, rest: string[]): Promise<number> {
  const { fmt } = ib.lib;
  if (rest[0] === "presets" || rest[0] === "settings") {
    ctx.out(rest[0] === "presets" ? `${Object.keys(ANALOG_PRESETS).join(" · ")}\n` : ANALOG_PARAMS.map((d) => `  ${d.key.padEnd(15)} ${d.label.padEnd(18)} ${d.choices ? d.choices.join(" | ") : `${d.min}…${d.max}${d.unit ? ` ${d.unit}` : ""}`}`).join("\n") + "\n");
    return 0;
  }
  const song = st.song, e = st.editor;
  if (!song || !e) return ctx.err("no song loaded (med open <file>)\n"), 1;
  const [which, op = "show", ...args] = rest;
  const n = which === "." || which === undefined ? st.inst : parseInt(which, 16) - 1;
  if (!(n >= 0 && n < 63)) return ctx.err("med synth <01–3F | .> new|preset|set|show … (med -h)\n"), 1;
  while (song.instruments.length <= n) song.instruments.push(emptyInstrument());
  const ins = song.instruments[n];
  const id = hex(n + 1);
  const needSynth = () => {
    if (ins.kind !== "analog" || !ins.synth) throw new Error(`instrument ${id} isn't a synth (med synth ${id} new)`);
  };
  switch (op) {
    case "new": {
      const name = args[0] ?? "";
      if (name && !ANALOG_PRESETS[name]) return ctx.err(`no preset "${name}": ${Object.keys(ANALOG_PRESETS).join(" · ")}\n`), 1;
      e.instrument(n, `synth ${name || "new"}`, (i) => {
        Object.assign(i, emptyInstrument(), { kind: "analog", name: i.name && i.kind === "analog" ? i.name : `synth ${name || ""}`.trim(), synth: analogPreset(name || undefined) });
      });
      st.inst = n;
      ctx.out(`${fmt.green("✓")} ${id}: an analog synth${name ? ` (${name})` : ""} · play it, or med synth ${id} set cutoff 800\n`);
      return 0;
    }
    case "preset": {
      needSynth();
      const name = args[0] ?? "";
      if (!ANALOG_PRESETS[name]) return ctx.err(`presets: ${Object.keys(ANALOG_PRESETS).join(" · ")}\n`), 1;
      e.instrument(n, `preset ${name}`, (i) => {
        i.synth = analogPreset(name);
        if (/^synth( |$)/.test(i.name)) i.name = `synth ${name}`; // a name of ours follows the preset; yours stays
      });
      ctx.out(`${fmt.green("✓")} ${id}: ${name}\n`);
      return 0;
    }
    case "set": case "up": case "down": {
      needSynth();
      const def = findParam(args[0] ?? "");
      if (!def) return ctx.err(`med synth ${id} ${op} <setting>${op === "set" ? " <value>" : ""} · settings: med synth settings\n`), 1;
      if (op === "set" && args[1] === undefined) return ctx.err(`med synth ${id} set ${def.key} <${def.choices ? def.choices.join("|") : `${def.min}…${def.max}`}>\n`), 1;
      if (op === "set") setParam(structuredClone(ins.synth!), def.key, args[1]); // a bad value stops here, before the undo step
      e.instrument(n, def.label, (i) => (op === "set" ? setParam(i.synth!, def.key, args[1]) : nudgeParam(i.synth!, def.key, op === "up" ? 1 : -1, args[1] === "big")));
      if (op === "set") ctx.out(`${fmt.green("✓")} ${id} ${def.label}: ${showParam(song.instruments[n].synth!, def)}\n`);
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
      ctx.out(`${id} ${ins.name || "(no name)"} · analog synth\n` + ANALOG_PARAMS.map((d) => `  ${d.label.padEnd(18)} ${showParam(ins.synth!, d)}`).join("\n") + "\n");
      return 0;
    }
    default:
      return ctx.err(`med synth: unknown "${op}"\n${SYNTH_USAGE.join("\n")}\n`), 1;
  }
}
