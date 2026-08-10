/**
 * Pure preset logic: parameters, ranges, the shipped presets, and the rules that turn
 * them into what the native renderer consumes.
 *
 * Deliberately free of any React Native or storage import so it can be exercised
 * directly by `node --test`. The same split the C++ side uses — a pure core with the
 * behaviour in it, and a thin shell around it that deals with the platform. See
 * presets.ts and autoApply.ts for the storage shells.
 */

/**
 * Parameters accepted by the native DSP chain.
 *
 * Mirrors `PresetParams` in preset_params.h. The native side re-validates and clamps
 * everything it receives, so a bad value here can never destabilise the DSP — but
 * keeping the ranges in [PARAM_RANGES] aligned means the UI never offers a value that
 * would be silently altered.
 */
export interface AudioPresetParams {
  /**
   * Playback rate. Pure resampling with no pitch correction, so tempo and pitch move
   * together — that is what makes "slowed" sound slowed rather than time-stretched.
   */
  rate: number;
  reverbMix: number;
  reverbRoom: number;
  reverbDamp: number;
  reverbWidth: number;
  reverbPreDelayMs: number;
  bassGainDb: number;
  bassFreqHz: number;
  trebleGainDb: number;
  trebleFreqHz: number;
  outputGainDb: number;
  limiterEnabled: boolean;
  limiterCeilingDb: number;
}

export interface AudioPreset {
  id: string;
  /** Display name. Built-ins are localised at render time via `nameKey`. */
  name: string;
  /** i18n key for built-ins; absent for user-created presets. */
  nameKey?: string;
  builtIn: boolean;
  /** Appended to the source title, e.g. " (Slowed + Reverb)". */
  titleSuffix: string;
  params: AudioPresetParams;
  /**
   * True when a built-in's parameters have been changed from the shipped defaults.
   * Always false for user presets, which have no defaults to differ from.
   */
  modified?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/** Inert defaults. A preset only has to state what it actually changes. */
export const DEFAULT_PARAMS: AudioPresetParams = {
  rate: 1,
  reverbMix: 0,
  reverbRoom: 0.5,
  reverbDamp: 0.5,
  reverbWidth: 1,
  reverbPreDelayMs: 0,
  bassGainDb: 0,
  bassFreqHz: 100,
  trebleGainDb: 0,
  trebleFreqHz: 6000,
  outputGainDb: 0,
  limiterEnabled: true,
  limiterCeilingDb: -0.3,
};

/**
 * Editable range of each parameter, for sliders and for validation.
 *
 * These MUST stay in step with `PresetParams::Clamp()` in preset_params.cpp. Native
 * clamps to the same bounds, so a mismatch would show up as a slider whose top end
 * silently does nothing.
 */
export const PARAM_RANGES: Record<
  Exclude<keyof AudioPresetParams, 'limiterEnabled'>,
  { min: number; max: number; step: number }
> = {
  rate: { min: 0.5, max: 2, step: 0.01 },
  reverbMix: { min: 0, max: 1, step: 0.01 },
  reverbRoom: { min: 0, max: 0.97, step: 0.01 },
  reverbDamp: { min: 0, max: 1, step: 0.01 },
  reverbWidth: { min: 0, max: 1, step: 0.01 },
  reverbPreDelayMs: { min: 0, max: 200, step: 1 },
  bassGainDb: { min: -24, max: 24, step: 0.5 },
  bassFreqHz: { min: 20, max: 1000, step: 5 },
  trebleGainDb: { min: -24, max: 24, step: 0.5 },
  trebleFreqHz: { min: 1000, max: 16000, step: 100 },
  outputGainDb: { min: -24, max: 24, step: 0.5 },
  limiterCeilingDb: { min: -12, max: 0, step: 0.1 },
};

/**
 * The presets that ship with the app.
 *
 * Frozen so a screen cannot mutate a shared object by accident. Editing a built-in
 * writes an override to a separate store instead (see [saveBuiltInParams]), which is
 * what makes [resetBuiltInPreset] able to restore these exact values at any point.
 */
export const BUILT_IN_PRESETS: readonly AudioPreset[] = Object.freeze([
  Object.freeze({
    id: 'slowed-reverb',
    name: 'Slowed + Reverb',
    nameKey: 'sounds.presets.slowedReverb',
    builtIn: true,
    titleSuffix: ' (Slowed + Reverb)',
    params: Object.freeze({
      ...DEFAULT_PARAMS,
      rate: 0.85,
      reverbMix: 0.28,
      reverbRoom: 0.72,
      reverbDamp: 0.42,
      reverbWidth: 1,
      reverbPreDelayMs: 20,
      // A touch of low end back: slowing already lowers the spectrum, and the reverb
      // thins the body slightly.
      bassGainDb: 2,
      bassFreqHz: 120,
    }) as AudioPresetParams,
  }),
  Object.freeze({
    id: 'nightcore',
    name: 'Nightcore',
    nameKey: 'sounds.presets.nightcore',
    builtIn: true,
    titleSuffix: ' (Nightcore)',
    params: Object.freeze({
      ...DEFAULT_PARAMS,
      rate: 1.25,
      reverbMix: 0.06,
      reverbRoom: 0.4,
      reverbDamp: 0.5,
      trebleGainDb: 1.5,
    }) as AudioPresetParams,
  }),
  Object.freeze({
    id: 'bass-boost',
    name: 'Bass Boost',
    nameKey: 'sounds.presets.bassBoost',
    builtIn: true,
    titleSuffix: ' (Bass Boost)',
    params: Object.freeze({
      ...DEFAULT_PARAMS,
      bassGainDb: 6,
      bassFreqHz: 90,
      // Trim the output so the boost has somewhere to go before the limiter engages.
      outputGainDb: -1,
    }) as AudioPresetParams,
  }),
]) as readonly AudioPreset[];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerce arbitrary input into valid params, falling back per-field. */
export function sanitizeParams(input: Partial<AudioPresetParams> | undefined): AudioPresetParams {
  const source = input ?? {};
  const out = { ...DEFAULT_PARAMS };
  (Object.keys(PARAM_RANGES) as (keyof typeof PARAM_RANGES)[]).forEach((key) => {
    const range = PARAM_RANGES[key];
    out[key] = clampNumber(source[key], range.min, range.max, DEFAULT_PARAMS[key]);
  });
  out.limiterEnabled = typeof source.limiterEnabled === 'boolean'
    ? source.limiterEnabled
    : DEFAULT_PARAMS.limiterEnabled;
  return out;
}

/**
 * Flatten params into the `key=value;` spec the native side parses.
 *
 * Only non-default values are emitted. The native parser ignores unknown keys and
 * keeps its own defaults for absent ones, so a shorter spec is both smaller and more
 * forgiving across versions.
 */
export function buildParamsSpec(params: AudioPresetParams): string {
  const clean = sanitizeParams(params);
  const parts: string[] = [];
  (Object.keys(PARAM_RANGES) as (keyof typeof PARAM_RANGES)[]).forEach((key) => {
    if (clean[key] !== DEFAULT_PARAMS[key]) parts.push(`${key}=${clean[key]}`);
  });
  if (clean.limiterEnabled !== DEFAULT_PARAMS.limiterEnabled) {
    parts.push(`limiterEnabled=${clean.limiterEnabled ? 'true' : 'false'}`);
  }
  return parts.join(';');
}

function sanitizePreset(value: unknown): AudioPreset | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<AudioPreset>;
  const id = typeof v.id === 'string' ? v.id.trim() : '';
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    builtIn: false,
    titleSuffix: typeof v.titleSuffix === 'string' && v.titleSuffix.length > 0
      ? v.titleSuffix
      : ` (${name})`,
    params: sanitizeParams(v.params),
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Merge rules
// ---------------------------------------------------------------------------

export function isBuiltInPresetId(id: string): boolean {
  return BUILT_IN_PRESETS.some((p) => p.id === id);
}

/** Parse arbitrary stored input into a user preset, or null when unusable. */
export function parseCustomPreset(value: unknown): AudioPreset | null {
  return sanitizePreset(value);
}

/**
 * Apply stored overrides to the shipped presets.
 *
 * A built-in whose parameters differ from the shipped values is flagged `modified`,
 * which is what lets the UI offer to restore it. Overrides for unknown ids are ignored
 * so a stale record cannot invent a preset.
 */
export function applyBuiltInOverrides(
  overrides: Record<string, AudioPresetParams>
): AudioPreset[] {
  return BUILT_IN_PRESETS.map((preset) => {
    const override = overrides[preset.id];
    if (!override) return { ...preset, modified: false };
    return { ...preset, params: override, modified: true };
  });
}

// ---------------------------------------------------------------------------
// Auto-apply rules
// ---------------------------------------------------------------------------

/** Which presets are applied automatically to a new audio download. */
export interface AutoPresetConfig {
  keepOriginal: boolean;
  presetIds: string[];
}

export const DEFAULT_AUTO_PRESET_CONFIG: AutoPresetConfig = {
  keepOriginal: true,
  presetIds: [],
};

/**
 * A configuration selecting nothing would discard the download outright, so it is not
 * a legal state.
 */
export function isValidAutoPresetConfig(config: AutoPresetConfig): boolean {
  return config.keepOriginal || config.presetIds.length > 0;
}

/** Number of library entries one download produces under this configuration. */
export function outputsPerDownload(config: AutoPresetConfig): number {
  return (config.keepOriginal ? 1 : 0) + config.presetIds.length;
}

/**
 * Remove a preset from the auto-apply set.
 *
 * If that would leave nothing selected the original is kept instead, since a
 * configuration selecting nothing would throw the download away.
 */
export function configWithoutPreset(config: AutoPresetConfig, presetId: string): AutoPresetConfig {
  const next: AutoPresetConfig = {
    keepOriginal: config.keepOriginal,
    presetIds: config.presetIds.filter((id) => id !== presetId),
  };
  if (!isValidAutoPresetConfig(next)) next.keepOriginal = true;
  return next;
}

/**
 * Flatten a configuration into the blob the native side stores and replays.
 *
 * Unknown ids are dropped: a preset the user deleted must not keep producing renders
 * under a name they can no longer see.
 */
export function serializeAutoPresetConfig(
  config: AutoPresetConfig,
  presets: AudioPreset[]
): { keepOriginal: boolean; presets: { id: string; paramsSpec: string; titleSuffix: string }[] } {
  const safe = isValidAutoPresetConfig(config) ? config : DEFAULT_AUTO_PRESET_CONFIG;
  const byId = new Map(presets.map((p) => [p.id, p]));
  return {
    keepOriginal: safe.keepOriginal,
    presets: safe.presetIds
      .map((id) => byId.get(id))
      .filter((p): p is AudioPreset => p !== undefined)
      .map((preset) => ({
        id: preset.id,
        paramsSpec: buildParamsSpec(preset.params),
        titleSuffix: preset.titleSuffix,
      })),
  };
}

/** Read back a stored blob, falling back to the default on anything unusable. */
export function parseAutoPresetConfig(raw: string | null | undefined): AutoPresetConfig {
  if (!raw) return DEFAULT_AUTO_PRESET_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    const presets = Array.isArray(parsed?.presets) ? parsed.presets : [];
    const resolved: AutoPresetConfig = {
      keepOriginal: parsed?.keepOriginal !== false,
      presetIds: presets
        .map((p: unknown) => (p as { id?: unknown })?.id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
    };
    return isValidAutoPresetConfig(resolved) ? resolved : DEFAULT_AUTO_PRESET_CONFIG;
  } catch {
    return DEFAULT_AUTO_PRESET_CONFIG;
  }
}
