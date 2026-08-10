import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  applyBuiltInOverrides,
  isBuiltInPresetId,
  parseCustomPreset,
  sanitizeParams,
  type AudioPreset,
  type AudioPresetParams,
} from './core';

/**
 * Storage shell for audio presets.
 *
 * The rules themselves live in core.ts, which has no platform imports and is covered
 * by `npm run test:presets`. This file only reads and writes; everything it needs to
 * decide is a pure function imported from there.
 *
 * Presets never cross the bridge by name: the native renderer takes PARAMETERS, so
 * adding a built-in or letting the user define their own needs no native change.
 */

const STORAGE_KEY = '@arsivinyo_audio_presets_custom_v1';
/**
 * Parameter overrides for the BUILT-IN presets, stored apart from the presets
 * themselves so the shipped defaults stay intact and a built-in can always be restored
 * by deleting its override. Editing a built-in never destroys anything.
 */
const BUILTIN_OVERRIDES_KEY = '@arsivinyo_audio_presets_builtin_overrides_v1';

export * from './core';

export async function listCustomPresets(): Promise<AudioPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseCustomPreset).filter((p): p is AudioPreset => p !== null);
  } catch {
    // A corrupted store must not take the preset list down with it.
    return [];
  }
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

/** Built-ins first (with any overrides applied), then user presets. */
export async function listAllPresets(): Promise<AudioPreset[]> {
  const [custom, overrides] = await Promise.all([listCustomPresets(), readBuiltInOverrides()]);
  return [...applyBuiltInOverrides(overrides), ...custom];
}

/** Insert or replace a user preset. Built-in ids are rejected. */
export async function saveCustomPreset(preset: AudioPreset): Promise<AudioPreset[]> {
  if (isBuiltInPresetId(preset.id)) throw new Error('CANNOT_OVERWRITE_BUILT_IN_PRESET');
  const clean = parseCustomPreset({ ...preset, updatedAt: Date.now() });
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
