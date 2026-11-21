/**
 * One way to read a sound file into an instrument: WAV, AIFF, IFF 8SVX (our
 * own readers), anything else (MP3, M4A, OGG…) through the system's decoder
 * (ib.audio.decode). The sound becomes mono at HQ_RATE, the instrument an
 * octave up, so C-3 plays it as recorded.
 */
import { HQ_RATE, toMono } from "../sampler";
import { emptyInstrument, type Instrument } from "../song";
import { readAiff } from "./aiff";
import { read8svx } from "./iff";
import { readWav, type Pcm } from "./wav";

export const SAMPLE_EXTS = [".wav", ".aif", ".aiff", ".aifc", ".iff", ".8svx", ".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".caf"];

export async function readSample(bytes: Uint8Array, name: string, decode?: (b: Uint8Array) => Promise<Pcm>, amiga = false): Promise<Instrument> {
  const inst = emptyInstrument();
  inst.name = (name.split("/").pop() ?? name).replace(/\.[^.]+$/, "").slice(0, 40);
  let pcm: Pcm | null = readWav(bytes) ?? readAiff(bytes);
  const iff = pcm ? null : read8svx(bytes);
  if (iff) {
    pcm = iff;
    if (iff.name) inst.name = iff.name.slice(0, 40);
    inst.volume = iff.volume || 64;
  }
  if (!pcm) {
    if (!decode) throw new Error("not a WAV, AIFF or IFF file");
    pcm = await decode(bytes);
  }
  const to = amiga ? HQ_RATE / 2 : HQ_RATE;
  inst.data = toMono(pcm.channels, pcm.rate, to);
  if (!amiga) inst.transpose = 12;
  if (iff?.loopLength) {
    const k = to / iff.rate;
    inst.loopStart = Math.round(iff.loopStart * k);
    inst.loopLength = Math.round(iff.loopLength * k);
  }
  inst.kind = inst.data.length ? "sample" : "empty";
  return inst;
}
