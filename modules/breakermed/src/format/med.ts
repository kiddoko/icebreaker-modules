/**
 * OctaMED .med files (MMD0, MMD1, MMD2, MMD3): reading. Writing comes with
 * step 3.
 *
 * The layout is public: Teijo Kinnunen's MED-FORM.TXT describes MMD0 / MMD1,
 * and the rest (MMD2's sections and play sequences, MMD3, the command pages,
 * the tempo modes, the octave folding of the Amiga's four voices) was checked
 * against libopenmpt's reader (Load_med.cpp, BSD-3-Clause, docs/CREDITS.md).
 * This is our own code: one structure after the other, every pointer
 * checked against the file's length.
 *
 * Not read yet: packed (ADPCM) samples, MIDI, several songs in one file (the
 * first is read), MMD2's play-sequence commands (stop / jump).
 */
import { amigaPan, emptyInstrument, newBlock, NOTE_OFF, type Instrument, type Song, type TempoMode } from "../song";
import { Reader, s16beToFloats, s8ToFloats, undelta8 } from "./bytes";

export function isMed(b: Uint8Array): boolean {
  return b.length >= 52 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x44 && b[3] >= 0x30 && b[3] <= 0x33;
}

interface Header {
  version: number;
  songOffset: number;
  blockArr: number;
  sampleArr: number;
  expData: number;
}

export function readMed(bytes: Uint8Array): Song {
  if (!isMed(bytes)) throw new Error("not an OctaMED file (no MMD0–MMD3 header)");
  const r = new Reader(bytes);
  r.seek(3);
  const h: Header = { version: r.u8() - 0x30, songOffset: 0, blockArr: 0, sampleArr: 0, expData: 0 };
  r.u32(); // the file's length
  h.songOffset = r.u32();
  r.u32(); // the player's own variables
  h.blockArr = r.u32();
  r.u32(); // flags + reserved
  h.sampleArr = r.u32();
  r.u32();
  h.expData = r.u32();

  // ── the song: 63 instrument headers, then its settings ─────────────────
  r.seek(h.songOffset);
  const sampleHeads = Array.from({ length: 63 }, () => ({ loopStart: r.u16() * 2, loopLength: r.u16() * 2, midiChannel: r.u8(), midiPreset: r.u8(), volume: r.u8(), transpose: r.s8() }));
  const numBlocks = r.u16();
  const songLength = r.u16();
  const songArea = r.pos;
  r.seek(songArea + 256);
  const defaultTempo = r.u16();
  const playTranspose = r.s8();
  const flags = r.u8();
  const flags2 = r.u8();
  const tempo2 = r.u8();
  const trackVol16 = Array.from(r.bytes(16));
  const masterVol = r.u8();
  const numSamples = r.u8();
  if (numSamples > 63 || numBlocks > 0x7fff) throw new Error("not a valid OctaMED song (too many instruments or blocks)");

  const hardwareMix = h.version < 2 || !(flags2 & 0x80);
  const bpmMode = !!(flags2 & 0x20);
  const tempoMode: TempoMode = bpmMode ? "bpm" : "spd";

  // ── the sequence and the tracks ────────────────────────────────────────
  let sequence: number[] = [];
  let tracks = 4;
  let trackVolume: number[] = [];
  let trackPan: number[] | null = null;
  if (h.version < 2) {
    r.seek(songArea);
    sequence = Array.from(r.bytes(256)).slice(0, Math.min(256, songLength));
    trackVolume = trackVol16;
  } else {
    r.seek(songArea);
    const playSeqTable = r.u32();
    const sectionTable = r.u32();
    const trackVols = r.u32();
    const numTracks = r.u16();
    const numPlaySeqs = r.u16();
    const trackPanOffset = r.u32();
    const flags3 = r.u32();
    if (numTracks < 1 || numTracks > 64) throw new Error(`not a valid OctaMED song (${numTracks} tracks)`);
    tracks = numTracks;
    if (trackVols && r.can(numTracks, trackVols)) trackVolume = Array.from(r.seek(trackVols).bytes(numTracks));
    const freePan = !hardwareMix && !!(flags3 & 0x02);
    if ((freePan || h.version > 2) && trackPanOffset && r.can(numTracks, trackPanOffset)) {
      r.seek(trackPanOffset);
      trackPan = Array.from({ length: numTracks }, () => Math.max(-16, Math.min(16, r.s8())) / 16);
    }
    // the sections, each a play sequence: one after the other
    if (sectionTable && r.can(songLength * 2, sectionTable)) {
      r.seek(sectionTable);
      const sections = Array.from({ length: songLength }, () => r.u16());
      for (const sec of sections) {
        if (sec >= numPlaySeqs || !r.can(4, playSeqTable + sec * 4)) continue;
        const at = r.seek(playSeqTable + sec * 4).u32();
        if (!r.can(42, at)) continue;
        r.seek(at + 40);
        const length = r.u16();
        for (let i = 0; i < length && r.can(2); i++) {
          const b = r.u16();
          if (b < 0x8000) sequence.push(b);
        }
      }
    }
  }

  // ── the blocks ─────────────────────────────────────────────────────────
  const blocks = [];
  for (let n = 0; n < numBlocks; n++) {
    if (!r.can(4, h.blockArr + n * 4)) break;
    const at = r.seek(h.blockArr + n * 4).u32();
    if (!at || !r.can(2, at)) {
      blocks.push(newBlock(tracks, 64));
      continue;
    }
    r.seek(at);
    if (h.version < 1) {
      const t = r.u8();
      const lines = r.u8() + 1;
      tracks = Math.max(tracks, t);
      const block = newBlock(t, lines, 1);
      for (let l = 0; l < lines; l++)
        for (let k = 0; k < t; k++) {
          if (!r.can(3)) break;
          const b0 = r.u8(), b1 = r.u8(), b2 = r.u8();
          const c = block.cells[l][k];
          c.note = b0 & 0x3f;
          c.inst = (b1 >> 4) | ((b0 & 0x80) >> 3) | ((b0 & 0x40) >> 1);
          c.cmd[0] = b1 & 0x0f;
          c.val[0] = b2;
        }
      blocks.push(block);
      continue;
    }
    const t = r.u16();
    const lines = r.u16() + 1;
    const info = r.u32();
    const cellsAt = r.pos;
    if (t < 1 || t > 64 || lines > 3200) throw new Error(`block ${n}: ${t} tracks × ${lines} lines`);
    tracks = Math.max(tracks, t);
    let name = "";
    let pages: number[] = [];
    if (info && r.can(20, info)) {
      r.seek(info);
      r.u32(); // highlight mask
      const nameOffset = r.u32();
      const nameLength = r.u32();
      const pageTable = r.u32();
      if (nameOffset && nameLength && r.can(Math.min(nameLength, 255), nameOffset)) name = r.seek(nameOffset).text(Math.min(nameLength, 255));
      if (pageTable && r.can(4, pageTable)) {
        r.seek(pageTable);
        const count = r.u16();
        r.u16();
        for (let i = 0; i < count && r.can(4); i++) pages.push(r.u32());
      }
    }
    pages = pages.slice(0, 15);
    const block = newBlock(t, lines, 1 + pages.length, name);
    r.seek(cellsAt);
    for (let l = 0; l < lines; l++)
      for (let k = 0; k < t; k++) {
        if (!r.can(4)) break;
        const b0 = r.u8(), b1 = r.u8(), b2 = r.u8(), b3 = r.u8();
        const c = block.cells[l][k];
        c.note = b0 === 0x80 ? NOTE_OFF : b0 & 0x7f;
        c.inst = b1 & 0x3f;
        c.cmd[0] = b2;
        c.val[0] = b3;
      }
    pages.forEach((p, i) => {
      if (!p || !r.can(t * lines * 2, p)) return;
      r.seek(p);
      for (let l = 0; l < lines; l++)
        for (let k = 0; k < t; k++) {
          const c = block.cells[l][k];
          c.cmd[i + 1] = r.u8();
          c.val[i + 1] = r.u8();
        }
    });
    blocks.push(block);
  }
  // every block as wide as the song
  for (const b of blocks)
    for (const row of b.cells)
      while (row.length < tracks) row.push({ note: 0, inst: 0, cmd: new Array(b.pages).fill(0), val: new Array(b.pages).fill(0) });

  // ── the instruments ────────────────────────────────────────────────────
  const exp = readExp(r, h.expData);
  const instruments: Instrument[] = [];
  for (let i = 0; i < numSamples; i++) {
    const head = sampleHeads[i];
    const inst = emptyInstrument();
    inst.volume = Math.min(64, head.volume);
    inst.transpose = head.transpose;
    inst.loopStart = head.loopStart;
    inst.loopLength = head.loopLength > 2 ? head.loopLength : 0;
    const ext = exp.instrExt(i);
    if (ext) {
      inst.hold = ext.hold;
      inst.decay = ext.decay;
      inst.finetune = Math.max(-8, Math.min(7, ext.finetune));
      if (ext.volume !== undefined) inst.gain = (ext.volume + 1) / 128;
    }
    inst.name = exp.instrName(i);
    const at = h.sampleArr && r.can(4, h.sampleArr + i * 4) ? r.seek(h.sampleArr + i * 4).u32() : 0;
    if (at && r.can(6, at)) readInstrumentData(r, at, inst, h.version);
    if (ext && inst.kind === "sample") {
      if (ext.loopLength !== undefined) {
        inst.loopStart = ext.loopStart ?? 0;
        inst.loopLength = ext.loopLength;
      }
      if (ext.flags !== undefined) {
        if (!(ext.flags & 0x01)) inst.loopLength = 0;
        inst.pingPong = !!(ext.flags & 0x08);
        if (ext.flags & 0x04) inst.gain = 0;
      }
    }
    if (inst.loopStart + inst.loopLength > inst.data.length) inst.loopLength = Math.max(0, inst.data.length - inst.loopStart);
    if (inst.loopLength <= 2) (inst.loopStart = 0), (inst.loopLength = 0);
    instruments.push(inst);
  }

  const song: Song = {
    title: exp.songName,
    format: `MMD${h.version}`,
    tracks,
    blocks,
    sequence: sequence.filter((b) => b < blocks.length),
    restart: 0,
    instruments,
    tempoMode,
    tempo: defaultTempo,
    speed: Math.max(1, Math.min(32, tempo2 || 6)),
    lpb: bpmMode ? 1 + (flags2 & 0x1f) : 4,
    transpose: playTranspose,
    noteShift: h.version > 2 ? -24 : 0,
    masterVolume: masterVol ? Math.min(64, masterVol) : 64,
    trackVolume: Array.from({ length: tracks }, (_, i) => Math.max(0, Math.min(64, trackVolume[i] ?? 64))),
    trackPan: trackPan && trackPan.length === tracks ? trackPan : amigaPan(tracks),
    flags: {
      volHex: !!(flags & 0x10),
      vol7bit: h.version > 2,
      ptSlides: !!(flags & 0x20),
      eightChannel: !!(flags & 0x40),
      hardwareMix,
      filter: !!(flags & 0x01),
    },
  };
  if (!song.sequence.length) song.sequence = [0];
  if (!song.blocks.length) song.blocks.push(newBlock(tracks));
  return song;
}

/** The expansion data: instrument names and extras, the song's name. */
function readExp(r: Reader, at: number) {
  const out = {
    songName: "",
    instrExt: (_i: number): { hold: number; decay: number; finetune: number; flags?: number; loopStart?: number; loopLength?: number; volume?: number } | null => null,
    instrName: (_i: number) => "",
  };
  if (!at || !r.can(52, at)) return out;
  r.seek(at + 4);
  const extAt = r.u32();
  const extEntries = r.u16();
  const extSize = r.u16();
  r.u32();
  r.u32();
  const infoAt = r.u32();
  const infoEntries = r.u16();
  const infoSize = r.u16();
  r.seek(at + 44);
  const nameAt = r.u32();
  const nameLength = r.u32();
  if (nameAt && nameLength && r.can(Math.min(nameLength, 255), nameAt)) out.songName = r.seek(nameAt).text(Math.min(nameLength, 255));
  out.instrExt = (i) => {
    if (!extAt || i >= extEntries || extSize < 4 || !r.can(extSize, extAt + i * extSize)) return null;
    r.seek(extAt + i * extSize);
    const e: ReturnType<typeof out.instrExt> = { hold: r.u8(), decay: r.u8(), finetune: (r.u8(), r.s8()) };
    if (extSize > 5) {
      r.u8(); // default pitch
      e.flags = r.u8();
    }
    if (extSize >= 18) {
      r.seek(extAt + i * extSize + 10);
      e.loopStart = r.u32();
      e.loopLength = r.u32();
    }
    if (extSize >= 19) e.volume = r.u8();
    return e;
  };
  out.instrName = (i) => (infoAt && i < infoEntries && infoSize > 0 && r.can(Math.min(40, infoSize), infoAt + i * infoSize) ? r.seek(infoAt + i * infoSize).text(Math.min(40, infoSize)) : "");
  return out;
}

/** An instrument's sound: a sample (8 / 16 bits, mono / stereo, delta, several octaves), a synth or a hybrid. */
function readInstrumentData(r: Reader, at: number, inst: Instrument, version: number): void {
  r.seek(at);
  const length = r.u32();
  const type = r.s16();
  if (type === -1 || type === -2) {
    // synthetic / hybrid: two little programs and their waveforms
    if (!r.can(272)) return;
    r.u32();
    const loopStart = r.u16() * 2;
    const loopLength = r.u16() * 2;
    const volLen = Math.min(128, r.u16());
    const waveLen = Math.min(128, r.u16());
    inst.volSpeed = r.u8();
    inst.waveSpeed = r.u8();
    const numWaves = r.u16();
    const volTable = Array.from(r.bytes(128));
    const waveTable = Array.from(r.bytes(128));
    inst.volTable = volTable.slice(0, volLen);
    inst.waveTable = waveTable.slice(0, waveLen);
    if (numWaves > 64) return;
    const offsets = Array.from({ length: numWaves }, () => (r.can(4) ? r.u32() : 0));
    inst.waves = [];
    offsets.forEach((o, i) => {
      if (o <= 278 || !r.can(2, at + o)) return void inst.waves!.push(new Float32Array(0));
      r.seek(at + o);
      if (type === -2 && i === 0) {
        const len = r.u32();
        r.s16();
        inst.waves!.push(r.can(len) ? s8ToFloats(r.bytes(len)) : new Float32Array(0));
      } else {
        const len = r.u16() * 2;
        inst.waves!.push(r.can(len) ? s8ToFloats(r.bytes(len)) : new Float32Array(0));
      }
    });
    inst.kind = type === -1 ? "synth" : "hybrid";
    // until the synth programs play (step 5): a synth sounds its first waveform, a hybrid its sample
    const first = inst.waves[0] ?? new Float32Array(0);
    inst.data = first;
    if (type === -1) {
      inst.loopStart = 0;
      inst.loopLength = first.length;
      if (version <= 2) inst.transpose -= 24;
    } else if (loopLength > 2) {
      inst.loopStart = loopStart;
      inst.loopLength = loopLength;
    }
    return;
  }
  if (type < 0 || type & 0x80) return; // MIDI-only, VST, packed: no sound here
  const octaves = [1, 5, 3, 2, 4, 6, 7, 1][type & 0x0f] ?? 1;
  const bits16 = !!(type & 0x10);
  const stereo = !!(type & 0x20);
  const delta = !!(type & 0x40);
  const total = stereo ? length * 2 : length;
  if (!r.can(total)) return;
  let raw = r.bytes(total);
  if (delta && !bits16) raw = undelta8(raw);
  const decode = (b: Uint8Array) => (bits16 ? s16beToFloats(b) : s8ToFloats(b));
  let left = decode(stereo ? raw.subarray(0, length) : raw);
  inst.right = stereo ? decode(raw.subarray(length)) : undefined;
  if (octaves > 1) {
    // several octaves, each twice as long as the one before: the longest (the last) plays every note
    const first = Math.floor(left.length / ((1 << octaves) - 1));
    const start = first * ((1 << (octaves - 1)) - 1);
    left = left.slice(start, start + first * (1 << (octaves - 1)));
    inst.loopStart *= 1 << (octaves - 1);
    inst.loopLength *= 1 << (octaves - 1);
    if (octaves >= 5) inst.transpose += 12;
  }
  inst.data = left;
  inst.bits16 = bits16;
  inst.kind = left.length ? "sample" : "empty";
}
