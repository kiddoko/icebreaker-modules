# BreakerMED (beta)

A tracker for ICEBREAKER that works like **OctaMED** and **ProTracker**: blocks of tracks, one
line a step, each cell a note, an instrument and hex commands; a play sequence makes the song.
It reads and writes **.bmed** (its own: a folder that keeps everything), **.med** (MMD0–MMD3) and
**.mod** files. In ASCII, in your theme's colours, with the keyboard, the mouse and a gamepad.

> Work in progress: reading, playing, editing, saving (with an **autosave** that never writes over
> your song), exporting, the sampler (each sound at its own rate, or **vintage**: heard through an
> Amiga or an old Akai sampler), the analog, FM and **chip** synths, the drum machine, chords and
> OctaMED's echo are here (8 tracks by default, 16 at most, named), and exports to WAV, AIFF, FLAC —
> and MP3, M4A, OGG, Opus through the deck's encoder pack.
> BreakerMED is our own code: it works *like* OctaMED and reads its files, it isn't OctaMED
> (no code, name, look or samples of it). Credits: below.

## What it needs

- **`audio`**: it plays its sound through the deck's sampler (`ib.audio`).
- **`notify`**: the little notes it shows ("saved · songs/x.bmed", "copied").
- **`vault:read:songs/`**: it reads your songs and sounds in `songs/` only (`.bmed`, `.med`, `.mod`, `mod.xxx`, `.wav`…).
- **`vault:write:songs/`**: it saves your songs in `songs/` (`med save`, and the autosave's copies in `songs/.recovery/`).
- Nothing online, no account, no AI. ICEBREAKER **0.6.0** or later (on an older deck it says so and
  stays off) · **0.6.2** hands ⌘S and tab to the page · **0.7.0** F1–F8, ⌘←→, ⇧Tab and an autosave
  that never asks · **0.7.2** its shell lines in French with its own words ("8 pistes"). MP3 / M4A / OGG / Opus exports need the encoder pack (below).

> **Beta.** Everything below works and was tested on macOS and Windows; it may still have rough
> edges. Tell us what breaks (the deck's Issues on GitHub).

## The page

With no song, the page shows the logo and **START**: **N** new song · **O** open · **D** demo ·
**?** guide · **C** a chiptune song · **S** the sampler (a click, the letter, or the arrows and ⏎).

**Space** (or a click on **edit** in the top line) turns the **edit mode** on and off: "edit"
becomes a red "● edit", the cursor's line turns red, and the keys write notes. Off, the keys only
play: delete and ⌫ change nothing either. Edit mode on while the song plays is **recording**: a red
"● rec" at the top, and each key writes its note on the line being heard. Only the BLOCK screen
writes: on INSTRUMENT, SONG, EXPORT and the guide the keys only play.

**Line numbers, positions and block numbers are decimal**, like OctaMED's (000–063), in the page
and in the `med` commands; only the commands' values stay hex (`0C40`).
The status line says the command under the cursor in words: "0C20 · volume 32 of 64",
"0F06 · tempo 6 BPM (the speed is 09xx)".

The **top line** is made of buttons, each with a tip on hover: **▶ play** (■ while it plays: stop),
**edit**, the **tempo** and the **speed** (the wheel changes them, a click opens SONG), the octave
and the step (the wheel), **stepped / smooth** (the sound, like the Amiga's Paula or interpolated),
the echo, **follow**, the **metronome**, and "✓ saved 23:21" (a ● before the song's name while it
has changes not saved). While it plays: the mix's **level** (▮▮▮▮▯▯: a bar each 6 dB, all six from
−3 dBFS; a peak falls back 12 dB a second) and **LIM** when the limiter turns a peak down 3 dB or more
(it stays lit 1.5 s). On a song at a sane level LIM comes now and then; lit all the time, the song is
too loud (lower its tracks' or instruments' volume). **?** (or alt G, the ? tab, `med guide`) opens the **GUIDE**:
how to start, the edit mode, the keys, a cell's columns, every effect command in hex, the sampler.

Five screens on the right, by their tabs or **alt B / I / S / E** and **?**:

- **BLOCK**: the editor (below).
- **INSTRUMENT**: the selected instrument: a sample's tools, a synth's settings, a kit's drums, or
  a free slot's choices.
- **SONG**: the song's settings (title, tempo, speed, lines a beat, **swing**, tracks, echo, LED
  filter) and the tracks (name, volume, pan, **chord strum**, mute, solo). ↑↓ a row, ←→ a value
  (on a track: a column, ⇧←→ its value), ⏎ renames or switches; the mouse: click, wheel, ‹ ›.
- **EXPORT**: one window for `med export`: the file, the format (WAV, AIFF, FLAC, MP3, M4A, OGG,
  Opus), the rate, the bits or the quality, the stems, normalize, the tail, and ▶ EXPORT. It runs
  the same command as the shell (the LOG shows it) and says when it's done.

The page **plays the keyboard**: while it's in front it keeps every key, letters, digits, space and
every **alt** combination (alt + arrows too, on Mac, Windows and Linux), like an editor keeps the arrows.
**Esc** gives the keys back to the deck (the tree takes them), a click on the page brings them back.

```
⏎            the song, from the top of this block (again while it plays: the block starts over)
⇧ ⏎          this block, looped, from its top        ⇧ space    play from the cursor's line
space        stop (playing) · edit mode on / off (stopped: a red ● edit, typing writes in the block)
tab · ⇧ tab  the next track · the one before         ⌘ ← → · ⇧ alt ← →   the position before · after
alt F        follow the song while it plays, or not (scroll lock too): off, the cursor stays where you edit
↑ ↓ ← →      the cursor (← → column by column)       PgUp PgDn Home End   jump
the keys     a piano: Z S X D C V… an octave, Q 2 W 3 E… the next (by their place: AZERTY works)
             in edit mode they write the note and the instrument; ` (left of 1), 1 or caps lock: a note off
F1–F8        the piano's octave (alt ↑ ↓ too)        alt ← →    the instrument it plays
0–9 A–F      the instrument / command columns, digit by digit (edit mode)
alt 0–9      the edit step: lines the cursor moves after a note
delete       clear the column (or the selection)   ⌫ delete the line (⇧: in every track) — edit mode only
alt ⏎ · insert   insert a line (⇧: in every track)
⇧ + arrows   select (a drag with the mouse too) alt C / X / V   copy · cut · paste
alt L · alt K   select the track · the whole block
alt PgUp / PgDn transpose up / down a semitone (⇧: an octave), the same on every keyboard (alt Q / A too)
alt M · ⇧ alt M   mute the cursor's track · solo it (again: back)
alt N · alt D · alt ⌫   a new block after this position · a copy of this block after it · remove the position
alt T        the instrument's vintage mode: off → amiga → akai (the same key on QWERTY, QWERTZ, AZERTY; see Vintage)
⌘Z · ⌘⇧Z     undo · redo (500 steps): notes, blocks, instruments, the song's settings
             (tempo, swing, echo…), mutes; the cursor goes where it changed back; one field typed is one undo
⌘S · ⌘⇧S     save · save as…
alt B I S E  the screens: BLOCK · INSTRUMENT · SONG · EXPORT · ? or alt G the guide
chord column    one digit, 1–F (when the song has chords: see Chords)
mouse        click a cell, drag to select (the view holds still; at the frame's edge it scrolls), the
             wheel scrolls, right-click: a menu (copy, paste, transpose, lines, play from here);
             a track's ■ mutes it (it lights while the track plays); a click on its name moves the
             cursor there, a double-click renames it, a right-click: mute, solo, rename
sequence     a click goes there, a double-click plays from it; ‹ › or the wheel on the block number:
             another block; drag a position to move it; right-click: use another block…, move up /
             down, insert; "+1 block unused" under it: add those blocks, or delete them
gamepad      the cross moves, A plays (the song from this block's top) / stops
```

A key plays a sound **to its end** (a looped one or a synth 1.5 s, a drum rings out); the next key on
the same instrument cuts it, and space (stopped) silences it before it switches the edit mode.

**The view**: the cursor's line stays in the middle of the block (ProTracker's way, the default);
`med view edges` makes the view scroll only when the cursor nears its edges (OctaMED's), `med view
center` brings it back.

## The `med` command

`med -h` and `med help` print this (the list below is written from the same text by `build.mjs`):

<!-- usage: start -->
```
med                        what's loaded, where it is
med help                   this list (also med -h)
med open [file]            a .med / .mod / .bmed in songs/ (no file: choose one)
med ls                     the songs in the vault
med demo                   a little song of ours, to try it right away
med new [tracks] [--empty] [--force] a new song: 8 named tracks (up to 16), drums, synths and a first bar · --empty: a blank page
med new --chip             a chiptune song: 2 pulses, a triangle, a noise (NES-style), chip instruments, a bar
                           (new, open, demo: a song with changes asks first · --force: replace it, the autosave keeps a copy)
med save [file]            .bmed (ours: a folder, keeps everything — the default), .mod or .med (for other trackers)
med saveas                 save as… (a name asked in a window) · ⌘S saves, ⌘⇧S saves as on the page
                           never over another song without asking (--force: no question) · a new song asks for its name
med continue               back to the song in memory (after the page was closed)
med title <text>           the song's title (60 characters at most)
med export [file.wav|.aif|.flac] [--rate 48000] [--bits 16|24|32] [--stems | --only-stems | --tracks 1,3] [--normalize] [--tail 1.5]
med export file.mp3|.m4a|.ogg|.opus [--quality …]   through the deck's encoder pack (encoders install, once)
med play [song|block] [position] [line]   no position: the cursor's · a position: from its line 0 (or the line given)
                           the page: ⏎ the song from this block's top · ⇧⏎ this block, looped · ⇧Space from the cursor
med stop
med pos <position> [line] [track]   move the cursor (and where play starts)
med key <C-3> [instrument]   hear a note (nothing is written: the piano's keys do the same)
med mute <track> · med solo <track>   (again: back) · alt M, ⇧ alt M on the page
med track <n> name <text> · med track <n> vol <0–64> · med track <n> pan <-100–100> · med track <n> strum <0–200 ms>
med paula on|off           stepped like the Amiga (on), or smooth
med vintage <01–3F|.> amiga | akai [7500–40000] | off   an instrument heard through an Amiga's Paula or an old Akai sampler (alt T)
med edit on|off            typing writes in the block (space on the page)
med view center|edges      the block's view: the cursor's line in the middle (the default), or scrolling at the edges
med follow on|off          while playing, the cursor follows the song (off: it stays where you edit · alt F)
med click on|off           the metronome: a click on each beat while playing (or med metronome)
med step <0–16>            lines the cursor moves after a note (alt 0–9 on the page)
med octave <1–8> · med ins <01–3F>   the octave and the instrument the keys play
med guide [--text]         the guide on the page (? or the ? tab) · --text: here
med screen block|instrument|song|export|guide   what the page shows (the tabs, alt B I S E, ?)
med select track|block|none · med select <line> <line> [track] [track]   what copy, cut, clear, transpose work on
med copy · cut · paste · clear   the selection (or the cell under the cursor) · med transpose <±semitones>
med line insert|delete [--all]   a line at the cursor, in its track (--all: every track)
med note <line> <track> <C-3|^^^|---> [instrument] [command]   write a cell (line in decimal, track from 1, the rest hex)
med chord <line> <track> <0–F>   the chord a note plays (its own column, after the instrument)
med chords · med chords on|off · med chords set <1–F> <name> <semitones…> · med chords invert <1–F> [1|2|3] · med chords reset
med block                  the blocks: their length, the positions that play them
med block new [lines] · med block copy · med block lines <n> · med block rm <block> (one in no position)
med seq                    the sequence: position → block
med seq new|copy|rm [position] · med seq set <position> <block> · med seq add <block> · med seq move <position> up|down
med tracks <1–16> · med tempo <n> · med speed <n> · med lpb <n>
med swing <0–100>          every other line longer (0 straight, 100 triplets)
med echo off | normal|cross [ms] [depth 1–6]   OctaMED's echo on the whole mix
med sampler [file]         load a sound into a free instrument (no file: choose one)
med autosave [on|off] [every <10–300 s>]   a copy after each change, in songs/.recovery/ (never over the song)
med recover [list | <n> | forget <n>]   the autosaved copies never saved: back on the page, or forgotten
med pack · med pack load <name>   the starter sound pack (sampled by people: SOUND_DESIGN.md) — which are there, load one
med undo · med redo
med sample <n|.> load [file] [--amiga]   a sound file in songs/ (wav, aif, iff/8svx, mp3, m4a, ogg…)
med sample <n|.> chop <slices> | chop onsets    slices become new instruments
med sample <n|.> stretch <×> [grain]     longer / shorter, same pitch, the Amiga way (it grinds)
med sample <n|.> fade in|out [ms] · pitch <semitones> [--smooth] · reverse
med sample <n|.> crush [bits] [hold]     destructive 8-bit (default) and lower rate (hold > 1)
med sample <n|.> normalize · trim · loop <start> <length> | off | pingpong
med sample <n|.> name <text> · vol <0–64> · fine <-8…7> · transpose <semitones> · clear · info
med bounce [--tracks 1,3] [--song]       the block (or the song) rendered into a new instrument
med filter on|off                        the A500's LED filter (also 0FF9 / 0FF8)
med synth <n|.> new [preset]             the instrument becomes an analog synth (presets: med synth presets)
med fm <n|.> new [preset]                the instrument becomes an FM synth (presets: med fm presets)
med synth|fm <n|.> preset <name> · set <setting> <value> · up|down <setting> · show · settings
med synth|fm <n|.> bake                  the synth as a sample of its C-3 (for the sampler's tools)
med chip <n|.> new [preset]              the instrument becomes a chip synth (2a03 dmg sid ay psg pce · med chip presets)
med chip <n|.> set chip|wave|duty|noise|arp|sweep… <value> · table <32 hex digits>   its own wavetable
med drums <n|.> new [kit]                the instrument becomes a drum machine (med drums kits: classic punch tight lofi boom house…)
med drums <n|.> kit <name> · set <drum> tune|decay|level|tone <value> · grit <bits> [hold] · show
med drums <n|.> bake <drum>              one drum as a sample · drums: C kick C# rim D snare D# clap E closed hat
                                         F low tom F# open hat G mid tom G# cowbell A high tom A# crash B ride
med effects                every command (00–2E) in one line each
med info                   the song's settings
```
<!-- usage: end -->

Every command says what it did ("tempo 118 BPM", "position 02 → block 001"), and an error names
what's wrong ("track 9: the song has 4", "instrument 7F: they are 01–3F"). Everything the mouse
does has its command: a button's tip names it, and the LOG shows it when it runs.

## Saving

**save** and **save as…** at the end of the tabs row (also in the right-click menu and on START
after the page was closed), `med save`, `med saveas`. On the page ⌘S saves and ⌘⇧S saves as
(ICEBREAKER 0.6.2 hands them to the page). **A save never writes over another song without
asking**: a song never saved asks for its name (its title, or a free "untitled 2"), and a file that
holds another song asks before it's replaced. Saved, a note says where, and the top line says
"✓ saved 23:21". **new, open, demo** and **recover** never replace a song with changes without
asking either: save them first, don't save (the autosave writes its copy first: `med recover`
finds it), or cancel. From a script, add `--force`.
Songs go in `songs/`: the module may only read and write that folder (`vault:read:songs/`,
`vault:write:songs/`).

Closing the page stops the song; opening it again shows START (even when it was closed on the
guide), with **L continue “…”**. START's **O open…** says so on the page when songs/ has no song yet.

## Autosave

A copy of the song **1.5 s after each change** (a run of keys makes one copy; at most every 30 s
while it plays), in `songs/.recovery/`: never over your song. The top line says
"✓ autosaved 21:14". Opening the song again offers the unsaved changes back; so do START (**R**)
and `med recover`. Closing the page with changes asks: save, don't save, or cancel. `med save`
makes the copy useless, so it's forgotten. `med autosave on|off`, `med autosave every <10–300 s>`.

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
The stems are taken **before the mix's limiter**, so together they add up to the mix (the master
has the limiter: it never clips). The EXPORT screen starts on **master** only.
A DC blocker (a 10 Hz high-pass) takes out any offset before the limiter.
Muted tracks stay muted; the end rings out for `--tail` seconds, then fades; 16 bits get a little
dither.

**MP3, M4A (AAC), OGG (Vorbis) and Opus** go through the deck's **encoder pack**: a small LGPL
ffmpeg that ICEBREAKER downloads once when *you* ask (`encoders install`, ~3 MB; a module can't
install it). Without it, `med export x.mp3` says so and nothing is written. Then:

```
med export songs/x.mp3                 MP3, VBR V0 (the best VBR), 48 kHz
med export songs/x.m4a --rate 44100    AAC 256 kbps, CD rate
med export songs/x.ogg --quality q8    Vorbis, quality 8
med export songs/x.opus --stems        Opus 128 kbps (always 48 kHz), and each track apart
```

`--quality`: mp3 `v0` (default) `v2` `128` `192` `256` `320` · m4a `256` (default) `192` `128` ·
ogg `q6` (default) `q4` `q8` · opus `128` (default) `96` `160`. These formats go up to 48 kHz. The
song's title goes in the file (a stem's: "title — track"). It needs ICEBREAKER 0.5.5 or later
(`ib.audio.encode`); an older deck exports WAV, AIFF and FLAC as before.

## Swing and a new song

`med swing <0–100>` makes every other line longer and the next one shorter (a pair keeps its length,
so the song's length doesn't change): 0 is straight, 50 a lazy shuffle, 100 a triplet feel. The SONG
screen sets it too. `.bmed` keeps it.

`med new` starts from a template: 8 named tracks (kick, snare, hats, bass, lead, pad, chords, fx), a
drum machine, an analog bass, lead and pad, an FM e-piano, and a bar written four times, so ⏎ plays
something at once. Kick, snare and bass sit in the middle (hats a little right, lead left, pad and
chords apart), the kick on top of the mix; `--chip` keeps its four tracks near the middle (the NES
is mono). `med new 12` gives 12 tracks; `med new --empty` a blank page with the demo's samples.

## Chords

A note can play a **chord**: the cell's chord column (one digit, after the instrument) picks one of
the song's 15 chords, and its notes play over the one written, with the same instrument; slides,
vibrato, volume and pan move them all, a note off stops them all, and together they're about as
loud as one note.

```
1 maj  +4 +7      2 min  +3 +7      3 7    +4 +7 +10   4 m7   +3 +7 +10   5 maj7 +4 +7 +11
6 sus2 +2 +7      7 sus4 +5 +7      8 dim  +3 +6       9 aug  +4 +8       A 5    +7
B 6    +4 +7 +9   C m6   +3 +7 +9   D add9 +4 +7 +14   E m9   +3 +7 +10 +14  F oct +12
```

The column shows when the song has chords (typing a digit in it, `med chord`, or `med chords on`);
hidden, the cursor steps over it. The status line names the chord under the cursor.

```
med chord <line> <track> <0–F>        the chord a note plays (0: none)
med chords                            the table · med chords on|off   the column
med chords set <1–F> <name> <semitones…>   the song's own chord, e.g. med chords set 1 pow 7 12
med chords invert <1–F> [1|2|3]       that chord turned over (1: the third in the bass, 2: the fifth)
med chords reset                      the default table back
med track <n> strum <0–200>           that track's chords strummed: ms between their notes (0: together)
```

`.bmed` keeps them (`C-3 01:3 0C20`: chord 3 rides on the instrument). Other trackers play only
the note written (`med save` says so); `med bounce` keeps a chord's sound as a sample.

## The sampler

`med sampler` (or START's **S**, a free instrument's "sampler · load a sound…", the menus) loads a
sound of the vault into a free instrument. `med pack` lists the **starter sound pack**: sampled
sounds recorded by people ([SOUND_DESIGN.md](SOUND_DESIGN.md) says which, and how). Until someone
records one, it loads as a **computed placeholder** ("kick-acoustic (placeholder)", made from our
drum machine and synths), so the pack is never empty: `med pack load <name>`, or the sampler's list,
which offers the pack's sounds when songs/ has none of its own.

alt I shows the instrument (alt B the block again): its sound in braille dots, and a button a
tool. Each runs a `med sample` command (the LOG shows it, ⌘Z undoes it):

```
med sample <n|.> load [file] [--amiga]   a sound of songs/ (wav, aif, iff/8svx, mp3, m4a, ogg…), at its own rate
med sample <n|.> chop <slices> | chop onsets    slices become new instruments
med sample <n|.> stretch <×> [grain]     longer / shorter, same pitch, the Amiga way (it grinds)
med sample <n|.> fade in|out [ms] · pitch <semitones> [--smooth] · reverse
med sample <n|.> crush [bits] [hold]     destructive 8-bit and a lower rate
med sample <n|.> normalize · trim · loop <start> <length> | off | pingpong
med sample <n|.> name · vol · fine · transpose · clear · info
med bounce [--tracks 1,3] [--song]       the block (or the song) into a new instrument
med filter on|off                        the A500's LED filter (also 0FF9 / 0FF8)
```

## Vintage

Any instrument (a sound, a synth, a kit) can be heard through an old machine: **alt T** (or the
"vintage" button at the top right of the INSTRUMENT screen) goes off → amiga → akai → off, and
`med vintage <n> amiga | akai [rate] | off` does it from the shell. Only the sound changes: the
instrument's frames, its notes and the song stay as they are (off: exactly the sound before).

- **amiga** — the A500's Paula: 8 bits, each value held for the note's own period (the rate goes up
  and down with the pitch, up to 28 867 Hz, nothing smoothed in front: the aliasing), then the
  output's 2-pole low-pass (~4.4 kHz), the warmth of its filter.
- **akai** — an S900 / S950-style sampler: 12 bits at a fixed, lower rate (22 050 Hz by default,
  `med vintage 01 akai 15000` for more grit, 7 500–40 000), no anti-alias filter in front, a gentle
  2-pole after it.

Why T (0.13.0 had Y, and R before it): on Windows, AMD's and NVIDIA's overlays keep
Alt+R and Alt+Z for themselves, and on a Swiss or German QWERTZ keyboard the key marked Y is where
QWERTY has its Z; T is the same key in the same place on QWERTY, QWERTZ and AZERTY.

`.bmed` keeps it, and the WAV / FLAC / MP3… exports are what you hear. `.mod` and `.med` can't hold
it: they get the plain sound (`med save` says so).

A sound you load **keeps its own rate** (a 48 kHz file stays 48 kHz; `--amiga` loads it at the
Amiga's, smaller and grittier); `.mod` and `.med` get the Amiga's rates when they're saved.

## The analog synth

An instrument can be a **subtractive synth** instead of a sound: two oscillators (saw, square with
its width, triangle, sine, noise) and a sub an octave down → a filter (low, high or band-pass,
12 or 24 dB, resonance, key tracking) → the amplifier; an envelope (ADSR) for each, an LFO for the
pitch, the filter or the width, and glide. C-3 is middle C; the tracker's commands (slides,
vibrato, arpeggios, volume) play it like a sample, a note off (`^^^`) starts its release, and a
new note lets the old one ring out.

On the INSTRUMENT screen (alt I) an empty instrument has an **analog synth** button; a synth shows
its presets above and a row a setting: ↑↓ choose, ←→ change (⇧ faster), or click ‹ ›, or the wheel.
A ▸ marks the preset (or the drum kit) the instrument is right now; it goes once a setting moves.

```
med synth <n|.> new [preset]     the instrument becomes a synth (bass acid lead pad pluck brass sine)
med synth <n|.> preset <name>    another starting point
med synth <n|.> set <setting> <value>   e.g. set cutoff 800 · set reso 0.7 · set osc1.wave square
med synth <n|.> show             every setting · med synth settings: their names and ranges
med synth <n|.> bake             the synth as a sample of its C-3 (then the sampler's tools work on it)
```

`.bmed` keeps the settings. `.mod` and `.med` hold samples only: a synth is written as a sample of
its C-3 (`med save` says so).

## The FM synth

The basic kind of FM, the 80s' electric pianos, bells and basses: two sine waves, the
**modulator** bending the **carrier**'s phase. **ratio** sets the modulator against the note
(whole ratios sound in tune, others clang), **index** how far it bends (the brightness), its own
envelope (mod attack, decay, sustain, release) moves that over the note, **feedback** makes it
bend itself (from pure to noisy); an amp envelope and a vibrato. Presets: epiano, bell, bass,
brass, organ, pluck, metal, and the YM2612's sound (Mega Drive-style, as far as two operators go):
ym-bass, ym-slap, ym-brass, ym-lead, ym-epiano, ym-bell. The same screen and the same commands as
the analog synth:

```
med fm <n|.> new [preset] · preset <name> · set <setting> <value> · show · settings · bake
```

## The chip synth (chiptune)

One instrument, the sound chips of old consoles and home computers, a mode a chip. Its presets sit
3 dB under the other synths: a chip voice is all peak, and one alone kept the limiter working. Everything is
computed from how the chips worked (clocks, period registers, few-bit DACs, noise shift registers):
no sample or ROM from any machine.

| chip | like | what it has |
|---|---|---|
| `2a03` | NES-style | pulse 12.5 / 25 / 50 / 75 %, a 4-bit stepped triangle, noise long or short (metallic) |
| `dmg` | Game Boy-style | pulse, a 32-step 4-bit wave channel, noise 15 or 7 bits, the pitch sweep |
| `sid` | C64-style | saw, triangle, pulse of any width and its sweep (PWM), ring mod, hard sync, LP / BP / HP filter |
| `ay` | ZX Spectrum / MSX / Atari ST-style | square, noise, tone+noise, the envelope "buzzer" (saw, triangle) |
| `psg` | SN76489, Master System-style | square, white noise or periodic noise (a buzzy bass) |
| `pce` | PC Engine-style | a 32-step 5-bit wavetable |

What makes them sound like chips: the pitch snaps to each chip's period grid (high notes go a bit out
of tune, like the real thing), the volume moves in 16 steps (the SID: 256), the waves come out of a
few-bit DAC. What chiptune musicians did by hand is built in: an automatic **vibrato** after a delay,
a **pitch sweep** (kicks, lasers: -300 st/s), a **pulse-width sweep**, and **chords as an arpeggio**:
with `chord arpeggio` above 0, a note carrying a chord (the chord column) plays its notes one after
the other, at that speed, in one voice. OctaMED's own commands (00 arpeggio, 01 / 02 slides, 03
portamento, 04 vibrato, 0C volume) work on it as on any instrument. Any wave goes on any chip: the chip
sets the grid and the grit.

Presets, by chip (`med chip presets`): `2a03-lead` `-lead12` `-square` `-bass` `-arp` `-pluck` `-kick`
`-snare` `-hat` · `dmg-lead` `-lead25` `-sweep` `-wave-bass` `-wave-pad` `-arp` `-snare` `-hat` ·
`sid-pwm-lead` `-pwm-bass` `-saw-bass` `-sync-lead` `-ring-bell` `-arp` `-kick` `-snare` · `ay-square`
`-buzz-saw` `-buzz-tri` `-arp` `-kick` `-snare` `-hat` · `psg-square` `-bass` `-arp` `-pluck` `-snare`
`-hat` · `pce-wave-lead` `-wave-bass` `-organ` `-pluck` `-arp`. The INSTRUMENT screen shows the chip's own.

```
med chip <n|.> new [preset]                   the instrument becomes a chip synth (a free slot: "chip synth")
med chip <n|.> set chip sid · set wave saw · set duty 0.25 · set arp 50 · set sweep -300 …
med chip <n|.> table 0123456789ABCDEFFEDCBA9876543210   its own wavetable (32 digits: 0–F, or 0–V for 5 bits)
med chip <n|.> preset <name> · show · settings · bake
med new --chip                                a chiptune song: pulse 1, pulse 2, triangle, noise (NES-style)
```

## The drum machine

An instrument can be a **kit of twelve drums**, computed as they play (no samples), one a note
of the octave, whatever the octave. Twelve kits (`med drums kits`): classic, punch, tight, lofi,
boom, house, electro, trap, dusty, industrial, tribal, minimal:

```
C  kick      C# rim     D  snare     D# clap      E  closed hat   F  low tom
F# open hat  G  mid tom G# cowbell   A  high tom  A# crash        B  ride
```

Each drum has a **tune**, a **decay**, a **level** and a **tone** (the kick's click, the snare's
snap, the hats' brightness…); the kit can have **grit** (fewer bits, a lower rate). A drum rings
on when its track plays the next note, and a closed hat cuts an open one, like on the machines; a
note off (`^^^`) fades it out quickly.

The INSTRUMENT screen (alt I) shows the kits above and a row a drum: ↑↓ a drum, ←→ a setting,
⇧←→ change it (or ‹ ›, or the wheel); playing a key moves to its drum.

```
med drums <n|.> new [kit]        the instrument becomes a kit (classic punch tight lofi)
med drums <n|.> kit <name>       another kit
med drums <n|.> set <drum> tune|decay|level|tone <value>    e.g. set snare tune 3 · set C# decay 2
med drums <n|.> grit <bits> [hold]    16 = clean · 6 3 = an old sampler
med drums <n|.> show · bake <drum>    the settings · one drum as a sample
```

`.bmed` keeps the kit. In a `.mod` / `.med`, each drum the song plays becomes a sample of its own
in a free instrument slot, and its notes are rewritten to play it.

## The echo

OctaMED's echo on the whole mix: the sound comes back after a length you choose, softer each time
(**depth** 1–6: each repeat at 1/2, 1/4… 1/64 of the last, so 1 rings long and 6 is a short slap);
**cross** bounces it from one side to the other. It's read from OctaMED songs (MMD2 / MMD3 in
mixing mode), kept in `.bmed`, heard in exports; the page's top line shows ECHO and its length.

```
med echo normal 250 2      every 250 ms, half as loud each time
med echo cross 375 3       from side to side
med echo off
```

## How it plays

Loudness: every synth has a **level** setting (dB), and every preset comes matched to the others
(hats a little lower). The tracks are mixed with 6 dB of headroom (four tracks at full volume
reach half scale, eight 1/√8 each), and the mix ends in a limiter at −1 dBFS that only catches the
rare peak: a song never clips, and isn't squashed (0.13.1's mix ran the demo 5 dB into the limiter).
A new song plays every note in the octave written (OctaMED's mixing mode); songs read with the
Amiga's four voices keep their range for samples, never for our synths.

BreakerMED computes its sound itself (every track, every instrument) and streams it to the deck
(`ib.audio.stream`): about 30 ms from a key to the sound, and an export will be exactly what you
hear. The track headers show the names: double-click one to rename it, right-click to mute or solo.

## Commands (OctaMED's numbering)

`med effects` lists them: 00 arpeggio · 01/02 slides · 03 slide to note · 04 vibrato · 05/06 ·
07 tremolo · 09 speed (ProTracker's Fxx below 20) · 0A/0D volume slide · 0B jump · 0C volume
(00–40 hex in a new song) · 0F tempo in BPM and its specials (0FF8 / 0FF9 the LED filter off / on) ·
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

`src/icebreaker.ts` holds the types of ICEBREAKER's module API that BreakerMED uses (the full
API: ICEBREAKER's `src/plugins/api.ts` and docs/PLUGINS.md). The CI checks that `main.js` is
exactly what the sources build.

## Credits and licenses

BreakerMED is our own code, under the MIT license (this repository's). What it reads is public:
the `.mod` format (ProTracker's, documented everywhere) and OctaMED's MMD0 / MMD1 as Teijo
Kinnunen described them in MED-FORM.TXT. For MMD2 / MMD3, the command pages, the tempo modes and
the octave folding of the Amiga's voices, we checked our reader against
[libopenmpt](https://lib.openmpt.org)'s (`soundlib/Load_med.cpp`, BSD-3-Clause, © OpenMPT Devs):
read for reference, not copied. OctaMED's name, code, look and samples aren't used: BreakerMED
works *like* it and reads its files (interoperability), nothing more. The demo song (`med demo`,
`src/demo.ts`) is ours: its samples are computed, its notes written here.
The MP3 / M4A / OGG / Opus exports use the deck's encoder pack (FFmpeg and LAME under the LGPL,
libogg / libvorbis / libopus under BSD-3-Clause, run by ICEBREAKER as a separate program — see
ICEBREAKER's `docs/CREDITS.md`); BreakerMED itself contains none of their code.
