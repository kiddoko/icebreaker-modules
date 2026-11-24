/**
 * The part of ICEBREAKER's module API that BreakerMED uses, as types only
 * (nothing here runs). The full API is ICEBREAKER's `src/plugins/api.ts` and
 * docs/PLUGINS.md; these lines follow it, so the module builds and is tested
 * on its own, in this repository.
 *
 * BreakerMED needs ICEBREAKER 0.6.0 or later (`ib.audio`, the modules' sampler,
 * and pages that play the keyboard, `rawKeys`); 0.6.2 hands ⌘S and tab to the
 * page; 0.7.0 F1–F8, ⌘←→, ⇧Tab and an autosave that never asks. Still to come
 * from the deck (none typed here yet): `ui.pickFileBytes` (a sound from
 * anywhere), a full-window page, `ui.art` for sandboxed modules.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** a colour as the theme gives it */
export type RGB = number;

export interface Style {
  fg?: RGB;
  bg?: RGB;
  attrs?: number;
}

export interface KeyInput {
  /** "a", "enter", "up", "space", "esc"… */
  key: string;
  /** the key's place: "KeyZ" is Z on QWERTY, W on AZERTY */
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  combo: string;
  /** held down */
  repeat?: boolean;
}

export type Action = "up" | "down" | "left" | "right" | "confirm" | "back" | "page-up" | "page-down" | "home" | "end" | (string & {});

export interface MouseInput {
  x: number;
  y: number;
}

export type MenuEntry = "-" | { label: string; cmd?: string; run?: () => unknown; hint?: string; danger?: boolean; disabled?: boolean };

export interface Hit {
  onClick?: (m: MouseInput) => void;
  onDouble?: (m: MouseInput) => void;
  onDrag?: (m: MouseInput) => void;
  onUp?: (m: MouseInput) => void;
  onWheel?: (delta: number, m: MouseInput) => void;
  menu?: () => MenuEntry[];
  cmd?: string;
  tip?: string;
}

export interface ThemeColors {
  bg: RGB; panel: RGB; panelAlt: RGB; highlight: RGB;
  fg: RGB; muted: RGB; subtle: RGB; faint: RGB;
  accent: RGB; accentAlt: RGB; success: RGB; warning: RGB; error: RGB;
}

/** what `render` draws with (ICEBREAKER's src/ui/ui.ts) */
export interface UI {
  readonly c: ThemeColors;
  animate(ms?: number): void;
  /** returns the x after the text */
  text(x: number, y: number, s: string, style?: Style, maxW?: number): number;
  textCenter(r: Rect, y: number, s: string, style?: Style): number;
  /** returns where the text starts */
  textRight(xEnd: number, y: number, s: string, style?: Style): number;
  fill(r: Rect, style?: Style, ch?: string): void;
  tint(r: Rect, fg?: RGB, bg?: RGB): void;
  box(r: Rect, o?: { title?: string; focused?: boolean }): Rect;
  hit(rect: Rect, h: Hit): void;
  /** the kit's button; returns its width */
  button(x: number, y: number, label: string, onClick: () => void, o?: { cmd?: string; tip?: string; selected?: boolean; quiet?: boolean; disabled?: boolean }): number;
}

export interface App {
  readonly kind: string;
  readonly key: string;
  /** every key as a key (with its place), never as text, while this page is in front */
  rawKeys?: boolean;
  title(): string;
  render(ui: UI, rect: Rect, focused: boolean): void;
  onKey?(k: KeyInput): boolean;
  onText?(text: string): boolean;
  onAction?(a: Action): boolean;
  status?(): string;
  dirty?(): boolean;
  menu?(): MenuEntry[];
  close?(): Promise<boolean> | boolean;
}

export interface ShellContext {
  args: string[];
  out(text: string): void;
  err(text: string): void;
  /** a path the user typed, relative to the shell's folder → vault-relative */
  resolve(path: string): string;
}

export interface Command {
  name: string;
  summary: string;
  usage?: string;
  examples?: (string | [string, string])[];
  complete?: () => string[];
  run(ctx: ShellContext): unknown;
}

/** ICEBREAKER's one list (src/ui/list.ts): selection, scrolling, mouse, keys, gamepad */
export interface ListView<T> {
  items: T[];
  selected: number;
  onActivate?: (item: T, index: number) => void;
  onSelect?: (item: T, index: number) => void;
  cmdOf?: (item: T) => string | undefined;
  menuOf?: (item: T, index: number) => MenuEntry[];
  /** drag a row onto another (ICEBREAKER's lists): `target` the row it was dropped on */
  onDrop?: (item: T, target: T | undefined) => void;
  tipOf?: (item: T) => string | undefined;
  select(i: number): void;
  render(ui: UI, r: Rect, focused: boolean, drawRow: (item: T, row: Rect, selected: boolean, index: number) => void): void;
}

export interface VaultEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export interface IcebreakerAPI {
  commands: { register(cmd: Command): void };
  apps: {
    register(spec: { kind: string; title: string; description?: string; icon?: string; launcher?: boolean; rawKeys?: boolean; create: () => App }): void;
    open(kind: string, args?: unknown): Promise<unknown>;
  };
  palette: { register(a: { id: string; title: string; key?: string; run: () => unknown }): void };
  shell: { run(line: string): Promise<number> };
  vault: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    list(dir: string): Promise<VaultEntry[]>;
    readBytes(path: string): Promise<Uint8Array>;
    writeBytes(path: string, data: Uint8Array | ArrayBuffer): Promise<void>;
  };
  storage: { get<T>(key: string, fallback: T): Promise<T>; set(key: string, value: unknown): Promise<void> };
  ui: {
    notify(text: string, kind?: "info" | "success" | "warning" | "error"): void;
    choose(title: string, options: { label: string }[], opts?: { selected?: number }): Promise<number | null>;
    prompt(title: string, opts?: { initial?: string; placeholder?: string }): Promise<string | null>;
    redraw(): void;
    pickFile?(title: string, exts?: string[]): Promise<string | null>;
  };
  audio: {
    available(): boolean;
    now(): Promise<number>;
    sample(id: string, data: Float32Array | Int8Array | Int16Array | Uint8Array, opts?: { loopStart?: number; loopLength?: number }): Promise<void>;
    drop(id?: string): Promise<void>;
    schedule(events: object[]): Promise<void>;
    stop(): Promise<void>;
    /** a line for sound the module computes itself: the deck asks for `frames` more when it runs low */
    stream(): Promise<{ rate: number; low: number; high: number; onPull?: (frames: number, played: number, buffered: number) => void; write(left: Float32Array, right: Float32Array): void; close(): void }>;
    /** the user silenced the module (`audio stop`, the ♪ in the status bar) */
    onStop(fn: () => void): () => void;
    decode(bytes: Uint8Array | ArrayBuffer): Promise<{ rate: number; channels: Float32Array[] }>;
    /** interleaved floats → an MP3 / M4A / OGG / Opus file's bytes, through the deck's encoder pack (ICEBREAKER 0.5.5+) */
    encode?(pcm: Float32Array, opts: { format: "mp3" | "m4a" | "ogg" | "opus"; quality?: string; rate: number; channels: 1 | 2; title?: string }): Promise<Uint8Array>;
    /** is the encoder pack installed (`encoders install`), and what it makes */
    encoders?(): Promise<{ installed: boolean; supported: boolean; formats: string[] }>;
  };
  lib: {
    BOLD: number;
    /** `vars` are filled in after the deck lowers the text (its uiCase): a name in one keeps its case */
    t(english: string, vars?: Record<string, string | number>): string;
    addTranslations(lang: string, table: Record<string, string>): void;
    truncate(s: string, w: number): string;
    /** a shell argument, quoted safely */
    q(s: string): string;
    mix(a: RGB, b: RGB, k: number): RGB;
    /** `withValue`: the flags that take the next word as their value (--rate 48000) */
    parseFlags(args: string[], withValue?: string[]): { flags: Record<string, string | true>; rest: string[] };
    fmt: { green(s: string): string; cyan(s: string): string; dim(s: string): string };
    ListView: new <T>() => ListView<T>;
  };
}
