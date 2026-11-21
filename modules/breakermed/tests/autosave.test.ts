import { describe, expect, it } from "vitest";
import { Autosave, QUIET_MS, recoveryFile, type AutosaveIO, type Current } from "../src/autosave";
import { Editor } from "../src/edit";
import { templateSong } from "../src/template";
import { sameSettings } from "../src/app";

/** a vault, a storage and a clock in memory; timers run when the test says */
function world() {
  const files = new Map<string, string | Uint8Array>();
  const store = new Map<string, unknown>();
  let t = 1_000_000;
  let timers: { at: number; fn: () => void }[] = [];
  const io: AutosaveIO = {
    vault: {
      read: async (p) => { const f = files.get(p); if (typeof f !== "string") throw new Error(`no ${p}`); return f; },
      readBytes: async (p) => { const f = files.get(p); if (!(f instanceof Uint8Array)) throw new Error(`no ${p}`); return f; },
      write: async (p, c) => void files.set(p, c),
      writeBytes: async (p, d) => void files.set(p, d),
      mkdir: async () => {},
    },
    storage: { get: async (k, d) => (store.has(k) ? structuredClone(store.get(k)) : d) as never, set: async (k, v) => void store.set(k, structuredClone(v)) },
    now: () => t,
    later: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; },
    cancel: (h) => void (timers = timers.filter((x) => x !== h)),
  };
  /** time passes: the timers due run (and their writes finish) */
  const wait = async (ms: number) => {
    t += ms;
    for (const h of timers.filter((x) => x.at <= t)) (timers = timers.filter((x) => x !== h)), h.fn();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { io, files, store, wait };
}

function session(w: ReturnType<typeof world>, playing = false) {
  const song = templateSong();
  const editor = new Editor(song);
  const cur: Current = { song, editor, path: "songs/night.bmed", playing };
  const a = new Autosave(w.io, () => cur);
  editor.onChange = () => a.changed();
  return { song, editor, cur, a };
}

describe("0.11.1: the autosave", () => {
  it("a change is copied 1.5 s later into songs/.recovery/, never over the song", async () => {
    const w = world();
    const { editor, a } = session(w);
    editor.settings("tempo", (s) => (s.tempo = 99));
    await w.wait(QUIET_MS - 100);
    expect(w.files.size).toBe(0); // a run of keys makes one copy: not yet
    await w.wait(200);
    expect(w.files.has(`${recoveryFile("songs/night.bmed")}/song.json`)).toBe(true);
    expect([...w.files.keys()].every((p) => p.startsWith("songs/.recovery/"))).toBe(true);
    expect(a.upToDate).toBe(true);
    expect((await a.list()).map((r) => r.path)).toEqual(["songs/night.bmed"]);
  });

  it("recovery: the next session gets the changed song back, until it's saved", async () => {
    const w = world();
    const first = session(w);
    first.editor.settings("tempo", (s) => (s.tempo = 99));
    first.editor.setTrack(0, { name: "kick drum" });
    await w.wait(QUIET_MS + 1);
    // the app quits without saving; a new session starts
    const again = new Autosave(w.io, () => ({ song: null, editor: null, path: "", playing: false }));
    const rec = await again.find("songs/night.bmed");
    expect(rec).toBeDefined();
    const back = await again.read(rec!);
    expect(back.tempo).toBe(99);
    expect(back.trackNames[0]).toBe("kick drum");
    expect(sameSettings(back.instruments.map((i) => i.kind), first.song.instruments.map((i) => i.kind))).toBe(true);
    // med save: the copy is forgotten
    await again.forget("songs/night.bmed");
    expect(await again.list()).toEqual([]);
  });

  it("nothing is written when nothing changed, or when it's off", async () => {
    const w = world();
    const { editor, a } = session(w);
    await a.flush();
    expect(w.files.size).toBe(0);
    await a.configure({ on: false });
    editor.settings("tempo", (s) => (s.tempo = 99));
    await w.wait(60_000);
    expect(w.files.size).toBe(0);
    expect(w.store.get("autosave")).toEqual({ on: false, every: 30 });
  });

  it("changes all along (or the song playing) still give a copy every 30 s", async () => {
    const w = world();
    const { editor } = session(w);
    for (let i = 0; i < 40; i++) (editor.settings("tempo", (s) => (s.tempo = 100 + i)), await w.wait(1000)); // a change a second, never quiet
    // the copy was written along the way (at 30 s), with the tempo of then
    expect(JSON.parse(w.files.get(`${recoveryFile("songs/night.bmed")}/song.json`) as string).tempo.tempo).toBeGreaterThanOrEqual(129);
  });

  it("a refused write (no permission) turns it off and says so once", async () => {
    const w = world();
    w.io.vault.write = async () => { throw new Error("permission denied: songs/"); };
    const { editor, a } = session(w);
    const said: string[] = [];
    a.onError = (m) => said.push(m);
    editor.settings("tempo", (s) => (s.tempo = 99));
    await w.wait(QUIET_MS + 1);
    editor.settings("tempo", (s) => (s.tempo = 98));
    await w.wait(QUIET_MS + 1);
    expect(a.on).toBe(false);
    expect(said).toEqual(["permission denied: songs/"]);
  });
});
