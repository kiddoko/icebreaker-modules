/**
 * breakerMED — a tracker for ICEBREAKER that works like OctaMED and
 * ProTracker: blocks of tracks, one line a step, notes + instrument + hex
 * commands, a play sequence. It reads .med (MMD0–MMD3) and .mod.
 *
 * It runs in the deck's sandbox: its sound goes through ib.audio (permission
 * "audio"), its files through ib.vault (permission "vault:read").
 *
 *   src/song.ts         what a song is (one model for .med and .mod)
 *   src/format/         the readers (and, step 3, the writers)
 *   src/replayer.ts     the song, tick by tick
 *   src/engine.ts       the replayer, ahead of the sound, into ib.audio
 *   src/app.ts          the page · src/commands.ts the `med` command · src/keys.ts the piano
 *
 * Built into one readable main.js: `node modules/breakermed/build.mjs`.
 */
import type { IcebreakerAPI } from "./icebreaker";
import { makeApp, newState, type State } from "./app";
import { registerCommands } from "./commands";
import { Engine } from "./engine";

let engine: Engine | null = null;

export function activate(ib: IcebreakerAPI): void {
  // the deck's sampler came after 0.5.0: say so plainly on an older deck
  if (!ib.audio || typeof ib.audio.schedule !== "function") throw new Error("breakerMED needs a newer ICEBREAKER (one with ib.audio, the modules' sound): update the deck");
  ib.lib.addTranslations("fr", FR);
  engine = new Engine(ib.audio);
  const st: State = newState();
  engine.onChange = () => ib.ui.redraw();
  void ib.storage.get("paula", true).then((v) => engine && (engine.paula = v !== false));

  registerCommands(ib, engine, st);
  ib.apps.register({
    kind: "breakermed",
    title: "breakerMED",
    description: "a tracker: .med and .mod songs, played and edited",
    icon: "♫",
    launcher: true,
    // the keyboard is a piano here: every key comes with its place (KeyZ…), never as text
    rawKeys: true,
    create: () => makeApp(ib, engine!, st),
  });
  ib.palette.register({ id: "breakermed.open", title: "breakerMED: open a song…", run: () => void ib.shell.run("med open") });
  ib.palette.register({ id: "breakermed.stop", title: "breakerMED: stop", run: () => void ib.shell.run("med stop") });
}

export function deactivate(): void {
  engine?.stop();
  engine = null;
}

const FR: Record<string, string> = {
  "enter play": "entrée joue",
  block: "bloc",
  "space stop": "espace stop",
  "keys: a piano": "touches : un piano",
  octave: "octave",
  instrument: "instrument",
  "med open <file.med|.mod> — or drop one in the vault": "med open <fichier.med|.mod> — ou dépose-en un dans le vault",
  speed: "vitesse",
  "no song loaded": "aucun morceau chargé",
  SEQUENCE: "SÉQUENCE",
  INSTRUMENTS: "INSTRUMENTS",
  "(no name)": "(sans nom)",
  BLOCK: "BLOC",
  line: "ligne",
  track: "piste",
  "mute / unmute this track": "couper / rétablir cette piste",
  "med open <file.med|.mod> — or med demo": "med open <fichier.med|.mod> — ou med demo",
  "play from here": "jouer d'ici",
  "insert a new block here": "insérer un nouveau bloc ici",
  "insert a copy of this block": "insérer une copie de ce bloc",
  "remove this position": "retirer cette position",
  copied: "copié",
  copy: "copier",
  cut: "couper",
  paste: "coller",
  clear: "effacer",
  "transpose up": "transposer vers le haut",
  "transpose down": "transposer vers le bas",
  "an octave up": "une octave plus haut",
  "an octave down": "une octave plus bas",
  "insert a line": "insérer une ligne",
  "delete the line": "supprimer la ligne",
  EDIT: "ÉDITION",
  space: "espace",
  stop: "stop",
  edit: "éditer",
  step: "pas",
  leave: "sortir",
  oct: "oct",
  "nothing to undo": "rien à annuler",
  undone: "annulé",
  redone: "rétabli",
  note: "note",
  digit: "chiffre",
  "insert line": "insertion de ligne",
  "delete line": "suppression de ligne",
  transpose: "transposition",
  "new block": "nouveau bloc",
  "copy block": "copie de bloc",
  "block length": "longueur du bloc",
  tracks: "pistes",
  sequence: "séquence",
  "open a song…": "ouvrir un morceau…",
  "the demo song": "le morceau de démo",
};
