import { describe, expect, it } from "vitest";
import { Writer } from "../src/format/bytes";
import { readSong } from "../src/format";
import { modToMed } from "../src/format/mod";
import { Player, songLength } from "../src/replayer";
import { Engine, type AudioPort } from "../src/engine";
import { NOTE_OFF, PAULA_CLOCK, noteName, ptBpmOf, tickSeconds } from "../src/song";
import { pianoKey } from "../src/keys";
import { demoMod } from "../src/demo";

// ── little files made by hand ──────────────────────────────────────────────

type ModCell = { period?: number; inst?: number; e?: number; p?: number };

/** A 4-track M.K. module: one 32-byte looping square sample, the given patterns. */
function makeMod(patterns: Record<string, ModCell>[], order = [0]): Uint8Array {
  const w = new Writer();
  w.text("test song", 20);
  for (let i = 0; i < 31; i++) {
    w.text(i === 0 ? "square" : "", 22);
    w.u16(i === 0 ? 16 : 0).u8(0).u8(i === 0 ? 48 : 0).u16(0).u16(i === 0 ? 16 : 1);
  }
  w.u8(order.length).u8(127);
  for (let i = 0; i < 128; i++) w.u8(order[i] ?? 0);
  w.text("M.K.", 4);
  for (const pat of patterns)
    for (let line = 0; line < 64; line++)
      for (let t = 0; t < 4; t++) {
        const c = pat[`${line}:${t}`] ?? {};
        const period = c.period ?? 0, inst = c.inst ?? 0;
        w.u8((inst & 0xf0) | (period >> 8)).u8(period & 0xff).u8(((inst & 15) << 4) | (c.e ?? 0)).u8(c.p ?? 0);
      }
  for (let i = 0; i < 32; i++) w.u8(i < 16 ? 100 : 156); // +100 / -100
  return w.done();
}

/** An OctaMED file: MMD0 (3-byte cells) or MMD1 (4-byte cells), one block, one 8-bit sample. */
function makeMed(version: 0 | 1, cells: Record<string, [number, number, number, number]>, opts: { tempo?: number; flags2?: number; flags?: number; lines?: number } = {}): Uint8Array {
  const lines = opts.lines ?? 16;
  const w = new Writer();
  const P = { song: 52, blockArr: 0, block: 0, sampleArr: 0, sample: 0 };
  // file header (pointers patched below)
  w.text(`MMD${version}`, 4).u32(0).u32(P.song).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).zeros(11).u8(0);
  // 63 instrument headers: #1 a sample with a loop over all of it, volume 64
  for (let i = 0; i < 63; i++) w.u16(0).u16(i === 0 ? 16 : 0).u8(0).u8(0).u8(i === 0 ? 64 : 0).u8(0);
  // the song: 1 block, 1 position, the sequence, tempo, flags
  w.u16(1).u16(1);
  w.u8(0).zeros(255);
  w.u16(opts.tempo ?? 33).u8(0).u8(opts.flags ?? 0x10).u8(opts.flags2 ?? 0).u8(6);
  for (let i = 0; i < 16; i++) w.u8(64);
  w.u8(64).u8(1);
  P.blockArr = w.pos;
  w.u32(0);
  P.block = w.pos;
  if (version === 0) {
    w.u8(4).u8(lines - 1);
    for (let l = 0; l < lines; l++)
      for (let t = 0; t < 4; t++) {
        const [note, inst, cmd, val] = cells[`${l}:${t}`] ?? [0, 0, 0, 0];
        w.u8((note & 0x3f) | ((inst & 0x10) << 3) | ((inst & 0x20) << 1)).u8(((inst & 15) << 4) | (cmd & 15)).u8(val);
      }
  } else {
    w.u16(4).u16(lines - 1).u32(0);
    for (let l = 0; l < lines; l++)
      for (let t = 0; t < 4; t++) {
        const [note, inst, cmd, val] = cells[`${l}:${t}`] ?? [0, 0, 0, 0];
        w.u8(note).u8(inst).u8(cmd).u8(val);
      }
  }
  P.sampleArr = w.pos;
  w.u32(0);
  P.sample = w.pos;
  w.u32(32).u16(0);
  for (let i = 0; i < 32; i++) w.u8(i < 16 ? 100 : 156);
  w.patch32(8, P.song);
  w.patch32(16, P.blockArr);
  w.patch32(24, P.sampleArr);
  w.patch32(P.blockArr, P.block);
  w.patch32(P.sampleArr, P.sample);
  return w.done();
}

// ── reading ────────────────────────────────────────────────────────────────

describe("breakerMED: reading .mod", () => {
  it("reads the header, the instruments, the cells", () => {
    const song = readSong(makeMod([{ "0:0": { period: 428, inst: 1, e: 0xc, p: 0x20 }, "1:1": { period: 856, inst: 1 } }]));
    expect(song.format).toBe("MOD M.K.");
    expect(song.title).toBe("test song");
    expect(song.tracks).toBe(4);
    expect(song.sequence).toEqual([0]);
    expect(song.instruments[0].name).toBe("square");
    expect(song.instruments[0].data.length).toBe(32);
    expect(song.instruments[0].loopLength).toBe(32);
    expect(song.instruments[0].volume).toBe(48);
    const c = song.blocks[0].cells[0][0];
    expect([noteName(c.note), c.inst, c.cmd[0], c.val[0]]).toEqual(["C-2", 1, 0x0c, 0x20]);
    expect(noteName(song.blocks[0].cells[1][1].note)).toBe("C-1");
    expect(song.tempoMode).toBe("pt");
    expect(song.flags.ptSlides).toBe(true);
  });

  it("translates ProTracker's effects into OctaMED's numbers", () => {
    expect(modToMed(0x4, 0x34)).toEqual([0x14, 0x34]);
    expect(modToMed(0xd, 0x16)).toEqual([0x1d, 16]); // decimal 16 → line 16
    expect(modToMed(0xf, 0x03)).toEqual([0x09, 0x03]);
    expect(modToMed(0xf, 0x7d)).toEqual([0x0f, 0x7d]);
    expect(modToMed(0xe, 0xc3)).toEqual([0x18, 3]);
    expect(modToMed(0xe, 0xd2)).toEqual([0x1f, 0x20]);
    expect(modToMed(0xe, 0x92)).toEqual([0x1f, 2]);
    expect(modToMed(0x0, 0x00)).toEqual([0, 0]);
  });

  it("refuses what isn't a song", () => {
    expect(() => readSong(new Uint8Array(2000))).toThrow(/not a \.med/);
  });
});

describe("breakerMED: reading .med", () => {
  it("MMD0: 3-byte cells, 6-bit notes, instruments past 15", () => {
    const song = readSong(makeMed(0, { "0:0": [13, 1, 0x0c, 0x40], "2:3": [1, 33, 0, 0] }));
    expect(song.format).toBe("MMD0");
    const c = song.blocks[0].cells[0][0];
    expect([noteName(c.note), c.inst, c.cmd[0], c.val[0]]).toEqual(["C-2", 1, 0x0c, 0x40]);
    expect(song.blocks[0].cells[2][3].inst).toBe(33);
    expect(song.blocks[0].lines).toBe(16);
    expect(song.instruments[0].data.length).toBe(32);
    expect(song.instruments[0].loopLength).toBe(32);
    expect(song.tempoMode).toBe("spd");
    expect(song.flags.volHex).toBe(true);
  });

  it("MMD1: 4-byte cells, note off, 8-bit commands", () => {
    const song = readSong(makeMed(1, { "0:0": [25, 1, 0x19, 0x02], "1:0": [0x80, 0, 0, 0] }, { flags2: 0x20 | 3, tempo: 120 }));
    expect(song.format).toBe("MMD1");
    const c = song.blocks[0].cells[0][0];
    expect([noteName(c.note), c.cmd[0], c.val[0]]).toEqual(["C-3", 0x19, 0x02]);
    expect(song.blocks[0].cells[1][0].note).toBe(NOTE_OFF);
    expect(song.tempoMode).toBe("bpm");
    expect(song.lpb).toBe(4);
  });

  it("a pointer out of the file is left out, never read past the end", () => {
    const b = makeMed(1, {});
    b[16] = 0x7f; // the block table's pointer, far past the end
    const s = readSong(b);
    expect(s.blocks.length).toBe(1); // an empty block stands in
    const c = makeMed(1, {});
    c[8] = 0x7f; // the song's pointer: nothing can be read
    expect(() => readSong(c)).toThrow(/pointer|ends too early/);
  });
});

// ── time ───────────────────────────────────────────────────────────────────

describe("breakerMED: tempo", () => {
  it("ProTracker: a tick is 2.5 / BPM", () => {
    expect(tickSeconds("pt", 125, 4)).toBeCloseTo(0.02);
  });
  it("OctaMED SPD: tempo 33 ≈ 125 BPM (50 Hz), 1–10 are SoundTracker speeds", () => {
    expect(ptBpmOf("spd", 33, 4)).toBeCloseTo(125, 0);
    expect(ptBpmOf("spd", 6, 4)).toBeCloseTo(122.3, 0);
  });
  it("OctaMED BPM mode: tempo × lines a beat / 4", () => {
    expect(ptBpmOf("bpm", 120, 4)).toBe(120);
    expect(ptBpmOf("bpm", 120, 8)).toBe(240);
  });
  it("a song's length: lines × speed × tick; speed and breaks change it", () => {
    expect(songLength(readSong(makeMod([{}]))).seconds).toBeCloseTo(64 * 6 * 0.02);
    expect(songLength(readSong(makeMod([{ "0:0": { e: 0xf, p: 3 } }]))).seconds).toBeCloseTo(64 * 3 * 0.02);
    const broken = songLength(readSong(makeMod([{ "15:2": { e: 0xd, p: 0 } }, {}], [0, 1])));
    expect(broken.lines).toBe(16 + 64);
  });
  it("0FFE stops the song", () => {
    const s = readSong(makeMed(1, { "3:0": [0, 0, 0x0f, 0xfe] }));
    expect(songLength(s).lines).toBe(4);
  });
});

// ── what the voices do ─────────────────────────────────────────────────────

describe("breakerMED: the replayer", () => {
  it("a note starts its instrument at the Amiga's speed, at its volume", () => {
    const p = new Player(readSong(makeMod([{ "0:0": { period: 428, inst: 1 } }])));
    const t = p.step();
    expect(t.line).toEqual({ seq: 0, block: 0, line: 0 });
    const e = t.events.find((x) => x.voice === 0)!;
    expect(e.play).toBe(0);
    expect(e.rate).toBeCloseTo(PAULA_CLOCK / 428);
    expect(e.volume).toBeCloseTo((48 / 64) * 0.5);
    expect(e.pan).toBeLessThan(0); // track 1 is on the left
  });

  it("a volume slide moves on the ticks after the first (ProTracker), from the first too (OctaMED)", () => {
    const pt = new Player(readSong(makeMod([{ "0:0": { period: 428, inst: 1, e: 0xa, p: 0x02 } }])));
    const vols = [0, 1, 2].map(() => pt.step().events.find((x) => x.voice === 0)?.volume);
    expect(vols[0]).toBeCloseTo((48 / 64) * 0.5);
    expect(vols[1]).toBeCloseTo((46 / 64) * 0.5);
    expect(vols[2]).toBeCloseTo((44 / 64) * 0.5);
    const med = new Player(readSong(makeMed(1, { "0:0": [13, 1, 0x0d, 0x04] })));
    expect(med.step().events.find((x) => x.voice === 0)?.volume).toBeCloseTo((60 / 64) * 0.5);
  });

  it("0C sets the volume in decimal unless the song says hex", () => {
    const dec = new Player(readSong(makeMed(1, { "0:0": [13, 1, 0x0c, 0x32] }, { flags: 0 })));
    expect(dec.step().events[0].volume).toBeCloseTo((32 / 64) * 0.5);
    const hx = new Player(readSong(makeMed(1, { "0:0": [13, 1, 0x0c, 0x20] }, { flags: 0x10 })));
    expect(hx.step().events[0].volume).toBeCloseTo((32 / 64) * 0.5);
  });

  it("a note off and a muted track silence their voice", () => {
    const p = new Player(readSong(makeMed(1, { "0:0": [13, 1, 0, 0], "1:0": [NOTE_OFF, 0, 0, 0] })));
    for (let i = 0; i < 6; i++) p.step();
    expect(p.step().events.find((x) => x.voice === 0)?.stop).toBe(true);
    const m = new Player(readSong(makeMed(1, { "0:1": [13, 1, 0, 0] })), { muted: new Set([1]) });
    expect(m.step().events.find((x) => x.voice === 1)?.volume).toBe(0);
  });

  it("notes above B-3 fold an octave down on the Amiga's voices (OctaMED)", () => {
    const p = new Player(readSong(makeMed(1, { "0:0": [37, 1, 0, 0] }))); // C-4
    expect(p.step().events[0].rate).toBeCloseTo(PAULA_CLOCK / 214); // C-3
  });

  it("a block played again and again comes back to its top", () => {
    const p = new Player(readSong(makeMed(1, {}, { lines: 4 })), { loopBlock: true });
    const lines: number[] = [];
    for (let i = 0; i < 6 * 6; i++) {
      const t = p.step();
      if (t.line) lines.push(t.line.line);
    }
    expect(lines).toEqual([0, 1, 2, 3, 0, 1]);
  });
});

// ── the engine, with a fake sampler ────────────────────────────────────────

describe("breakerMED: the engine", () => {
  it("loads the instruments, schedules dated events ahead, stops", async () => {
    let clock = 10;
    const sent: Record<string, unknown>[] = [];
    const calls: string[] = [];
    const port: AudioPort = {
      available: () => true,
      now: async () => clock,
      sample: async (id) => void calls.push(`sample ${id}`),
      drop: async () => void calls.push("drop"),
      schedule: async (evs) => void sent.push(...(evs as Record<string, unknown>[])),
      stop: async () => void calls.push("stop"),
    };
    const engine = new Engine(port);
    await engine.load(readSong(makeMod([{ "0:0": { period: 428, inst: 1 }, "1:1": { period: 428, inst: 1 } }])));
    expect(calls).toContain("sample i0");
    await engine.play("song", { seq: 0, line: 0 });
    await new Promise((r) => setTimeout(r, 300)); // the engine computes ~150 ms ahead, every 25 ms
    engine.stop();
    expect(calls).toContain("stop");
    const play = sent.filter((e) => e.play === "i0");
    expect(play.length).toBe(2);
    expect(play[0].at as number).toBeGreaterThan(clock);
    // the second note is one line (6 ticks of 20 ms) after the first
    expect((play[1].at as number) - (play[0].at as number)).toBeCloseTo(0.12, 5);
    expect(play[0].interp).toBe("none");
    clock = 11;
  });
});

describe("breakerMED: the demo song", () => {
  it("is a real .mod, read by the same reader, ~25 s long", () => {
    const s = readSong(demoMod());
    expect(s.format).toBe("MOD M.K.");
    expect(s.instruments.map((i) => i.name)).toEqual(["square", "saw bass", "kick", "hat"]);
    expect(s.blocks.length).toBe(3);
    expect(songLength(s).seconds).toBeGreaterThan(20);
  });
});

describe("breakerMED: the piano", () => {
  it("reads the key's place, not its letter", () => {
    expect(pianoKey("KeyZ")).toBe(0);
    expect(pianoKey("KeyQ")).toBe(12);
    expect(pianoKey("Digit2")).toBe(13);
    expect(pianoKey("KeyA")).toBe(null);
  });
});
