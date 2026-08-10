import LocalDownloaderModule from '@/src/native/localDownloader';

import { buildParamsSpec, listAllPresets, type AudioPreset } from './presets';

/**
 * Which presets are applied automatically to a new audio download.
 *
 * One download can therefore produce several library entries: the original plus one
 * render per selected preset.
 *
 * The configuration is stored NATIVELY rather than in AsyncStorage. A download can
 * finish with no JS running at all — the share-sheet capture path starts one without
 * the UI — so the Kotlin completion handler has to be able to read this on its own.
 * Preset definitions still live here; this module flattens them into a blob that the
 * native side only replays.
 */
export interface AutoPresetConfig {
  /** Keep the downloaded track itself. False renders only the preset versions. */
  keepOriginal: boolean;
  /** Ids of the presets to apply. May be empty when only the original is wanted. */
  presetIds: string[];
}

export const DEFAULT_AUTO_PRESET_CONFIG: AutoPresetConfig = {
  keepOriginal: true,
  presetIds: [],
};

/**
 * A configuration selecting nothing at all would discard the download outright, so it
 * is not a legal state. Anything that would resolve to "keep nothing" falls back to
 * keeping the original.
 */
export function isValidAutoPresetConfig(config: AutoPresetConfig): boolean {
  return config.keepOriginal || config.presetIds.length > 0;
}

export async function getAutoPresetConfig(): Promise<AutoPresetConfig> {
  try {
    const { config } = await LocalDownloaderModule.getAutoPresetConfig();
    if (!config) return DEFAULT_AUTO_PRESET_CONFIG;
    const parsed = JSON.parse(config);
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

/**
 * Persist the configuration, resolving each preset id to the parameters native needs.
 *
 * The params are flattened at save time rather than at download time so the native side
 * never has to know what a preset is — it replays a list of specs. Editing a preset
 * later therefore does not retroactively change what downloads produce until this is
 * saved again, which is the predictable behaviour.
 */
export async function saveAutoPresetConfig(config: AutoPresetConfig): Promise<AutoPresetConfig> {
  const safe = isValidAutoPresetConfig(config) ? config : DEFAULT_AUTO_PRESET_CONFIG;
  const all = await listAllPresets();
  const byId = new Map(all.map((p) => [p.id, p]));

  const presets = safe.presetIds
    .map((id) => byId.get(id))
    .filter((p): p is AudioPreset => p !== undefined)
    .map((preset) => ({
      id: preset.id,
      paramsSpec: buildParamsSpec(preset.params),
      titleSuffix: preset.titleSuffix,
    }));

  await LocalDownloaderModule.setAutoPresetConfig({
    config: JSON.stringify({ keepOriginal: safe.keepOriginal, presets }),
  });
  return { keepOriginal: safe.keepOriginal, presetIds: presets.map((p) => p.id) };
}

/** Number of library entries one download will produce under this configuration. */
export function outputsPerDownload(config: AutoPresetConfig): number {
  return (config.keepOriginal ? 1 : 0) + config.presetIds.length;
}
