import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  type Track,
} from 'react-native-track-player';
import type { LocalSound } from '../api';

let setupPromise: Promise<void> | null = null;

/**
 * Idempotent player setup. Safe to call from multiple screens — the work runs
 * once. Configures the foreground service capabilities so lock-screen /
 * notification transport controls and headset buttons work, and keeps playback
 * alive in the background.
 */
export async function setupTrackPlayer(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    } catch {
      // setupPlayer throws if it was already initialized — ignore and continue.
    }
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      // RNTP 5.x renamed `compactCapabilities` → `notificationCapabilities`.
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      progressUpdateEventInterval: 1,
    });
  })();
  return setupPromise;
}

export function soundToTrack(song: LocalSound): Track {
  return {
    id: song.id,
    url: song.contentUri,
    title: song.title,
    artist: song.artist ?? undefined,
    artwork: song.thumbnailPath ? `file://${song.thumbnailPath}` : undefined,
    duration: song.durationSec,
  };
}

/** Replace the queue with `songs` and start playing from `startIndex`. */
export async function playSongs(songs: LocalSound[], startIndex: number): Promise<void> {
  if (songs.length === 0) return;
  await setupTrackPlayer();
  await TrackPlayer.reset();
  await TrackPlayer.add(songs.map(soundToTrack));
  const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
  if (safeIndex > 0) {
    await TrackPlayer.skip(safeIndex);
  }
  await TrackPlayer.play();
}

export async function seekBy(deltaSeconds: number): Promise<void> {
  const { position, duration } = await TrackPlayer.getProgress();
  const target = Math.max(0, Math.min(position + deltaSeconds, duration || position + deltaSeconds));
  await TrackPlayer.seekTo(target);
}

// "Previous" behaves like most music apps: a single press restarts the current
// track; a quick double press jumps to the previous track (if there is one). The
// state is module-level so the in-app control and the lock-screen / notification
// RemotePrevious event share one tap-counter and behave identically. (RNTP's
// playback service runs in the same JS runtime as the UI, so this is shared.)
let prevTapTimer: ReturnType<typeof setTimeout> | null = null;
const PREV_DOUBLE_TAP_MS = 350;

export async function handlePrevious(): Promise<void> {
  if (prevTapTimer) {
    // Second tap within the window → go to the previous track if one exists.
    clearTimeout(prevTapTimer);
    prevTapTimer = null;
    try {
      const index = await TrackPlayer.getActiveTrackIndex();
      if (typeof index === 'number' && index > 0) {
        await TrackPlayer.skipToPrevious();
      } else {
        await TrackPlayer.seekTo(0);
      }
    } catch {
      // ignore
    }
    return;
  }
  // First tap → wait briefly; if no second tap arrives, restart the current track.
  prevTapTimer = setTimeout(() => {
    prevTapTimer = null;
    TrackPlayer.seekTo(0).catch(() => undefined);
  }, PREV_DOUBLE_TAP_MS);
}

export async function cycleRepeatMode(current: RepeatMode): Promise<RepeatMode> {
  const next =
    current === RepeatMode.Off
      ? RepeatMode.Queue
      : current === RepeatMode.Queue
        ? RepeatMode.Track
        : RepeatMode.Off;
  await TrackPlayer.setRepeatMode(next);
  return next;
}

/**
 * Headless playback service. Registered at the app entry point (index.js) and
 * run by react-native-track-player's foreground service to handle remote
 * controls from the lock screen / notification / headset buttons.
 */
export async function PlaybackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => handlePrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => TrackPlayer.seekTo(event.position));
  TrackPlayer.addEventListener(Event.RemoteJumpForward, (event) => seekBy(event.interval ?? 10));
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, (event) => seekBy(-(event.interval ?? 10)));
}
