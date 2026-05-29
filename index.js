// Custom entry point: register the react-native-track-player playback service
// BEFORE expo-router boots the app, so lock-screen / notification / headset
// controls are wired up for background audio. `require` (not a hoisted import)
// guarantees the registration runs before expo-router/entry evaluates.
import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './src/services/trackPlayerService';

TrackPlayer.registerPlaybackService(() => PlaybackService);

require('expo-router/entry');
