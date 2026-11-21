# BreakerMED (beta)

A tracker for ICEBREAKER that works like **OctaMED** and **ProTracker**: blocks of tracks, one
line a step, each cell a note, an instrument and hex commands; a play sequence makes the song.
It reads **.med** (MMD0–MMD3) and **.mod** files. In ASCII, in your theme's colours, with the
keyboard, the mouse and a gamepad.

> Work in progress: reading, playing, editing, saving, exporting, the sampler, the analog and FM
> synths, the drum machine, chords and OctaMED's echo are here (8 tracks by default, 16 at most,
> named), and exports to WAV, AIFF, FLAC — and MP3, M4A, OGG, Opus through the deck's encoder pack.
> breakerMED is our own code: it works *like* OctaMED and reads its files, it isn't OctaMED
> (no code, name, look or samples of it). Credits: below.

## What it needs

- **`audio`**: it plays its sound through the deck's sampler (`ib.audio`).
- **`vault:read`**: it reads your songs from the vault (`.bmed`, `.med`, `.mod`, `mod.xxx`).
- **`vault:write`**: it saves your songs in the vault (`med save`).
- Nothing online, no account, no AI. ICEBREAKER 0.5.4 or later (`ib.audio` and pages that play the
  keyboard; on an older deck it says so and stays off); MP3 / M4A / OGG / Opus exports need 0.5.5 and
  the encoder pack (below).

> **Beta.** Everything below works and was tested on macOS and Windows; it may still have rough
> edges. Tell us what breaks (the deck's Issues on GitHub).

## The page

Four screens on the right, by their tabs or **alt B / I / S / E**:

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
⌘Z · ⌘⇧Z     undo · redo (500 steps): notes, blocks, instruments, the song's settings
             (tempo, swing, echo…), mutes; a setting nudged step by step is one undo
alt B I S E  the screens: BLOCK · INSTRUMENT · SONG · EXPORT
chord column    one digit, 1–F (when the song has chords: see Chords)
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
med new [tracks] [--empty]  a new song from the template: 8 named tracks (up to 16), drums, synths, a bar
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
med chord <line> <track> <0–F> · med chords …   (see Chords)
med echo off | normal|cross [ms] [depth]       (see The echo)
med sample … · med bounce · med filter           (see The sampler)
med synth … · med fm … · med drums …             (see the synths, the drum machine)
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
something at once. `med new 12` gives 12 tracks; `med new --empty` a blank page with the demo's samples.

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

One instrument, the sound chips of old consoles and home computers, a mode a chip. Everything is
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
of the octave, whatever the octave:

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
The MP3 / M4A / OGG / Opus exports use the deck's encoder pack (FFmpeg and LAME under the LGPL,
libogg / libvorbis / libopus under BSD-3-Clause, run by ICEBREAKER as a separate program — see
ICEBREAKER's `docs/CREDITS.md`); breakerMED itself contains none of their code.
