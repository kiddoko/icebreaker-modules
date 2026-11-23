/**
 * The help, the completion, the README, the page and the French table say the
 * same as the code (Fable's review of 0.12.1, §8.7): a command added in one
 * place and forgotten in another fails here.
 */
import { describe, expect, it } from "vitest";
import { COMPLETE, SUBS, USAGE } from "../src/commands";
import { readmeWithUsage } from "../build.mjs";
import README from "../README.md?raw";
import PLUGIN from "../plugin.json?raw";
import PACKAGE from "../package.json?raw";

const SRC = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
const src = (f: string) => SRC[`../src/${f}`] ?? "";
const usage = USAGE.join("\n");

describe("0.13 §8: every command, said everywhere", () => {
  it("SUBS is the dispatcher: every case of its switch, and the words sent to sample, the synths, drums, bounce", () => {
    const code = src("commands.ts");
    const run = code.slice(code.indexOf("async run(ctx: ShellContext)"));
    const cases = new Set([...run.matchAll(/^ {10}case "([a-z]*)":/gm)].map((m) => m[1]));
    const routed = ["sample", "smp", "synth", "fm", "chip", "drums", "bounce"];
    expect([...cases, ...routed].sort()).toEqual([...SUBS].sort());
  });
  it("every sub-command is in the help (med -h, med help)", () => {
    for (const sub of SUBS.filter((x) => x && x !== "smp")) expect(usage, sub).toMatch(new RegExp(`(med |· )(\\S+\\|)?${sub}\\b`));
  });
  it("the completion holds every sub-command", () => {
    for (const sub of SUBS.filter((x) => x && x !== "smp")) expect(COMPLETE, sub).toContain(sub);
  });
  it("every med line the page runs starts with a real sub-command", () => {
    const page = ["app.ts", "screens.ts", "start.ts", "main.ts"].map(src).join("\n");
    const lines = [...page.matchAll(/(?:cmd: |run\(|shell\.run\()[`"]med ?([a-z]*)/g)].map((m) => m[1]);
    expect(lines.length).toBeGreaterThan(40);
    for (const w of lines) expect(SUBS, `med ${w}`).toContain(w);
  });
  it("README's command block is the help, word for word (npm run build writes it)", () => {
    expect(readmeWithUsage(README, USAGE)).toBe(README);
  });
  it("plugin.json, package.json and the README agree with the code", () => {
    const plugin = JSON.parse(PLUGIN);
    const pkg = JSON.parse(PACKAGE);
    const readme = README;
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.description).not.toMatch(/8 to 16 tracks/);
    for (const p of plugin.permissions as string[]) expect(readme, p).toContain(`\`${p}\``);
    expect(readme).toContain(plugin.requires.icebreaker.replace(">=", ""));
    expect(readme).not.toMatch(/breakerMED/);
  });
});

describe("0.13 I6: the French table", () => {
  it("every string shown through t() (and the guide's rows) has its French", () => {
    const all = Object.entries(SRC).filter(([p]) => !p.endsWith("/main.ts")).map(([, text]) => text).join("\n");
    const main = src("main.ts");
    const fr = main.slice(main.indexOf("const FR"));
    const keys = new Set([
      ...[...fr.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map((m) => m[1]),
      ...[...fr.matchAll(/^\s*([A-Za-z_]+)\s*:/gm)].map((m) => m[1]),
    ]);
    const used = new Set([...all.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]));
    const guide = src("guide.ts");
    for (const m of guide.matchAll(/\["((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\]/g)) used.add(m[2]);
    for (const m of guide.matchAll(/title:\s*"((?:[^"\\]|\\.)*)"/g)) used.add(m[1]);
    used.delete("");
    const missing = [...used].filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });
});
