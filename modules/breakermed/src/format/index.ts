/** Which reader a file needs, by its first bytes (its name only when they don't tell). */
import type { Song } from "../song";
import { isMed, readMed } from "./med";
import { isMod, readMod } from "./mod";

/** the names songs have: "x.med", "x.mod", and the Amiga's way: "mod.x", "med.x" */
export const SONG_EXTS = [".med", ".mod", ".mmd0", ".mmd1", ".mmd2", ".mmd3"];

export function readSong(bytes: Uint8Array, name = ""): Song {
  if (isMed(bytes)) return readMed(bytes);
  if (isMod(bytes) || /\.mod$|(^|\/)mod\./i.test(name)) return readMod(bytes);
  throw new Error("not a .med (MMD0–MMD3) or .mod file");
}
