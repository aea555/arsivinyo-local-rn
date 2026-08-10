import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Audio preset definitions and storage.
 *
 * Presets live entirely on this side. The native renderer takes PARAMETERS, never a
 * preset id or name, so adding a built-in or letting the user define their own needs
 * no native change at all — the whole preset concept is a TypeScript concern that gets
 * flattened into a `key=value;` spec at the moment of rendering.
 */

const STORAGE_KEY = '@arsivinyo_audio_presets_custom_v1';
/**
 * Per-preset parameter overrides for the BUILT-IN presets.
 *
 * Kept separate from the presets themselves so the shipped defaults stay intact and a
 * built-in can always be restored by deleting its override. Editing a built-in never
 * destroys anything.
 */
const BUILTIN_OVERRIDES_KEY = '@arsivinyo_audio_presets_builtin_overrides_v1';

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

export async function listCustomPresets(): Promise<AudioPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizePreset).filter((p): p is AudioPreset => p !== null);
  } catch {
    // A corrupted store must not take the preset list down with it.
    return [];
  }
}

/**
 * Built-ins first (with any user overrides applied), then user presets.
 *
 * A built-in whose parameters have been changed is flagged `modified`, which is what
 * lets the UI offer to restore it.
 */
export async function listAllPresets(): Promise<AudioPreset[]> {
  const [custom, overrides] = await Promise.all([listCustomPresets(), readBuiltInOverrides()]);
  const builtIns = BUILT_IN_PRESETS.map((preset) => {
    const override = overrides[preset.id];
    if (!override) return { ...preset, modified: false };
    return { ...preset, params: override, modified: true };
  });
  return [...builtIns, ...custom];
}

/** Insert or replace a user preset. Built-in ids are rejected. */
export async function saveCustomPreset(preset: AudioPreset): Promise<AudioPreset[]> {
  if (BUILT_IN_PRESETS.some((p) => p.id === preset.id)) {
    throw new Error('CANNOT_OVERWRITE_BUILT_IN_PRESET');
  }
  const clean = sanitizePreset({ ...preset, updatedAt: Date.now() });
  if (!clean) throw new Error('INVALID_PRESET');

  const existing = await listCustomPresets();
  const index = existing.findIndex((p) => p.id === clean.id);
  const next = index >= 0
    ? existing.map((p, i) => (i === index ? { ...clean, createdAt: p.createdAt } : p))
    : [...existing, clean];

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function deleteCustomPreset(id: string): Promise<AudioPreset[]> {
  const next = (await listCustomPresets()).filter((p) => p.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function isBuiltInPresetId(id: string): boolean {
  return BUILT_IN_PRESETS.some((p) => p.id === id);
}

async function readBuiltInOverrides(): Promise<Record<string, AudioPresetParams>> {
  try {
    const raw = await AsyncStorage.getItem(BUILTIN_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, AudioPresetParams> = {};
    for (const [id, params] of Object.entries(parsed)) {
      if (isBuiltInPresetId(id)) out[id] = sanitizeParams(params as Partial<AudioPresetParams>);
    }
    return out;
  } catch {
    return {};
  }
}

/** Override a built-in's parameters. The shipped defaults are left untouched. */
export async function saveBuiltInParams(id: string, params: AudioPresetParams): Promise<void> {
  if (!isBuiltInPresetId(id)) throw new Error('NOT_A_BUILT_IN_PRESET');
  const overrides = await readBuiltInOverrides();
  overrides[id] = sanitizeParams(params);
  await AsyncStorage.setItem(BUILTIN_OVERRIDES_KEY, JSON.stringify(overrides));
}

/** Drop a built-in's override, returning it to the values it shipped with. */
export async function resetBuiltInPreset(id: string): Promise<void> {
  const overrides = await readBuiltInOverrides();
  delete overrides[id];
  await AsyncStorage.setItem(BUILTIN_OVERRIDES_KEY, JSON.stringify(overrides));
}

/** Create a user preset. The name also forms the suffix added to rendered titles. */
export async function createCustomPreset(
  name: string,
  params: AudioPresetParams
): Promise<AudioPreset> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('INVALID_PRESET_NAME');
  const preset: AudioPreset = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    builtIn: false,
    titleSuffix: ` (${trimmed})`,
    params: sanitizeParams(params),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveCustomPreset(preset);
  return preset;
}

/** Rename a user preset. The title suffix follows the name so renders stay consistent. */
export async function renameCustomPreset(id: string, name: string): Promise<AudioPreset[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('INVALID_PRESET_NAME');
  const existing = await listCustomPresets();
  const target = existing.find((p) => p.id === id);
  if (!target) throw new Error('PRESET_NOT_FOUND');
  return saveCustomPreset({ ...target, name: trimmed, titleSuffix: ` (${trimmed})` });
}

/** Update a user preset's parameters, leaving its name alone. */
export async function updateCustomPresetParams(
  id: string,
  params: AudioPresetParams
): Promise<AudioPreset[]> {
  const existing = await listCustomPresets();
  const target = existing.find((p) => p.id === id);
  if (!target) throw new Error('PRESET_NOT_FOUND');
  return saveCustomPreset({ ...target, params: sanitizeParams(params) });
}

/**
 * Persist a change to any preset, routing to the right store.
 *
 * Lets the editing UI treat built-ins and user presets identically: it edits params and
 * saves, and this decides whether that means an override or a stored preset.
 */
export async function savePresetParams(preset: AudioPreset, params: AudioPresetParams): Promise<void> {
  if (preset.builtIn) {
    await saveBuiltInParams(preset.id, params);
  } else {
    await updateCustomPresetParams(preset.id, params);
  }
}
