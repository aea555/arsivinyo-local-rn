import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  type Track,
} from 'react-native-track-player';
import type { LocalSound, LocalSoundPlaylist } from '../api';

let setupPromise: Promise<void> | null = null;
// What the current RNTP queue was built from: 'all' (the Songs view) or a playlist id.
// Used to decide whether a newly-added library song belongs in the live queue.
let queueContextId: string | null = null;

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

/**
 * Replace the queue with `songs` and start playing from `startIndex`. `contextId`
 * records where the queue came from ('all' for the Songs view, or a playlist id) so
 * later imports/downloads can be appended to the right queue.
 */
export async function playSongs(songs: LocalSound[], startIndex: number, contextId = 'all'): Promise<void> {
  if (songs.length === 0) return;
  await setupTrackPlayer();
  await TrackPlayer.reset();
  await TrackPlayer.add(songs.map(soundToTrack));
  const safeIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
  if (safeIndex > 0) {
    await TrackPlayer.skip(safeIndex);
  }
  queueContextId = contextId;
  await TrackPlayer.play();
}

// Library song ids seen on the previous reconcile. Module-level so it survives the
// library screen unmounting/remounting (so a song downloaded while the screen was
// away is still recognized as new on return).
let knownSongIds: Set<string> | null = null;

/**
 * Called after the library reloads. Appends songs added since the last reconcile (an
 * import or download) to the active RNTP queue, so the player's prev/next can reach
 * them without an app restart — the queue is otherwise a snapshot from when playback
 * started. Only songs belonging to the queue's context are added: in 'all' any new
 * song qualifies; in a playlist only ones now in that playlist. The first call just
 * records the baseline (nothing is "new" yet).
 */
export async function reconcileQueueAfterReload(
  allSongs: LocalSound[],
  allPlaylists: LocalSoundPlaylist[]
): Promise<void> {
  const firstRun = knownSongIds == null;
  const newSongs = firstRun ? [] : allSongs.filter((s) => !knownSongIds!.has(s.id));
  knownSongIds = new Set(allSongs.map((s) => s.id));
  if (newSongs.length === 0 || queueContextId == null) return;
  try {
    const queue = await TrackPlayer.getQueue();
    if (queue.length === 0) return; // nothing playing; the next playSongs builds fresh
    const have = new Set(queue.map((t) => String(t.id)));
    let candidates = newSongs.filter((s) => !have.has(s.id));
    if (queueContextId !== 'all') {
      const pl = allPlaylists.find((p) => p.id === queueContextId);
      if (!pl) return;
      const inPlaylist = new Set(pl.songIds);
      candidates = candidates.filter((s) => inPlaylist.has(s.id));
    }
    if (candidates.length > 0) await TrackPlayer.add(candidates.map(soundToTrack));
  } catch {
    // best-effort; the next full playSongs rebuilds the queue anyway
  }
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
