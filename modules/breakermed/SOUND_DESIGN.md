# BreakerMED — sound design

This page is for musicians. You don't need to know how to code.

## The rule

BreakerMED has two kinds of sound:

- **Computed sounds**: the synths (analog, FM, chip) and the drum machine. Code
  makes them as you play, so no audio file is involved. These are ours already.
- **Sampled sounds**: real recordings, like a piano, a voice or an acoustic drum.
  **People make these: you and your friends, never a machine and never a
  download.** Until someone records a sound, BreakerMED keeps a **placeholder**:
  the sound is on the list below, but it isn't there yet.

Anything you record becomes part of an open-source project. Send only sounds you
made yourself, and say how you'd like to be credited.

## The sounds we want (the starter pack)

Pitched sounds are recorded **on a C**: C-3 is middle C (C4, 261.63 Hz), and C-2
is the C an octave below it. "Loops" means the sound is held and should repeat
smoothly (see *Loops* below).

| File | What | Pitch | Loops |
|---|---|---|---|
| `drums/kick-acoustic.wav` | an acoustic kick drum, one hit | – | |
| `drums/snare-acoustic.wav` | an acoustic snare, one hit, medium | – | |
| `drums/hat-closed.wav` | a closed hi-hat, one hit | – | |
| `drums/hat-open.wav` | an open hi-hat, let ring | – | |
| `drums/ride.wav` | a ride cymbal, one hit | – | |
| `drums/crash.wav` | a crash cymbal, let ring | – | |
| `drums/tom-low.wav` | a floor tom | – | |
| `drums/tom-high.wav` | a rack tom | – | |
| `drums/clap.wav` | real hands clapping, a few people | – | |
| `drums/shaker.wav` | a shaker, one shake | – | |
| `drums/tambourine.wav` | a tambourine, one hit | – | |
| `keys/piano-c3.wav` | an acoustic piano, let ring | C-3 | |
| `keys/epiano-c3.wav` | an electric piano | C-3 | |
| `keys/organ-c3.wav` | an organ, held | C-3 | yes |
| `bass/bass-electric-c2.wav` | an electric bass | C-2 | |
| `bass/bass-upright-c2.wav` | an upright bass, plucked | C-2 | |
| `guitar/guitar-clean-c3.wav` | a clean electric guitar | C-3 | |
| `guitar/guitar-muted-c3.wav` | a palm-muted guitar | C-3 | |
| `strings/strings-c3.wav` | strings (or one violin or cello), held | C-3 | yes |
| `voice/vox-ah-c3.wav` | a voice singing "ah", held | C-3 | yes |
| `voice/vox-oh-c3.wav` | a voice singing "oh", held | C-3 | yes |
| `voice/vox-hey.wav` | a short shout: "hey!" | – | |
| `fx/vinyl-crackle.wav` | vinyl crackle, a texture | – | yes |
| `fx/riser.wav` | a rising sweep, 2–4 s | – | |
| `fx/impact.wav` | a big hit, with its tail | – | |

**Why these:** together they give a first song everything the synths don't: real
drums, a piano, a bass, a guitar, a voice and some texture. The tracker can play
each one on every note, chop it, stretch it and loop it, so one good recording
per instrument is enough.

## The format

- **File**: WAV (`.wav`). AIFF also works.
- **Rate**: 44,100 or 48,000 Hz.
- **Bits**: 16 or 24.
- **Channels**: mono, since BreakerMED pans each track itself. Stereo is fine for
  `fx/` sounds; for everything else BreakerMED mixes stereo down to mono.
- **Length**:
  - one-shots: just the hit and its natural tail, with no silence before the
    attack (trim the start tight), and at most 2 s for drums;
  - held notes (piano, guitar, bass): up to 4 s, let them ring and fade;
  - loops: 2–6 s.
- **Level**: peaks around −1 dBFS, no clipping. Don't add compression or
  limiting, and don't add reverb unless it's part of the sound (a crash's ring
  is fine; a room on a dry kick isn't).
- **Tuning**: pitched sounds sit right on C, checked with a tuner, at A = 440 Hz.

## Loops

For a sound marked "loops", play a steady part that can repeat without a click:
a held vowel, a held organ chord, crackle. Then write down where the loop should
start and end, in samples (most audio editors show this). BreakerMED doesn't read
loop points from the file yet, so we set the loop in BreakerMED with
`med sample <n> loop <start> <length>`. A loop that starts and ends on a zero
crossing, at the same level, sounds smoothest.

## Naming

Use exactly the file names in the table above: lowercase, words joined by `-`,
the note at the end for pitched sounds (`-c3`, `-c2`). To offer an extra sound,
name it the same way in the folder that fits it (`voice/vox-ee-c3.wav`) and tell
us what it is.

## Where to put them

- **To try them yourself**: in your ICEBREAKER vault, in
  `songs/sound-pack/` (BreakerMED may only read `songs/`), keeping the folders: for
  example `songs/sound-pack/keys/piano-c3.wav`.
- **To give them to everyone**: send the files to the project (kiddoko on
  GitHub). They go in `modules/breakermed/sounds/` in this repository, and from
  there into the pack people install.

## How to test

1. Put the file in the vault (see above).
2. In ICEBREAKER's shell, type `med pack`. Your sound gets a ✓; the rest are
   still placeholders.
3. Type `med pack load piano-c3` (your sound's name). It goes into a free
   instrument, and the INSTRUMENT screen shows its waveform.
4. Press the letter keys to play it: Z is C. On the BLOCK screen, a C-3 should
   sound at the pitch you recorded. Try a few octaves up and down.
5. For a loop: `med sample <n> loop <start> <length>`, then hold a note and
   listen for clicks.
6. Play it next to the synths in a song (`med new`). It should sit at about the
   same loudness.

## Keep this page up to date

When a sound is added, removed or renamed, change the table above and the list
in `src/pack.ts`. The two must say the same thing.
