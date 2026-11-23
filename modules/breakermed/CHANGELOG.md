# BreakerMED — changes

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
