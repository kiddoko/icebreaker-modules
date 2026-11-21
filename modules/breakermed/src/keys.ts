/**
 * The computer's keyboard as a piano, the way trackers have always done it:
 * the bottom row (Z S X D C V G B H N J M) is an octave, the row above it
 * (Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P) the next one and a bit. Read by the
 * key's PLACE (KeyboardEvent.code), never its letter: on an AZERTY keyboard
 * W X C… sit where Z X C… are on a QWERTY one, and play the same notes.
 */
const PIANO: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
};

/** The semitone above the octave's C a key plays (0–31), or null for a key that isn't on the piano. */
export function pianoKey(code: string): number | null {
  return code in PIANO ? PIANO[code] : null;
}
