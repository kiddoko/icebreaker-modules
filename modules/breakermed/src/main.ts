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
  // you silence it from the deck (`audio stop`, the ♪ in the status bar): the song stops, not only its notes
  ib.audio.onStop?.(() => engine?.stop());
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
  ins: "ins",
  play: "jouer",
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
  "double-click: rename · right-click: mute, solo": "double-clic : renommer · clic droit : couper, solo",
  "rename…": "renommer…",
  unmute: "rétablir",
  mute: "couper",
  solo: "solo",
  "TRACK NAME": "NOM DE LA PISTE",
  save: "enregistrer",
  "export (WAV + tracks)": "exporter (WAV + pistes)",
  INSTRUMENT: "INSTRUMENT",
  "empty — load a sound:": "vide — charge un son :",
  "load…": "charger…",
  "a .wav, .aif, .iff, .mp3, .m4a, .ogg… of the vault": "un .wav, .aif, .iff, .mp3, .m4a, .ogg… du vault",
  frames: "trames",
  "at C-3": "en C-3",
  loop: "boucle",
  "LED filter": "filtre LED",
  "chop 4": "découper en 4",
  "chop 8": "découper en 8",
  "chop at attacks": "découper aux attaques",
  "stretch ×2": "étirer ×2",
  "stretch ×½": "étirer ×½",
  "fade in": "fondu d'entrée",
  "fade out": "fondu de sortie",
  "pitch +12": "hauteur +12",
  "pitch −12": "hauteur −12",
  reverse: "à l'envers",
  normalize: "normaliser",
  trim: "rogner",
  "loop off": "sans boucle",
  "ping-pong": "aller-retour",
  "bounce block": "bloc → sample",
  "LED filter on": "filtre LED",
  "LED filter off": "sans filtre LED",
  "replace this sound with a file of the vault": "remplacer ce son par un fichier du vault",
  "4 equal slices → new instruments": "4 tranches égales → nouveaux instruments",
  "8 equal slices → new instruments": "8 tranches égales → nouveaux instruments",
  "a slice at each attack": "une tranche à chaque attaque",
  "twice as long, same pitch (Amiga grains)": "deux fois plus long, même hauteur (grains Amiga)",
  "half as long, same pitch": "deux fois plus court, même hauteur",
  "an octave up (half the frames)": "une octave plus haut",
  "destructive 8 bits: the grit": "8 bits destructif : le grain",
  "4 bits, half the rate: more grit": "4 bits, moitié de la fréquence : plus de grain",
  "remove the silence at both ends": "enlever le silence aux deux bouts",
  "the loop goes back and forth": "la boucle va et vient",
  "this block, rendered into a new instrument": "ce bloc, rendu en un nouvel instrument",
  "the A500's low-pass (0FF9 / 0FF8)": "le passe-bas de l'A500 (0FF9 / 0FF8)",
  "the keys play it · alt ←→ another · alt B the block · med sample -h": "les touches le jouent · alt ←→ un autre · alt B le bloc · med sample -h",
  "a new song": "un nouveau morceau",
};
