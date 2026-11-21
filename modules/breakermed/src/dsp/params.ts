/**
 * breakerMED — the settings of our computed instruments, one by one: a list
 * says each one's key ("filter.cutoff"), its label, its choices or its range.
 * The commands, the INSTRUMENT screen and .bmed all go through it, for every
 * kind of synth (analog.ts, fm.ts), so a new setting is one line in a list.
 */

export interface Param {
  /** where it lives: "filter.cutoff" (one level of nesting at most) */
  key: string;
  /** what the screen shows */
  label: string;
  /** a list of choices, or a range */
  choices?: readonly string[];
  /** the choices are numbers ("12", "24"): stored as numbers */
  numeric?: boolean;
  min?: number;
  max?: number;
  /** a step for ←→ (a × step when `log`: frequencies and times) */
  step?: number;
  log?: boolean;
  unit?: string;
}

type Obj = Record<string, unknown>;

/** a setting by its key, or its label, or the last part of its key ("cutoff", "reso"…) */
export function findIn(table: readonly Param[], name: string): Param | undefined {
  const n = name.toLowerCase();
  return table.find((x) => x.key === n) ?? table.find((x) => x.key.endsWith("." + n) || x.label === n) ?? table.find((x) => x.key.split(".").pop()!.startsWith(n) && n.length >= 3);
}

export function getIn(p: object, key: string): string | number {
  const [a, b] = key.split(".");
  const v = b ? ((p as Obj)[a] as Obj)[b] : (p as Obj)[a];
  return typeof v === "number" || typeof v === "string" ? v : String(v);
}

/** A setting from text ("saw", "800", "1.5k") — checked and clamped. Throws on a bad value. */
export function setIn(table: readonly Param[], p: object, key: string, text: string): void {
  const def = table.find((x) => x.key === key);
  if (!def) throw new Error(`no setting "${key}"`);
  let v: string | number;
  if (def.choices) {
    if (!def.choices.includes(text)) throw new Error(`${def.label}: ${def.choices.join(" | ")}`);
    v = def.numeric ? +text : text;
  } else {
    const m = /^(-?[\d.]+)(k?)$/i.exec(text.trim());
    const x = m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : NaN;
    if (!Number.isFinite(x)) throw new Error(`${def.label}: a number, ${def.min}…${def.max}`);
    v = Math.max(def.min!, Math.min(def.max!, x));
  }
  const [a, b] = key.split(".");
  if (b) ((p as Obj)[a] as Obj)[b] = v;
  else (p as Obj)[a] = v;
}

/** One step up or down (←→ on the screen): the next choice, or the next value. */
export function nudgeIn(table: readonly Param[], p: object, key: string, dir: 1 | -1, big = false): void {
  const def = table.find((x) => x.key === key)!;
  const cur = getIn(p, key);
  if (def.choices) {
    const i = def.choices.indexOf(String(cur));
    setIn(table, p, key, def.choices[(i + dir + def.choices.length) % def.choices.length]);
    return;
  }
  const x = Number(cur);
  const times = big ? 4 : 1;
  let next: number;
  if (def.log) next = x <= 0 ? (dir > 0 ? 0.001 : 0) : x * def.step! ** (dir * times);
  else next = Math.round((x + dir * def.step! * times) / def.step!) * def.step!;
  if (def.log && next < 0.001 && dir < 0) next = def.min!;
  setIn(table, p, key, String(+next.toPrecision(4)));
}

/** a setting as the screen shows it */
export function showIn(p: object, def: Param): string {
  const v = getIn(p, def.key);
  if (typeof v === "string") return v + (def.unit ? ` ${def.unit}` : "");
  const text = def.unit === "Hz" && v >= 1000 ? `${+(v / 1000).toFixed(2)}k` : def.unit === "s" && v < 1 ? `${Math.round(v * 1000)} ms` : String(+v.toFixed(2));
  return text + (def.unit && !(def.unit === "s" && v < 1) ? ` ${def.unit}` : "");
}

/** Settings read from a file onto `fresh` (the defaults): every value checked, anything wrong kept as it was. */
export function sanitizeWith<T extends object>(table: readonly Param[], fresh: T, j: unknown): T {
  if (!j || typeof j !== "object") return fresh;
  for (const def of table) {
    const [a, b] = def.key.split(".");
    const o = j as Obj;
    const raw = b ? (o[a] as Obj | undefined)?.[b] : o[a];
    if (raw === undefined || raw === null) continue;
    try {
      setIn(table, fresh, def.key, String(raw));
    } catch {
      /* keep the default */
    }
  }
  return fresh;
}
