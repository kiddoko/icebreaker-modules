# breakerMED

A tracker for ICEBREAKER that works like **OctaMED** and **ProTracker**: blocks of tracks, one
line a step, each cell a note, an instrument and hex commands; a play sequence makes the song.
It reads **.med** (MMD0–MMD3) and **.mod** files. In ASCII, in your theme's colours, with the
keyboard, the mouse and a gamepad.

> Work in progress: reading, playing, editing, saving, exporting, the sampler and the analog synth
> are here (8 tracks by default, 16 at most, named); next come the drum machine, the FM synth, chords.
> breakerMED is our own code: it works *like* OctaMED and reads its files, it isn't OctaMED
> (no code, name, look or samples of it). Credits: below.

## What it needs

- **`audio`**: it plays its sound through the deck's sampler (`ib.audio`).
- **`vault:read`**: it reads your songs from the vault (`.bmed`, `.med`, `.mod`, `mod.xxx`).
- **`vault:write`**: it saves your songs in the vault (`med save`).
- Nothing online, no account, no AI. An ICEBREAKER with `ib.audio` and pages that play the keyboard: not
  released yet (ICEBREAKER's branch `claude/breakermed-core`); on an older deck it says so and stays off.

## The page

The page **plays the keyboard**: while it's in front it keeps every key, letters, digits, space and
every **alt** combination (alt + arrows too, on Mac, Windows and Linux), like an editor keeps the arrows.
**Esc** gives the keys back to the deck (the tree takes them), a click on the page brings them back.

```
enter        play the song from the cursor      ⇧ enter    play the block, again and again
space        stop (playing) · edit mode on / off (stopped: a red ● EDIT, typing writes in the block)
↑ ↓ ← →      the cursor (← → column by column)  PgUp PgDn Home End   jump
the keys     a piano: Z S X D C V… an octave, Q 2 W 3 E… the next (by their place: AZERTY works)
             in edit mode they write the note and the instrument; ` (left of 1) writes a note off
0–9 A–F      the instrument / command columns, digit by digit (edit mode)
alt ↑ ↓      the piano's octave                 alt ← →    the instrument it plays
alt 0–9      the edit step: lines the cursor moves after a note
delete       clear the column (or the selection)   ⌫ delete the line (⇧: in every track)
alt enter    insert a line (⇧: in every track)
⇧ + arrows   select (a drag with the mouse too) alt C / X / V   copy · cut · paste
alt Q / A    transpose up / down a semitone (⇧: an octave)
⌘Z · ⌘⇧Z     undo · redo (500 steps)
mouse        click a cell, drag to select, the wheel scrolls, right-click: a menu (copy, paste,
             transpose, lines, play from here); a track's name mutes it; a position plays from it
gamepad      the cross moves, A plays / stops
```

## The `med` command

```
med                         what's loaded, where it is
med open [file]             a song of the vault (no file: choose one)
med ls                      the songs in the vault
med demo                    a little song of ours, to try it right away
med new [tracks]            a new song: 8 tracks (up to 16), the demo's instruments to start
med save [file]             my-song.bmed (ours, the default) · song.mod · song.med (for other trackers)
med track <n> name <text> · med track <n> vol <0–64> · med track <n> pan <-100–100>
med export [file.wav|.aif|.flac] [--rate 48000] [--bits 16|24|32] [--stems | --only-stems | --tracks 1,3] [--normalize] [--tail 1.5]
med play [song|block] [position] [line]
med stop
med pos <position> [line]
med mute <track> · med solo <track>
med paula on|off            stepped like the Amiga (on, the default), or smooth
med edit on|off · med step <0–9>
med note <line> <track> <C-3|^^^|---> [instrument] [command]   (line in hex, track from 1)
med block new [lines] · med block copy · med block lines <n>
med seq new|copy|rm [position] · med seq set <position> <block> · med seq add <block>
med tracks <n> · med tempo <n> · med speed <n> · med lpb <n>
med undo · med redo
med effects                 every command, one line each
med info                    the song's settings and instruments
```

## Its own format: .bmed

A song is a folder you can read: `song.json` holds the settings, the tracks (names, volume, pan),
the sequence, the instruments and every block line by line, the way the page shows it
(`C-3 01 0C20 | --- .. ....`); `samples/` holds each instrument's sound as a WAV file. `.med`
(MMD1) and `.mod` are written too, for other trackers: `med save` says what they couldn't keep.

## Export

`med export` computes the song again, here, at the rate you choose (22.05 to 96 kHz, whatever the
sound card's), and writes **WAV** (16 or 24 bits, or 32-bit float), **AIFF** (32-bit float as
AIFF-C) or **FLAC** (16 / 24 bits, lossless, our own encoder). `--stems` adds **each track on its
own** (`<name> stems/01 lead.wav`…), `--only-stems` only those, `--tracks 1,3` the ones you say.
Muted tracks stay muted; the end rings out for `--tail` seconds, then fades; 16 bits get a little
dither. MP3 / M4A / OGG come later, through an encoder pack the deck downloads on request.

## The sampler

alt I shows the instrument (alt B the block again): its sound in braille dots, and a button a
tool. Each runs a `med sample` command (the LOG shows it, ⌘Z undoes it):

```
med sample <n|.> load [file] [--amiga]   a sound of the vault (wav, aif, iff/8svx, mp3, m4a, ogg…)
med sample <n|.> chop <slices> | chop onsets    slices become new instruments
med sample <n|.> stretch <×> [grain]     longer / shorter, same pitch, the Amiga way (it grinds)
med sample <n|.> fade in|out [ms] · pitch <semitones> [--smooth] · reverse
med sample <n|.> crush [bits] [hold]     destructive 8-bit and a lower rate
med sample <n|.> normalize · trim · loop <start> <length> | off | pingpong
med sample <n|.> name · vol · fine · transpose · clear · info
med bounce [--tracks 1,3] [--song]       the block (or the song) into a new instrument
med filter on|off                        the A500's LED filter (also 0FF9 / 0FF8)
```

## The analog synth

An instrument can be a **subtractive synth** instead of a sound: two oscillators (saw, square with
its width, triangle, sine, noise) and a sub an octave down → a filter (low, high or band-pass,
12 or 24 dB, resonance, key tracking) → the amplifier; an envelope (ADSR) for each, an LFO for the
pitch, the filter or the width, and glide. C-3 is middle C; the tracker's commands (slides,
vibrato, arpeggios, volume) play it like a sample, a note off (`^^^`) starts its release, and a
new note lets the old one ring out.

On the INSTRUMENT screen (alt I) an empty instrument has an **analog synth** button; a synth shows
its presets above and a row a setting: ↑↓ choose, ←→ change (⇧ faster), or click ‹ ›, or the wheel.

```
med synth <n|.> new [preset]     the instrument becomes a synth (bass acid lead pad pluck brass sine)
med synth <n|.> preset <name>    another starting point
med synth <n|.> set <setting> <value>   e.g. set cutoff 800 · set reso 0.7 · set osc1.wave square
med synth <n|.> show             every setting · med synth settings: their names and ranges
med synth <n|.> bake             the synth as a sample of its C-3 (then the sampler's tools work on it)
```

`.bmed` keeps the settings. `.mod` and `.med` hold samples only: a synth is written as a sample of
its C-3 (`med save` says so).

## How it plays

breakerMED computes its sound itself (every track, every instrument) and streams it to the deck
(`ib.audio.stream`): about 30 ms from a key to the sound, and an export will be exactly what you
hear. The track headers show the names: double-click one to rename it, right-click to mute or solo.

## Commands (OctaMED's numbering)

`med effects` lists them: 00 arpeggio · 01/02 slides · 03 slide to note · 04 vibrato · 05/06 ·
07 tremolo · 09 speed · 0A/0D volume slide · 0B jump · 0C volume · 0F tempo and its specials ·
11/12 fine slides · 14 ProTracker vibrato · 15 finetune · 16 loop · 18 cut · 19 offset ·
1A/1B fine volume · 1D next block · 1E repeat line · 1F delay / retrigger · 2E pan.
Not yet: 08 hold/decay as a command, 0E synth jump, 20 reverse, the synth instruments' programs.

## Building

```bash
cd modules/breakermed
npm install
npm run check    # types + tests
npm run build    # → main.js, one readable file (the STORE reads every line)
```

`src/icebreaker.ts` holds the types of ICEBREAKER's module API that breakerMED uses (the full
API: ICEBREAKER's `src/plugins/api.ts` and docs/PLUGINS.md). The CI checks that `main.js` is
exactly what the sources build.

## Credits and licenses

breakerMED is our own code, under the MIT license (this repository's). What it reads is public:
the `.mod` format (ProTracker's, documented everywhere) and OctaMED's MMD0 / MMD1 as Teijo
Kinnunen described them in MED-FORM.TXT. For MMD2 / MMD3, the command pages, the tempo modes and
the octave folding of the Amiga's voices, we checked our reader against
[libopenmpt](https://lib.openmpt.org)'s (`soundlib/Load_med.cpp`, BSD-3-Clause, © OpenMPT Devs):
read for reference, not copied. OctaMED's name, code, look and samples aren't used: breakerMED
works *like* it and reads its files (interoperability), nothing more. The demo song (`med demo`,
`src/demo.ts`) is ours: its samples are computed, its notes written here.
