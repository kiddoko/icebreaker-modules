/**
 * ProTracker .mod files: reading (writing comes with step 3). The format is the
 * well-known public one: a title, 31 instruments, the order list, a tag
 * ("M.K.", "6CHN", "8CHN"…), patterns of 64 lines × 4 bytes a cell, the samples.
 * A file without a tag is read as an old 15-instrument SoundTracker module.
 *
 * Effects are translated into OctaMED's numbering (song.ts), the way OctaMED
 * itself reads a .mod: 4 → 14 (ProTracker's vibrato depth), D → 1D (the line in
 * hex), Ex → 11/12/15/16/18/1A/1B/1E/1F, F → 09 (speed) or 0F (BPM).
 */
import { emptyInstrument, newBlock, semiOfPeriod, amigaPan, type Instrument, type Song } from "../song";
import { Reader, s8ToFloats } from "./bytes";

const TAGS4 = new Set(["M.K.", "M!K!", "M&K!", "FLT4", "4CHN", "N.T."]);

/** The tracks a tag means (0: not a tag we know). */
function tracksOfTag(tag: string): number {
  if (TAGS4.has(tag)) return 4;
  if (tag === "FLT8" || tag === "OCTA" || tag === "CD81") return 8;
  let m = /^(\d)CHN$/.exec(tag);
  if (m) return +m[1];
  m = /^(\d\d)C[HN]$/.exec(tag);
  if (m) return +m[1];
  return 0;
}

/** Does it look like a .mod (31 instruments and a tag)? */
export function isMod(b: Uint8Array): boolean {
  if (b.length < 1084) return false;
  const tag = String.fromCharCode(b[1080], b[1081], b[1082], b[1083]);
  return tracksOfTag(tag) > 0;
}

export function readMod(bytes: Uint8Array): Song {
  const r = new Reader(bytes);
  if (bytes.length < 600) throw new Error("too short for a .mod");
  const tag = bytes.length >= 1084 ? String.fromCharCode(bytes[1080], bytes[1081], bytes[1082], bytes[1083]) : "";
  let tracks = tracksOfTag(tag);
  const old = tracks === 0; // SoundTracker: 15 instruments, no tag
  if (old) tracks = 4;
  const numInst = old ? 15 : 31;

  const title = r.text(20);
  const heads: { inst: Instrument; bytes: number }[] = [];
  for (let i = 0; i < numInst; i++) {
    const inst = emptyInstrument();
    inst.name = r.text(22);
    const len = r.u16() * 2;
    const ft = r.u8() & 15;
    inst.finetune = ft > 7 ? ft - 16 : ft;
    inst.volume = Math.min(64, r.u8());
    let ls = r.u16() * 2;
    const ll = r.u16() * 2;
    if (old) ls >>= 1; // SoundTracker counted its loop start in bytes
    if (ll > 2) {
      inst.loopStart = ls;
      inst.loopLength = ll;
    }
    heads.push({ inst, bytes: len });
  }
  const songLength = Math.max(1, Math.min(128, r.u8()));
  let restart = r.u8();
  const orders = Array.from(r.bytes(128));
  if (!old) r.u32(); // the tag
  const used = orders.slice(0, songLength);
  const numPat = Math.max(...orders.filter((o) => o < 128)) + 1;
  if (restart >= songLength || restart === 127) restart = 0;

  const song: Song = {
    title,
    format: old ? "MOD 15" : `MOD ${tag}`,
    tracks,
    blocks: [],
    sequence: used,
    restart,
    instruments: [],
    tempoMode: "pt",
    tempo: 125,
    speed: 6,
    lpb: 4,
    transpose: 0,
    noteShift: 0,
    masterVolume: 64,
    trackVolume: new Array(tracks).fill(64),
    trackPan: amigaPan(tracks),
    flags: { volHex: true, vol7bit: false, ptSlides: true, eightChannel: false, hardwareMix: true, filter: false },
  };

  for (let p = 0; p < numPat; p++) {
    const block = newBlock(tracks, 64, 1);
    for (let line = 0; line < 64; line++)
      for (let t = 0; t < tracks; t++) {
        if (!r.can(4)) break;
        const a = r.u8(), b = r.u8(), c = r.u8(), d = r.u8();
        const period = ((a & 15) << 8) | b;
        const cell = block.cells[line][t];
        cell.inst = (a & 0xf0) | (c >> 4);
        if (cell.inst > 63) cell.inst = 0;
        if (period) cell.note = Math.max(1, semiOfPeriod(period) + 1);
        const [cmd, val] = modToMed(c & 15, d);
        cell.cmd[0] = cmd;
        cell.val[0] = val;
      }
    song.blocks.push(block);
  }

  for (const h of heads) {
    const n = Math.min(h.bytes, Math.max(0, bytes.length - r.pos));
    if (n > 0) {
      h.inst.data = s8ToFloats(r.bytes(n));
      h.inst.kind = "sample";
    }
    // a loop past the end is cut to it (some trackers wrote such files)
    if (h.inst.loopStart + h.inst.loopLength > h.inst.data.length) {
      h.inst.loopLength = Math.max(0, h.inst.data.length - h.inst.loopStart);
      if (h.inst.loopLength <= 2) (h.inst.loopStart = 0), (h.inst.loopLength = 0);
    }
    song.instruments.push(h.inst);
  }
  while (song.instruments.length && song.instruments[song.instruments.length - 1].kind === "empty") song.instruments.pop();
  return song;
}

/** A ProTracker effect as an OctaMED command. Returns [0, 0] for what has none. */
export function modToMed(e: number, p: number): [number, number] {
  switch (e) {
    case 0x0: return p ? [0x00, p] : [0, 0];
    case 0x4: return [0x14, p];
    case 0x8: return [0, 0]; // panning: not a ProTracker effect
    case 0x9: return [0x19, p];
    case 0xd: return [0x1d, Math.min(63, (p >> 4) * 10 + (p & 15))];
    case 0xe: {
      const x = p >> 4, y = p & 15;
      switch (x) {
        case 0x0: return [0x0f, y ? 0xf8 : 0xf9]; // E00 filter on, E01 off
        case 0x1: return [0x11, y];
        case 0x2: return [0x12, y];
        case 0x5: return [0x15, y]; // the finetune nibble, -8…7 as 8…F
        case 0x6: return [0x16, y];
        case 0x9: return [0x1f, y];
        case 0xa: return [0x1a, y];
        case 0xb: return [0x1b, y];
        case 0xc: return [0x18, y];
        case 0xd: return [0x1f, y << 4];
        case 0xe: return [0x1e, y];
        default: return [0, 0]; // glissando, waveforms, invert loop: not in OctaMED
      }
    }
    case 0xf:
      if (p === 0) return [0x0f, 0xfe]; // F00: the song stops
      return p < 0x20 ? [0x09, p] : [0x0f, p];
    default: return [e, p];
  }
}

