/**
 * BreakerMED — the starter sound pack: the sampled sounds we want, made by people
 * (not computed: those are the synths and the drum machine). Until a musician
 * records one, it's a placeholder: listed, not there. SOUND_DESIGN.md says how to
 * make them; `med pack` shows which are in the vault, `med pack load <name>` loads one.
 */

/** where the pack lives in the vault */
export const PACK_DIR = "sounds/breakermed-pack";

export interface PackSound {
  /** the file, under PACK_DIR */
  file: string;
  /** what it is, for the musician */
  what: string;
  /** "C-3": a pitched sound, recorded at middle C; null: a one-shot (drums, effects) */
  pitch: "C-3" | "C-2" | null;
  /** it should loop (a held note, a texture): see SOUND_DESIGN.md */
  loop: boolean;
}

export const PACK: PackSound[] = [
  { file: "drums/kick-acoustic.wav", what: "an acoustic kick drum, one hit", pitch: null, loop: false },
  { file: "drums/snare-acoustic.wav", what: "an acoustic snare, one hit, medium", pitch: null, loop: false },
  { file: "drums/hat-closed.wav", what: "a closed hi-hat, one hit", pitch: null, loop: false },
  { file: "drums/hat-open.wav", what: "an open hi-hat, let ring", pitch: null, loop: false },
  { file: "drums/ride.wav", what: "a ride cymbal, one hit", pitch: null, loop: false },
  { file: "drums/crash.wav", what: "a crash cymbal, let ring", pitch: null, loop: false },
  { file: "drums/tom-low.wav", what: "a floor tom", pitch: null, loop: false },
  { file: "drums/tom-high.wav", what: "a rack tom", pitch: null, loop: false },
  { file: "drums/clap.wav", what: "real hands clapping, a few people", pitch: null, loop: false },
  { file: "drums/shaker.wav", what: "a shaker, one shake", pitch: null, loop: false },
  { file: "drums/tambourine.wav", what: "a tambourine, one hit", pitch: null, loop: false },
  { file: "keys/piano-c3.wav", what: "an acoustic piano, middle C, let ring", pitch: "C-3", loop: false },
  { file: "keys/epiano-c3.wav", what: "an electric piano, middle C", pitch: "C-3", loop: false },
  { file: "keys/organ-c3.wav", what: "an organ, middle C, held", pitch: "C-3", loop: true },
  { file: "bass/bass-electric-c2.wav", what: "an electric bass, C an octave under middle C", pitch: "C-2", loop: false },
  { file: "bass/bass-upright-c2.wav", what: "an upright bass, plucked, C under middle C", pitch: "C-2", loop: false },
  { file: "guitar/guitar-clean-c3.wav", what: "a clean electric guitar, middle C", pitch: "C-3", loop: false },
  { file: "guitar/guitar-muted-c3.wav", what: "a palm-muted guitar, middle C", pitch: "C-3", loop: false },
  { file: "strings/strings-c3.wav", what: "strings (or one violin / cello), middle C, held", pitch: "C-3", loop: true },
  { file: "voice/vox-ah-c3.wav", what: "a voice singing “ah”, middle C, held", pitch: "C-3", loop: true },
  { file: "voice/vox-oh-c3.wav", what: "a voice singing “oh”, middle C, held", pitch: "C-3", loop: true },
  { file: "voice/vox-hey.wav", what: "a short shout: “hey!”", pitch: null, loop: false },
  { file: "fx/vinyl-crackle.wav", what: "vinyl crackle, a texture", pitch: null, loop: true },
  { file: "fx/riser.wav", what: "a rising sweep, 2–4 s", pitch: null, loop: false },
  { file: "fx/impact.wav", what: "a big hit, with its tail", pitch: null, loop: false },
];

/** a sound of the pack by its name: "kick-acoustic", "drums/kick-acoustic", the file */
export const findPack = (name: string) => {
  const n = name.toLowerCase().replace(/\.wav$/, "");
  return PACK.find((p) => p.file.replace(/\.wav$/, "") === n || p.file.split("/").pop()!.replace(/\.wav$/, "") === n);
};
