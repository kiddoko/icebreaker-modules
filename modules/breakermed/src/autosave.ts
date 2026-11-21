/**
 * BreakerMED — the autosave: a copy of the song after each change, so quitting,
 * a crash or a closed tab never loses work. Never over the real song: the copy
 * goes in songs/.recovery/ (a .bmed of its own, songs/ is the module's folder),
 * and an index says whose copy it is and when. Opening the song again (or START,
 * or `med recover`) offers it back; `med save` makes it useless, so it's forgotten.
 *
 * When: 1.5 s after a change (a run of keys makes one copy), at most every
 * `every` seconds while the song plays or the changes keep coming.
 */
import { readBmed, writeBmed } from "./format/bmed";
import type { Editor } from "./edit";
import type { Song } from "./song";

export const RECOVERY_DIR = "songs/.recovery";
/** after a change, the copy waits this long for the next one (ms) */
export const QUIET_MS = 1500;

export interface Recovery {
  /** the song it's a copy of (where it was opened from, or "untitled.bmed") */
  path: string;
  /** the copy: a .bmed folder in RECOVERY_DIR */
  file: string;
  title: string;
  /** when it was written (ms since 1970) */
  at: number;
}

export interface AutosaveIO {
  vault: {
    read(path: string): Promise<string>;
    readBytes(path: string): Promise<Uint8Array>;
    write(path: string, content: string): Promise<void>;
    writeBytes(path: string, data: Uint8Array): Promise<void>;
    mkdir(path: string): Promise<void>;
  };
  storage: { get<T>(key: string, fallback: T): Promise<T>; set(key: string, value: unknown): Promise<void> };
  now(): number;
  later(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/** what the autosave looks at: the song on the page */
export interface Current {
  song: Song | null;
  editor: Editor | null;
  path: string;
  playing: boolean;
}

/** the copy's folder for a song: its path made a file name */
export const recoveryFile = (path: string) => `${RECOVERY_DIR}/${(path.replace(/\.(bmed|med|mod|mmd\d)$/i, "").replace(/[^\w.-]+/g, "_") || "untitled").slice(-80)}.bmed`;

export class Autosave {
  on = true;
  /** seconds between copies at most, while the song plays or the changes keep coming */
  every = 30;
  /** when the last copy was written (0: none yet), and why the autosave stopped */
  lastAt = 0;
  error = "";
  /** told once when a copy can't be written (no permission, the vault is gone…) */
  onError?: (message: string) => void;
  private changes = 0;
  private copied = 0;
  private firstPending = 0;
  private timer: unknown = null;
  private writing: Promise<void> | null = null;
  /** sounds already in the copy's folder (no need to write them again) */
  private sounds = new Map<string, Float32Array>();
  private soundsIn = "";

  constructor(private io: AutosaveIO, private current: () => Current) {}

  async load(): Promise<void> {
    const o = await this.io.storage.get("autosave", { on: true, every: 30 });
    this.on = o.on !== false;
    this.every = clampEvery(o.every);
  }

  async configure(o: { on?: boolean; every?: number }): Promise<void> {
    if (o.on !== undefined) (this.on = o.on), (this.error = "");
    if (o.every !== undefined) this.every = clampEvery(o.every);
    await this.io.storage.set("autosave", { on: this.on, every: this.every });
    if (this.on && this.changes !== this.copied) this.schedule();
  }

  /** the song changed (a step of the history ended): a copy soon */
  changed(): void {
    this.changes++;
    if (!this.firstPending) this.firstPending = this.io.now();
    if (this.on) this.schedule();
  }

  /** the copy is up to date with the song */
  get upToDate(): boolean {
    return this.changes === this.copied;
  }

  private schedule(): void {
    if (this.timer !== null) this.io.cancel(this.timer);
    const now = this.io.now();
    const most = this.every * 1000;
    let wait = QUIET_MS;
    if (this.current().playing) wait = Math.max(QUIET_MS, this.lastAt + most - now); // playing: not too often
    if (this.firstPending && now - this.firstPending >= most) wait = 0; // changes all along: one now
    this.timer = this.io.later(() => ((this.timer = null), void this.flush()), wait);
  }

  /** write the copy now, if the song has changes the copy hasn't */
  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    const { song, editor, path } = this.current();
    if (!this.on || !song || !editor?.dirty || this.changes === this.copied) return;
    const at = this.changes;
    this.writing = this.write(song, path).then(
      () => {
        this.copied = at;
        this.firstPending = 0;
        this.lastAt = this.io.now();
      },
      (e) => {
        // no permission, or the vault refused: stop for now, say it once
        this.on = false;
        this.error = e instanceof Error ? e.message : String(e);
        this.onError?.(this.error);
      },
    );
    await this.writing;
    this.writing = null;
  }

  private async write(song: Song, path: string): Promise<void> {
    const file = recoveryFile(path);
    if (this.soundsIn !== file) (this.sounds = new Map()), (this.soundsIn = file);
    await this.io.vault.mkdir(`${file}/samples`).catch(() => {});
    const files = writeBmed(song, (p, data) => this.sounds.get(p) === data);
    for (const f of files) {
      if (typeof f.data === "string") await this.io.vault.write(`${file}/${f.path}`, f.data);
      else await this.io.vault.writeBytes(`${file}/${f.path}`, f.data);
    }
    // remember what's in the folder now (the next copy writes only new sounds)
    song.instruments.forEach((ins, i) => {
      const n = String(i + 1).padStart(2, "0");
      if (ins.data.length) this.sounds.set(`samples/${n}.wav`, ins.data);
      if (ins.right?.length) this.sounds.set(`samples/${n}-right.wav`, ins.right);
      ins.waves?.forEach((w, k) => this.sounds.set(`samples/${n}-wave${k}.wav`, w));
    });
    const list = await this.index();
    list[path] = { path, file, title: song.title || path.split("/").pop() || "untitled", at: this.io.now() };
    await this.io.storage.set("recovery", list);
  }

  private index(): Promise<Record<string, Recovery>> {
    return this.io.storage.get<Record<string, Recovery>>("recovery", {});
  }

  /** the copies not saved yet, newest first */
  async list(): Promise<Recovery[]> {
    return Object.values(await this.index()).sort((a, b) => b.at - a.at);
  }

  async find(path: string): Promise<Recovery | undefined> {
    return (await this.index())[path];
  }

  /** a copy, as a song */
  read(r: Recovery): Promise<Song> {
    return this.io.vault.read(`${r.file}/song.json`).then((json) => readBmed(json, (f) => this.io.vault.readBytes(`${r.file}/${f}`)));
  }

  /** the song was saved (or its changes thrown away): its copy is no use any more */
  async forget(path: string): Promise<void> {
    const list = await this.index();
    if (!(path in list)) return;
    delete list[path];
    await this.io.storage.set("recovery", list);
  }

  /** a new song on the page: nothing to copy yet */
  reset(): void {
    if (this.timer !== null) this.io.cancel(this.timer);
    this.timer = null;
    this.changes = this.copied = this.firstPending = 0;
  }
}

const clampEvery = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(10, Math.min(300, Math.round(v))) : 30);
