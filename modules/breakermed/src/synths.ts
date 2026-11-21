/**
 * breakerMED — our synths, described once: the command that drives each, the
 * instrument kind, where its settings live, its list of settings and presets.
 * `med synth` / `med fm` and the INSTRUMENT screen work from this, so a new
 * synth is a voice (dsp/), a list of settings and one entry here.
 */
import { ANALOG_PARAMS, ANALOG_PRESETS, analogPreset, sanitizeAnalog } from "./dsp/analog";
import { FM_PARAMS, FM_PRESETS, fmPreset, sanitizeFm } from "./dsp/fm";
import { CHIP_PARAMS, CHIP_PRESETS, chipPreset, chipPresetsFor, sanitizeChip, type ChipParams } from "./dsp/chip";
import type { Param } from "./dsp/params";
import type { Instrument } from "./song";

export interface SynthKind {
  /** `med <cmd> …` */
  cmd: "synth" | "fm" | "chip";
  kind: "analog" | "fm" | "chip";
  /** where the settings live on the instrument */
  field: "synth" | "fm" | "chip";
  /** "an analog synth" */
  what: string;
  /** an example for the first message: "set cutoff 800" */
  example: string;
  params: readonly Param[];
  presets: readonly string[];
  /** the presets the INSTRUMENT screen shows for these settings (all of them when absent) */
  presetsFor?(settings: object): string[];
  preset(name?: string): object;
  sanitize(j: unknown): object;
}

export const SYNTHS: readonly SynthKind[] = [
  { cmd: "synth", kind: "analog", field: "synth", what: "an analog synth", example: "set cutoff 800", params: ANALOG_PARAMS, presets: Object.keys(ANALOG_PRESETS), preset: analogPreset, sanitize: sanitizeAnalog },
  { cmd: "fm", kind: "fm", field: "fm", what: "an FM synth", example: "set index 4", params: FM_PARAMS, presets: Object.keys(FM_PRESETS), preset: fmPreset, sanitize: sanitizeFm },
  {
    cmd: "chip",
    kind: "chip",
    field: "chip",
    what: "a chip synth",
    example: "set chip sid",
    params: CHIP_PARAMS,
    presets: Object.keys(CHIP_PRESETS),
    presetsFor: (p) => chipPresetsFor((p as ChipParams).chip),
    preset: chipPreset,
    sanitize: sanitizeChip,
  },
];

/** the synth an instrument is (or none) */
export const synthOf = (ins: Instrument | undefined) => SYNTHS.find((s) => s.kind === ins?.kind);

/** an instrument's synth settings (or undefined) */
export const settingsOf = (ins: Instrument, sk: SynthKind): object | undefined => (ins as unknown as Record<string, object | undefined>)[sk.field];
export const putSettings = (ins: Instrument, sk: SynthKind, v: object) => ((ins as unknown as Record<string, object>)[sk.field] = v);
