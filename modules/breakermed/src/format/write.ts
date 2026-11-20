/**
 * Writing .mod (ProTracker) and .med (MMD1, read by OctaMED Pro and later, and
 * by OpenMPT): for sharing with other trackers. Our own format (.bmed) keeps
 * everything; these keep what they can and say what they couldn't
 * (`warnings`): more tracks than ProTracker reads, blocks that aren't 64 lines,
 * commands a .mod hasn't got, synths…
 */
import { NOTE_OFF, periodOf, ptBpmOf, type Song } from "../song";
import { floatsToS16be, floatsToS8, Writer } from "./bytes";

export interface Written {
  bytes: Uint8Array;
  warnings: string[];
}

/** 0C's value as a hex volume 0–64, whatever the song's convention */
function volumeOf(song: Song, v: number): number {
  if (song.flags.vol7bit) return Math.min(64, ((v & 0x7f) + 1) >> 1);
  if (song.flags.volHex) return Math.min(64, v & 0x7f);
  return v < 0x99 ? Math.min(64, (v >> 4) * 10 + (v & 15)) : 64;
}

// ── .mod ───────────────────────────────────────────────────────────────────

/** An OctaMED command as a ProTracker effect, or null when it has none. */
export function medToMod(song: Song, cmd: number, v: number): [number, number] | null {
  switch (cmd) {
    case 0x00: return v ? [0x0, v] : null;
    case 0x01: case 0x02: case 0x03: case 0x05: case 0x06: case 0x07: case 0x0a: case 0x0b: return [cmd, v];
    case 0x0d: return [0xa, v];
    case 0x04: return [0x4, (v & 0xf0) | Math.min(15, (v & 15) * 2)];
    case 0x14: return [0x4, v];
    case 0x09: return v > 0 && v < 0x20 ? [0xf, v] : null;
    case 0x0c: return [0xc, volumeOf(song, v)];
    case 0x0f:
      if (v === 0) return [0xd, 0];
      if (v <= 0xf0) {
        const bpm = Math.round(ptBpmOf(song.tempoMode, v, song.lpb, song.flags.eightChannel, song.flags.hardwareMix));
        return [0xf, Math.max(0x20, Math.min(255, bpm))];
      }
      return { 0xf1: [0xe, 0x93], 0xf2: [0xe, 0xd3], 0xf3: [0xe, 0x92], 0xf8: [0xe, 0x01], 0xf9: [0xe, 0x00], 0xfe: [0xf, 0], 0xff: [0xe, 0xc0] }[v] as [number, number] ?? null;
    case 0x11: return [0xe, 0x10 | (v & 15)];
    case 0x12: return [0xe, 0x20 | (v & 15)];
    case 0x15: return [0xe, 0x50 | (v & 15)];
    case 0x16: return [0xe, 0x60 | (v & 15)];
    case 0x18: return [0xe, 0xc0 | Math.min(15, v)];
    case 0x19: return [0x9, v];
    case 0x1a: return [0xe, 0xa0 | (v & 15)];
    case 0x1b: return [0xe, 0xb0 | (v & 15)];
    case 0x1d: return [0xd, Math.min(63, v) % 10 | (Math.floor(Math.min(63, v) / 10) << 4)];
    case 0x1e: return [0xe, 0xe0 | Math.min(15, v)];
    case 0x1f: return v >> 4 ? [0xe, 0xd0 | (v >> 4)] : v & 15 ? [0xe, 0x90 | (v & 15)] : null;
    default: return null;
  }
}

export function writeMod(song: Song): Written {
  const warnings: string[] = [];
  const w = new Writer();
  const tracks = song.tracks;
  if (tracks > 32) warnings.push(`${tracks} tracks: a .mod holds 32 at most — cut`);
  const T = Math.min(32, tracks);
  if (T !== 4) warnings.push(`${T} tracks: ProTracker itself plays 4 (OpenMPT, MilkyTracker… play more)`);
  const tag = T === 4 ? "M.K." : T < 10 ? `${T}CHN` : `${T}CH`;
  w.text(song.title, 20);
  const insts = song.instruments.slice(0, 31);
  if (song.instruments.filter((i) => i.kind !== "empty").length > 31) warnings.push("more than 31 instruments: the rest are left out");
  if (song.instruments.some((i) => i.kind === "synth" || i.kind === "hybrid")) warnings.push("synth instruments are written as their first waveform");
  if (song.instruments.some((i) => i.bits16)) warnings.push("16-bit samples are written in 8 bits");
  const datas = insts.map((i) => (i.kind === "empty" ? new Float32Array(0) : i.data.length > 131070 ? (warnings.push(`instrument "${i.name}": longer than 128 kB, cut`), i.data.slice(0, 131070)) : i.data));
  for (let i = 0; i < 31; i++) {
    const ins = insts[i];
    const d = datas[i] ?? new Float32Array(0);
    const words = d.length >> 1;
    w.text(ins?.name ?? "", 22).u16(words).u8((ins?.finetune ?? 0) & 15).u8(Math.min(64, ins?.volume ?? 0));
    const ls = ins && ins.loopLength > 2 ? Math.min(words, ins.loopStart >> 1) : 0;
    const ll = ins && ins.loopLength > 2 ? Math.max(1, Math.min(words - ls, ins.loopLength >> 1)) : 1;
    w.u16(ls).u16(ll);
  }
  // the blocks the sequence plays, in order of first use
  const seq = song.sequence.slice(0, 128);
  if (song.sequence.length > 128) warnings.push("a .mod's sequence holds 128 positions: the rest is cut");
  const patOf = new Map<number, number>();
  for (const b of seq) if (!patOf.has(b)) patOf.set(b, patOf.size);
  w.u8(seq.length).u8(song.restart < seq.length ? song.restart : 127);
  for (let i = 0; i < 128; i++) w.u8(i < seq.length ? patOf.get(seq[i])! : 0);
  w.text(tag, 4);
  let dropped = 0;
  const first = seq[0];
  for (const [b] of patOf) {
    const block = song.blocks[b];
    if (block.lines > 64) warnings.push(`block ${b}: ${block.lines} lines, a .mod pattern has 64 — cut`);
    for (let line = 0; line < 64; line++) {
      const free: number[] = [];
      const cells: [number, number, number, number][] = [];
      for (let t = 0; t < T; t++) {
        const c = line < block.lines ? block.cells[line][t] : undefined;
        let period = 0, inst = 0, e = 0, p = 0;
        if (c) {
          inst = c.inst;
          if (c.note && c.note !== NOTE_OFF) {
            let s = c.note - 1 + song.transpose + song.noteShift;
            while (s > 35) s -= 12;
            while (s < 0) s += 12;
            period = Math.round(periodOf(s));
          } else if (c.note === NOTE_OFF) [e, p] = [0xe, 0xc0];
          for (let k = 0; k < c.cmd.length && !e; k++) {
            if (!c.cmd[k] && !c.val[k]) continue;
            const m = medToMod(song, c.cmd[k], c.val[k]);
            if (m) [e, p] = m;
            else dropped++;
          }
        }
        if (!e && !p) free.push(t);
        cells.push([period, inst, e, p]);
      }
      // a block shorter than 64 lines: a break on its last line
      if (line === block.lines - 1 && block.lines < 64) {
        const t = free.shift();
        if (t !== undefined) cells[t][2] = 0xd;
        else warnings.push(`block ${b}: no free column for the break at line ${line}`);
      }
      // the song's tempo, on the first line of the first block (ProTracker starts at speed 6, 125 BPM)
      if (b === first && line === 0) {
        const bpm = Math.round(ptBpmOf(song.tempoMode, song.tempo, song.lpb, song.flags.eightChannel, song.flags.hardwareMix));
        const want: [number, number][] = [];
        if (song.speed !== 6) want.push([0xf, Math.min(0x1f, song.speed)]);
        if (bpm !== 125) want.push([0xf, Math.max(0x20, Math.min(255, bpm))]);
        for (const [e, p] of want) {
          const t = free.shift();
          if (t === undefined) warnings.push("no free column on the first line for the tempo");
          else (cells[t][2] = e), (cells[t][3] = p);
        }
      }
      for (const [period, inst, e, p] of cells) w.u8((inst & 0xf0) | ((period >> 8) & 15)).u8(period & 255).u8(((inst & 15) << 4) | e).u8(p);
    }
  }
  if (dropped) warnings.push(`${dropped} command(s) a .mod hasn't got were left out`);
  for (const d of datas) w.bytes(floatsToS8(d.length & 1 ? d.slice(0, d.length - 1) : d));
  return { bytes: w.done(), warnings };
}

// ── .med (MMD1) ────────────────────────────────────────────────────────────

export function writeMed(song: Song): Written {
  const warnings: string[] = [];
  const w = new Writer();
  const T = song.tracks;
  const insts = song.instruments.slice(0, 63);
  if (song.instruments.length > 63) warnings.push("more than 63 instruments: the rest are left out");
  if (song.instruments.some((i) => i.kind === "synth" || i.kind === "hybrid")) warnings.push("synth instruments are written as their first waveform");
  const seq = song.sequence.slice(0, 256);
  if (song.sequence.length > 256) warnings.push("an MMD1 sequence holds 256 positions: the rest is cut");

  // header (pointers patched at the end)
  w.text("MMD1", 4).u32(0).u32(52).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).zeros(11).u8(0);
  // 63 instrument headers (loops in words)
  for (let i = 0; i < 63; i++) {
    const ins = insts[i];
    const loop = ins && ins.loopLength > 2;
    w.u16(loop ? ins.loopStart >> 1 : 0).u16(loop ? ins.loopLength >> 1 : 0).u8(0).u8(0).u8(Math.min(64, ins?.volume ?? 0)).u8((ins?.transpose ?? 0) & 255);
  }
  // the song
  let tempo = song.tempo, lpb = song.lpb, mode = song.tempoMode;
  if (mode === "pt") (mode = "bpm"), (lpb = 4), (tempo = Math.round(ptBpmOf("pt", song.tempo, 4)));
  w.u16(song.blocks.length).u16(seq.length);
  for (let i = 0; i < 256; i++) w.u8(seq[i] ?? 0);
  const flags = 0x10 | (song.flags.ptSlides ? 0x20 : 0) | (song.flags.eightChannel ? 0x40 : 0) | (song.flags.filter ? 0x01 : 0);
  const flags2 = (mode === "bpm" ? 0x20 | ((Math.max(1, lpb) - 1) & 0x1f) : 0) | (song.flags.hardwareMix ? 0 : 0x80);
  w.u16(Math.max(1, Math.min(0xffff, tempo))).u8(song.transpose & 255).u8(flags).u8(flags2).u8(Math.max(1, Math.min(32, song.speed)));
  for (let t = 0; t < 16; t++) w.u8(Math.min(64, song.trackVolume[t] ?? 64));
  w.u8(Math.min(64, song.masterVolume)).u8(insts.length);
  // the block pointers
  const blockArr = w.pos;
  w.zeros(4 * song.blocks.length);
  song.blocks.forEach((b, n) => {
    w.align();
    const at = w.pos;
    w.patch32(blockArr + 4 * n, at);
    w.u16(T).u16(b.lines - 1);
    const infoPtr = w.pos;
    w.u32(0);
    const note = (x: number) => (x === NOTE_OFF ? 0x80 : x ? Math.max(1, Math.min(127, x + song.noteShift)) : 0);
    const val = (cmd: number, v: number) => (cmd === 0x0c ? volumeOf(song, v) : v);
    for (let l = 0; l < b.lines; l++)
      for (let t = 0; t < T; t++) {
        const c = b.cells[l][t];
        w.u8(note(c.note)).u8(c.inst & 0x3f).u8(c.cmd[0] ?? 0).u8(val(c.cmd[0] ?? 0, c.val[0] ?? 0));
      }
    // a name or more command pages: a block info
    if (b.pages > 1 || b.name) {
      w.align();
      const pages: number[] = [];
      for (let p = 1; p < b.pages; p++) {
        pages.push(w.pos);
        for (let l = 0; l < b.lines; l++)
          for (let t = 0; t < T; t++) {
            const c = b.cells[l][t];
            w.u8(c.cmd[p] ?? 0).u8(val(c.cmd[p] ?? 0, c.val[p] ?? 0));
          }
      }
      w.align();
      let nameAt = 0;
      if (b.name) (nameAt = w.pos), w.text(b.name, b.name.length + 1);
      w.align();
      let tableAt = 0;
      if (pages.length) {
        tableAt = w.pos;
        w.u16(pages.length).u16(0);
        for (const p of pages) w.u32(p);
      }
      w.align();
      const info = w.pos;
      w.u32(0).u32(nameAt).u32(b.name ? b.name.length + 1 : 0).u32(tableAt).u32(0).zeros(16);
      w.patch32(infoPtr, info);
    }
  });
  // the instruments' sounds
  w.align();
  const sampleArr = w.pos;
  w.zeros(4 * insts.length);
  insts.forEach((ins, i) => {
    if (ins.kind === "empty" || !ins.data.length) return;
    w.align();
    w.patch32(sampleArr + 4 * i, w.pos);
    const bytes = ins.bits16 ? floatsToS16be(ins.data) : floatsToS8(ins.data);
    w.u32(bytes.length).u16(ins.bits16 ? 0x10 : 0).bytes(bytes);
  });
  // the expansion: instrument extras and names, the song's name
  w.align();
  const extAt = w.pos;
  for (const ins of insts) {
    const loop = ins.loopLength > 2;
    w.u8(ins.hold & 255).u8(ins.decay & 255).u8(0).u8(ins.finetune & 255).u8(0).u8((loop ? 0x01 : 0) | (ins.pingPong ? 0x08 : 0)).u16(0).u8(0).u8(0);
    w.u32(loop ? ins.loopStart : 0).u32(loop ? ins.loopLength : 0).u8(Math.max(0, Math.min(127, Math.round(ins.gain * 128) - 1))).u8(0).u8(0).u8(0);
  }
  const infoAt = w.pos;
  for (const ins of insts) w.text(ins.name, 40);
  let nameAt = 0;
  if (song.title) (nameAt = w.pos), w.text(song.title, song.title.length + 1);
  w.align();
  const exp = w.pos;
  w.u32(0).u32(extAt).u16(insts.length).u16(22).u32(0).u32(0).u32(infoAt).u16(insts.length).u16(40).u32(0).u32(0).zeros(4).u32(0).u32(nameAt).u32(song.title ? song.title.length + 1 : 0).zeros(28);
  // the header's pointers
  w.patch32(4, w.pos);
  w.patch32(16, blockArr);
  w.patch32(24, sampleArr);
  w.patch32(32, exp);
  return { bytes: w.done(), warnings };
}
