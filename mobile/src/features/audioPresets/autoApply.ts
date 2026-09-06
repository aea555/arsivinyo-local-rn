import LocalDownloaderModule from '@/src/native/localDownloader';

import {
  configWithoutPreset,
  isValidAutoPresetConfig,
  parseAutoPresetConfig,
  serializeAutoPresetConfig,
  type AutoPresetConfig,
} from './core';
import { listAllPresets } from './presets';

/**
 * Storage shell for the auto-apply configuration.
 *
 * The rules live in core.ts and are covered by `npm run test:presets`; this file only
 * reads and writes.
 *
 * The configuration is stored NATIVELY rather than in AsyncStorage. A download can
 * finish with no JS running at all — the share-sheet capture path starts one without
 * the UI — so the Kotlin completion handler has to be able to read this on its own.
 * Preset definitions still live on this side; they are flattened into a blob the native
 * side only replays.
 */

export {
  DEFAULT_AUTO_PRESET_CONFIG,
  isValidAutoPresetConfig,
  outputsPerDownload,
  type AutoPresetConfig,
} from './core';

export async function getAutoPresetConfig(): Promise<AutoPresetConfig> {
  try {
    const { config } = await LocalDownloaderModule.getAutoPresetConfig();
    return parseAutoPresetConfig(config);
  } catch {
    return parseAutoPresetConfig(null);
  }
}

/**
 * Persist the configuration, resolving each preset id to the parameters native needs.
 *
 * Params are flattened at save time rather than at download time, so the native side
 * never has to know what a preset is. Editing a preset therefore does not retroactively
 * change what downloads produce until this is saved again, which is the predictable
 * behaviour.
 */
export async function saveAutoPresetConfig(config: AutoPresetConfig): Promise<AutoPresetConfig> {
  const all = await listAllPresets();
  const payload = serializeAutoPresetConfig(config, all);
  await LocalDownloaderModule.setAutoPresetConfig({ config: JSON.stringify(payload) });
  return {
    keepOriginal: payload.keepOriginal,
    presetIds: payload.presets.map((p) => p.id),
  };
}

/**
 * Drop a preset from the auto-apply set, for use when that preset is deleted.
 *
 * Without this the stored native config would keep replaying a preset that no longer
 * exists: the spec was flattened at save time, so it would keep producing renders under
 * a name the user cannot see or edit.
 */
export async function removePresetFromAutoApply(presetId: string): Promise<AutoPresetConfig> {
  const current = await getAutoPresetConfig();
  if (!current.presetIds.includes(presetId)) return current;
  return saveAutoPresetConfig(configWithoutPreset(current, presetId));
}

/** Re-export so callers do not need to reach into core for a validity check. */
export { configWithoutPreset, isValidAutoPresetConfig as isValidConfig };
