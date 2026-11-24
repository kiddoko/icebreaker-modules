# BreakerMED — changes

## 0.13.3 (beta)

From the Windows test bench (0.13.2, 24/11).

**Fixed**
- The guide at ~1000 px: its keys were cut with « … » (« med saveas · Ctrl… », « alt pg préc · alt… », « Ctrl+Z · Ctrl+Shi… », « tabulation · ⇧ ta… »). A key too long for its column now goes on over the next lines, cut between its « · » parts first, like the descriptions beside it. The footer keeps the parts that fit, whole (« med guide ·… » was cut). Tested from 24 to 200 columns, in French and English, with ⌘ and with Ctrl.
- The cell's right-click menu in French: « effacer  suppr (mode édition) », « supprimer la ligne  ⌫ (mode édition) » (the hints were in English).
- **Amiga, Akai, Paula** keep their capitals on the page and in the LOG (« vintage Amiga : 8 bits… », not « vintage amiga »). ICEBREAKER lowers what `t()` gives and what the LOG finds in a module's table (its `uiCase`), and its list of proper names belongs to the deck. It never lowers a `{var}`, so the names now go in as `{amiga}`, `{akai}` and `{paula}`, and the French table's keys use the same `{vars}`. English was lowered too, on the page (« like the amiga »).
- Save as on a new song proposes the name in the deck's language: « songs/sans titre.bmed » in French (« untitled 2 » → « sans titre 2 »). Only the proposed name changes. In memory the song is still "untitled": the page, the tab, the autosave and the "is it named yet" checks all go by that one word, and the page already says it in French. Saved under that name, the song takes « sans titre » as its title, as any file name does.
- `med guide --text` said the names too.

## 0.13.2 (beta)

From the Windows test bench (0.13.1, 24/11).

**Fixed**
- **The limiter squashed the whole song.** The bench saw « ▮▮▮▮▮▮ LIM » the whole time the demo played and a flat output peak (max 0.107, avg 0.105 at volume 15). Measured: the tracks were mixed at 2/√tracks, so the demo ran up to 1.72 into a ceiling of 0.89 (+5.7 dB): the limiter took 1.4 dB on average and over 3 dB in 12 % of the page's blocks, and LIM (lit 1.5 s after each) never went out. The mix now has **6 dB of headroom** (1/√tracks: four tracks at full volume reach half scale, the Amiga's two voices a side): the demo peaks at 0.86, sits around −6.5 dBFS, and the limiter takes nothing. It still catches a song too loud, at −1 dBFS. A new song (8 tracks) plays 6 dB softer than in 0.13.1, at about −10 dBFS, its peaks near −5.
- **What the meter shows** (README, guide, the tip): a bar each 6 dB, all six from −3 dBFS, the peak falling back 12 dB a second; LIM when the limiter turns a peak down 3 dB or more. Now and then is fine; all the time means the song is too loud.
- A `.gitattributes` (`* text=auto eol=lf`): on a Windows clone with `core.autocrlf`, « plugin.json, package.json and the README agree » failed until `npm run build` rewrote the files.
- The guide in French: « alt pg préc · alt pg suiv », « ↑↓ ←→ · pg préc pg suiv », « tabulation · ⇧ tabulation » (and the transpose menu's hints). A row too long for the guide goes on over the next line, under its words, instead of being cut (the space row was, at 1618 px); a part's title too.
- The log in the deck's language: `med edit`, `med play` / `stop`, `med vintage` (« vintage Amiga : 8 bits… »), `med paula`, `view`, `follow`, `click`, `filter`, `octave`, `step`, `mute`, `pos`, the selection's lines (« copié 64 lignes · 8 pistes »: the size is said in pieces now, "copied 64 lines · 8 tracks"). The toasts: « enregistré · songs/… », the autosave's error, « aucun morceau dans songs/ ».
- After `med new` in French the tab says « ♫ sans titre.bmed » (the file stays untitled.bmed).
- Another song (`med demo`, `med new`, `med open`, `med recover`) starts with the edit mode off: `med demo` then ⏎ started in « ● rec ».

## 0.13.1 (beta)

From the Windows test bench (0.13.0, AMD Radeon + NVIDIA overlays, Swiss QWERTZ).

**Fixed**
- **alt T** for the vintage mode. alt Y and alt R never reached the page on that machine: AMD's and NVIDIA's overlays keep Alt+R and Alt+Z for themselves, and on a QWERTZ keyboard the key marked Y is where QWERTY has its Z (the page reads keys by place). T is the same key in the same place on QWERTY, QWERTZ and AZERTY. The INSTRUMENT button, `med vintage`, the guide, `med -h`, the README and the INSTRUMENT screen's status line ("alt T vintage") say it; alt Y / alt R still work where they arrive, unsaid.
- The page in French: the sequence's header (« pos    bloc »), a new song's name (« sans titre »: the file and the song keep "untitled").
- The guide in French: its keys' column is as wide as its widest key once the deck has said it ("med saveas · Ctrl+Shift+S" was cut to « Ctrl+Sh… » on Windows); « ⇧ espace » beside « espace » (no longer « ⇧Space »; a keycap would have cut « ⇧e »); « ou clic sur « éditer » » as the button reads; the 16 keys still in English (caps lock, delete, drag, the sequence, right-click…) in French.
- `med new` / `med open`: the numbers first, one in the singular: « untitled · 8 tracks · 1 block · 1 position · 5 instruments · 0:07 ». ICEBREAKER 0.7.2 reads a module's lines with its own table first, so in French: « sans titre · 8 pistes · 1 bloc · 1 position · 5 instruments · 0:07 » (an older deck may still say « morceaux »).
- Checked: the 0.13.0 on the STORE has `med new` (a test now loads the built main.js and runs it).

## 0.13.0 (beta)

From Fable's hands-on review of 0.12.1 and the six answers it asked for.

**Fixed**
- Edit mode wrote in the hidden block from the INSTRUMENT, SONG and EXPORT screens and the guide (a key, ⌫, delete, digits, alt C / X / V, transpose, alt ⏎, the gamepad's moves): only the BLOCK screen writes now; elsewhere the piano keys only play.
- Recording (edit mode on while it plays) was invisible: a red **● REC** at the top, the cursor's line red, and a key writes one note on the line heard (the cursor no longer jumps a step ahead of the song).
- Paste lost the chords.
- 0.12.2's two: "don't save" mentions the autosave's copy only when the autosave is on; closing a new song asks about "this new song", not “untitled”.

**Playing (D1)**
- ⏎ plays the song from the **top of the block** you're in (again while it plays: the block starts over) · ⇧⏎ loops the block from its top · **⇧Space** plays from the cursor's line. The ▶ button and the gamepad play from the block's top too.

**Line numbers (D2)**
- Lines, sequence positions and block numbers in **decimal**, like OctaMED (000–063); only the commands' values stay hex. Every `med` command that takes a line, a position or a block takes it in decimal (hex is refused, not misread); song files are unchanged (plain numbers).

**Keys (D3)**
- alt M mutes the cursor's track, ⇧ alt M solos it · alt N a new block after this position · alt D a copy of this block after it · alt ⌫ removes the position · insert (edit mode) inserts a line.

**Sound (D4)**
- A sound you load **keeps its own rate** (48 kHz stays 48 kHz; `--amiga` for the Amiga's); .bmed keeps it, .mod / .med get the Amiga's rates when saved.
- **Vintage mode**, per instrument (a sound, a synth or a kit): **amiga** (Paula: 8 bits, each value held for the note's own period, aliasing, the A500's 2-pole) or **akai** (S900 / S950-style: 12 bits, 22 050 Hz by default, no anti-alias filter). alt Y, the INSTRUMENT screen's button, `med vintage <n> amiga | akai [rate] | off`; saved in .bmed, heard in the exports.
- A key plays a sound to its end (a loop or a synth 1.5 s); the next key on the same instrument cuts it; space (stopped) silences it first.

**Comfort**
- The status line says the command under the cursor in words ("0C20 · volume 32 of 64", "0F06 · tempo 6 BPM (the speed is 09xx)", "0E12 · no such command here") and each screen's own keys; "space stop editing" while editing.
- Undo takes the cursor to what it undid; two digits typed in one field are one undo; undoing back to the saved song clears the ●.
- LIM lights from 3 dB of reduction; no note past B-9 is written (and B-9 reads right); a transpose that would push a note out of range moves nothing; the SONG screen says the BPM once; the first save's question names the song.
- Commands: `med play foo` is refused, `med tracks` and `med block lines 1` say so properly, `med pos` names the range, `med` with no song names `med new` and `med demo`.
- Dialog titles in lowercase and in French; the guide's 40 English lines translated (every string has its French: a test checks it).

**Every action has its command (§8)**
- New: `med help`, `med select track | block | none | <line> <line> [track] [track]`, `med title <text>`, `med key <C-3> [instrument]`, `med vintage`. alt L / alt K, the menu's "select", "play it" and the SONG screen's title run them; the tips name the commands.
- `med -h`, the completion and README's command block come from one list (`USAGE`; `npm run build` writes the README's); `tests/docs.test.ts` checks the dispatcher, the help, the completion, the page's commands, the README, plugin.json and the French table agree.
- The guide: ⏎ / ⇧⏎ / ⇧Space, F1–F8, tab / ⇧Tab, ⌘←→, home / end, ⌘⇧S, med continue, med new 12 / --empty, the wheel, alt G, the D3 keys, vintage; 0Cxx and 0Fxx said right; notes C-1…B-9; "? or ⌫: back".
- README: the permissions as the manifest asks them, ICEBREAKER 0.6.0 / 0.6.2 / 0.7.0, the keys, vintage. The name is BreakerMED everywhere.
