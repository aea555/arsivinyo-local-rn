import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TrackPlayer, { State, useActiveTrack, usePlaybackState } from 'react-native-track-player';

import {
  addLocalSoundsToPlaylists,
  createLocalSoundPlaylist,
  deleteLocalSoundPlaylist,
  deleteLocalSounds,
  FAVORITES_PLAYLIST_ID,
  importLocalSounds,
  isLocalSoundsSupported,
  listLocalSoundPlaylists,
  listLocalSounds,
  removeLocalSoundsFromPlaylist,
  renameLocalSoundPlaylist,
  setLocalSoundsFavorite,
  type LocalSound,
  type LocalSoundPlaylist,
} from '@/src/api';
import { AppText as Text } from '@/src/components';
import { playSongs, setupTrackPlayer } from '@/src/services/trackPlayerService';
import { useTheme } from '@/src/theme';

type SortMode = 'newest' | 'oldest' | 'titleAsc' | 'titleDesc' | 'durationDesc' | 'durationAsc';
type Tab = 'songs' | 'playlists';

type PendingAction =
  | { type: 'deleteSingle'; song: LocalSound }
  | { type: 'deleteBatch'; ids: string[] }
  | { type: 'removeFromPlaylist'; playlist: LocalSoundPlaylist; ids: string[] }
  | { type: 'deletePlaylist'; playlist: LocalSoundPlaylist }
  | null;

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function normalize(text: string): string {
  return text.trim().toLocaleLowerCase();
}

export default function SoundsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  const supported = useMemo(() => isLocalSoundsSupported(), []);

  // The currently-playing track (its id matches a song id) gets an accent outline.
  const activeTrack = useActiveTrack();
  const activeTrackId = activeTrack?.id != null ? String(activeTrack.id) : null;

  const [loading, setLoading] = useState(true);
  const [songs, setSongs] = useState<LocalSound[]>([]);
  const [playlists, setPlaylists] = useState<LocalSoundPlaylist[]>([]);

  const [tab, setTab] = useState<Tab>('songs');
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const [renameTarget, setRenameTarget] = useState<LocalSoundPlaylist | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [playlistPickerTarget, setPlaylistPickerTarget] = useState<{ ids: string[]; title?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2200);
  }, []);

  const reload = useCallback(async () => {
    if (!supported) {
      setLoading(false);
      return;
    }
    try {
      const [library, pls] = await Promise.all([listLocalSounds(), listLocalSoundPlaylists()]);
      setSongs(library.songs);
      setPlaylists(library.playlists.length ? library.playlists : pls);
    } catch {
      showToast(t('sounds.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [supported, showToast, t]);

  useEffect(() => {
    setupTrackPlayer().catch(() => undefined);
  }, []);

  // Refresh on every focus so changes made elsewhere (favoriting from the player,
  // downloads finishing) are reflected when the user returns to the library.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const activePlaylist = useMemo(
    () => (openPlaylistId ? playlists.find((p) => p.id === openPlaylistId) ?? null : null),
    [openPlaylistId, playlists]
  );

  // Favorites (the special system playlist) pinned to the top of the playlists list.
  const sortedPlaylists = useMemo(
    () => [...playlists].sort((a, b) => (b.system ? 1 : 0) - (a.system ? 1 : 0)),
    [playlists]
  );
  const favoriteIdSet = useMemo(() => {
    const sys = playlists.find((p) => p.system || p.id === FAVORITES_PLAYLIST_ID);
    return new Set(sys?.songIds ?? []);
  }, [playlists]);
  const playlistDisplayName = useCallback(
    (p: LocalSoundPlaylist) => (p.system ? t('sounds.favorites') : p.name),
    [t]
  );

  // We render the song list when on the Songs tab, or when a playlist is open.
  const showingSongs = tab === 'songs' || activePlaylist != null;

  const visibleSongs = useMemo(() => {
    const byId = new Map(songs.map((s) => [s.id, s]));
    let work: LocalSound[];
    if (activePlaylist) {
      work = activePlaylist.songIds.map((id) => byId.get(id)).filter((s): s is LocalSound => Boolean(s));
    } else {
      work = [...songs];
    }
    const q = normalize(query);
    if (q) {
      work = work.filter((s) => normalize(s.title).includes(q) || normalize(s.artist ?? '').includes(q));
    }
    const sorted = [...work];
    switch (sortMode) {
      case 'oldest':
        sorted.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'titleAsc':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'titleDesc':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'durationDesc':
        sorted.sort((a, b) => b.durationSec - a.durationSec);
        break;
      case 'durationAsc':
        sorted.sort((a, b) => a.durationSec - b.durationSec);
        break;
      case 'newest':
      default:
        sorted.sort((a, b) => b.createdAt - a.createdAt);
        break;
    }
    return sorted;
  }, [songs, activePlaylist, query, sortMode]);

  // ---- selection ----
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const enterSelectionFor = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(visibleSongs.map((s) => s.id)));
  }, [visibleSongs]);

  // ---- navigation ----
  const switchTab = useCallback(
    (next: Tab) => {
      exitSelection();
      setTab(next);
    },
    [exitSelection]
  );

  const openPlaylist = useCallback(
    (id: string) => {
      exitSelection();
      setOpenPlaylistId(id);
    },
    [exitSelection]
  );

  const closePlaylist = useCallback(() => {
    exitSelection();
    setOpenPlaylistId(null);
  }, [exitSelection]);

  const onHeaderBack = useCallback(() => {
    if (activePlaylist) closePlaylist();
    else router.back();
  }, [activePlaylist, closePlaylist, router]);

  // Android hardware / gesture back: inside a playlist, return to the library (not the
  // app home); in selection mode, exit selection first. Otherwise let it pop the route.
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (openPlaylistId != null) {
          closePlaylist();
          return true;
        }
        if (selectionMode) {
          exitSelection();
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [openPlaylistId, selectionMode, closePlaylist, exitSelection])
  );

  // ---- playback ----
  const playFrom = useCallback(
    async (index: number) => {
      try {
        // Just start playback. The full player opens via the mini-player or the
        // notification, not by tapping a song row.
        await playSongs(visibleSongs, index);
      } catch {
        showToast(t('sounds.loadFailed'));
      }
    },
    [visibleSongs, showToast, t]
  );

  // ---- import ----
  const onImport = useCallback(async () => {
    if (importBusy) return;
    setImportBusy(true);
    if (__DEV__) console.log(`[sounds-import] onImport start (playlist=${activePlaylist?.id ?? 'none'})`);
    try {
      const result = await importLocalSounds();
      if (result.success) {
        const importedSongs = result.songs ?? [];
        const imported = result.importedCount ?? importedSongs.length;
        const failed = result.failedCount ?? 0;
        if (__DEV__ && failed > 0) console.warn('[sounds-import] per-file failures:', result.failures);
        // When importing from inside a playlist, also add the new songs to it.
        if (activePlaylist && importedSongs.length > 0) {
          if (__DEV__) console.log(`[sounds-import] adding ${importedSongs.length} song(s) to playlist ${activePlaylist.id}`);
          await addLocalSoundsToPlaylists(
            importedSongs.map((s) => s.id),
            [activePlaylist.id]
          );
        }
        await reload();
        if (failed > 0) showToast(t('sounds.importPartial', { imported, failed }));
        else if (imported > 0) showToast(t('sounds.importSuccess', { count: imported }));
        else if (__DEV__) console.log('[sounds-import] success but nothing imported (0 files)');
      } else if (result.code && !result.code.includes('CANCEL')) {
        if (__DEV__) console.warn(`[sounds-import] failed: code=${result.code} message=${result.message}`);
        showToast(t('sounds.importFailed'));
      } else if (__DEV__) {
        console.log(`[sounds-import] cancelled / no-op: code=${result.code}`);
      }
    } catch (e) {
      if (__DEV__) console.warn('[sounds-import] onImport threw:', e);
      showToast(t('sounds.importFailed'));
    } finally {
      setImportBusy(false);
    }
  }, [importBusy, activePlaylist, reload, showToast, t]);

  // ---- playlist CRUD ----
  const onCreatePlaylist = useCallback(async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    try {
      const created = await createLocalSoundPlaylist(name);
      setPlaylists((prev) => [...prev, created]);
      setNewPlaylistName('');
      setCreatePlaylistOpen(false);
    } catch {
      showToast(t('sounds.loadFailed'));
    }
  }, [newPlaylistName, showToast, t]);

  const onRenamePlaylist = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      await renameLocalSoundPlaylist(renameTarget.id, name);
      setRenameTarget(null);
      setRenameValue('');
      await reload();
    } catch {
      showToast(t('sounds.loadFailed'));
    }
  }, [renameTarget, renameValue, reload, showToast, t]);

  // ---- add to playlist (single/batch) ----
  const commitAddToPlaylists = useCallback(
    async (songIds: string[], playlistIds: string[]) => {
      if (songIds.length === 0 || playlistIds.length === 0) return;
      try {
        await addLocalSoundsToPlaylists(songIds, playlistIds);
        await reload();
        showToast(t('sounds.addToPlaylistSuccess'));
        exitSelection();
      } catch {
        showToast(t('sounds.loadFailed'));
      }
    },
    [reload, showToast, t, exitSelection]
  );

  // ---- favorites (smart toggle over the current selection) ----
  // If every selected song is already favorited we unfavorite; otherwise we favorite.
  // This means inside the Favorites playlist (all favorited) the action only ever
  // unfavorites, which is the desired behavior.
  const selectionAllFavorited = useMemo(() => {
    if (selectedIds.size === 0) return false;
    for (const id of selectedIds) if (!favoriteIdSet.has(id)) return false;
    return true;
  }, [selectedIds, favoriteIdSet]);

  const onToggleFavoriteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const makeFavorite = !selectionAllFavorited;
    try {
      await setLocalSoundsFavorite(ids, makeFavorite);
      await reload();
      showToast(
        makeFavorite
          ? t('sounds.favoriteAdded', { count: ids.length })
          : t('sounds.favoriteRemoved', { count: ids.length })
      );
      exitSelection();
    } catch {
      showToast(t('sounds.loadFailed'));
    }
  }, [selectedIds, selectionAllFavorited, reload, showToast, t, exitSelection]);

  // ---- confirm destructive / important actions ----
  const runPendingAction = useCallback(async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      if (pendingAction.type === 'deleteSingle') {
        await deleteLocalSounds([pendingAction.song.id]);
        showToast(t('sounds.deleteSuccess', { count: 1 }));
      } else if (pendingAction.type === 'deleteBatch') {
        const result = await deleteLocalSounds(pendingAction.ids);
        showToast(t('sounds.deleteSuccess', { count: result.deletedCount ?? pendingAction.ids.length }));
        exitSelection();
      } else if (pendingAction.type === 'removeFromPlaylist') {
        await removeLocalSoundsFromPlaylist(pendingAction.playlist.id, pendingAction.ids);
        exitSelection();
      } else if (pendingAction.type === 'deletePlaylist') {
        await deleteLocalSoundPlaylist(pendingAction.playlist.id);
        if (openPlaylistId === pendingAction.playlist.id) setOpenPlaylistId(null);
      }
      await reload();
    } catch {
      showToast(t('sounds.loadFailed'));
    } finally {
      setActionBusy(false);
      setPendingAction(null);
    }
  }, [pendingAction, reload, showToast, t, exitSelection, openPlaylistId]);

  // ---- song row ----
  const renderSong = useCallback(
    ({ item, index }: { item: LocalSound; index: number }) => {
      const selected = selectedIds.has(item.id);
      const isActive = activeTrackId != null && item.id === activeTrackId;
      return (
        <View
          style={[
            styles.row,
            {
              backgroundColor: selected ? colors.accent + '22' : colors.surface,
              borderColor: selected || isActive ? colors.accent : colors.border,
              borderWidth: isActive ? 2 : 1,
            },
          ]}
        >
          <Pressable
            onPress={() => (selectionMode ? toggleSelected(item.id) : playFrom(index))}
            onLongPress={() => {
              if (!selectionMode) enterSelectionFor(item.id);
            }}
            style={styles.rowMain}
          >
            {selectionMode ? (
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={selected ? colors.accent : colors.textMuted}
                style={styles.rowLead}
              />
            ) : null}
            <View style={[styles.thumb, { backgroundColor: colors.surfaceHover }]}>
              {item.thumbnailPath ? (
                <Image source={{ uri: `file://${item.thumbnailPath}` }} style={styles.thumbImage} contentFit="cover" />
              ) : (
                <Ionicons name="musical-note" size={22} color={colors.textMuted} />
              )}
            </View>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={[styles.rowMeta, { color: colors.textMuted }]}>
                {(item.artist || t('sounds.unknownArtist')) + ' · ' + formatDuration(item.durationSec)}
              </Text>
            </View>
          </Pressable>
          {!selectionMode ? (
            <Pressable
              hitSlop={8}
              onPress={() => setPlaylistPickerTarget({ ids: [item.id], title: item.title })}
              style={styles.rowAction}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      );
    },
    [selectedIds, selectionMode, activeTrackId, colors, t, toggleSelected, playFrom, enterSelectionFor]
  );

  const keyExtractor = useCallback((item: LocalSound) => item.id, []);

  // ---- playlist row ----
  const renderPlaylist = useCallback(
    ({ item }: { item: LocalSoundPlaylist }) => (
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable onPress={() => openPlaylist(item.id)} style={styles.rowMain}>
          <View style={[styles.thumb, { backgroundColor: colors.surfaceHover }]}>
            <Ionicons name={item.system ? 'heart' : 'musical-notes'} size={22} color={colors.accent} />
          </View>
          <View style={styles.rowText}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
              {playlistDisplayName(item)}
            </Text>
            <Text numberOfLines={1} style={[styles.rowMeta, { color: colors.textMuted }]}>
              {t('sounds.playlistItemCount', { count: item.songIds.length })}
            </Text>
          </View>
        </Pressable>
        {/* The special Favorites playlist can't be renamed or deleted. */}
        {item.system ? null : (
          <>
            <Pressable
              hitSlop={6}
              onPress={() => {
                setRenameTarget(item);
                setRenameValue(item.name);
              }}
              style={[styles.playlistActionBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="pencil" size={17} color={colors.text} />
            </Pressable>
            <Pressable
              hitSlop={6}
              onPress={() => setPendingAction({ type: 'deletePlaylist', playlist: item })}
              style={[styles.playlistActionBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="trash-outline" size={17} color={colors.error} />
            </Pressable>
          </>
        )}
      </View>
    ),
    [colors, t, openPlaylist, playlistDisplayName]
  );

  const keyExtractorPlaylist = useCallback((item: LocalSoundPlaylist) => item.id, []);

  if (!supported) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header title={t('sounds.title')} colors={colors} onBack={() => router.back()} />
        <View style={styles.centered}>
          <Ionicons name="musical-notes-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('sounds.unsupported')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header
        title={activePlaylist ? playlistDisplayName(activePlaylist) : t('sounds.title')}
        colors={colors}
        onBack={onHeaderBack}
        right={
          <View style={styles.headerActions}>
            {showingSongs ? (
              <Pressable hitSlop={8} onPress={() => setSortMenuOpen(true)} style={styles.headerBtn}>
                <Ionicons name="swap-vertical" size={22} color={colors.text} />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={8}
              onPress={onImport}
              disabled={importBusy}
              style={styles.headerBtn}
              accessibilityLabel={t('sounds.import')}
            >
              {importBusy ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name={activePlaylist ? 'add-circle-outline' : 'add'} size={activePlaylist ? 22 : 24} color={colors.text} />
              )}
            </Pressable>
            {activePlaylist && !activePlaylist.system ? (
              <>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    setRenameTarget(activePlaylist);
                    setRenameValue(activePlaylist.name);
                  }}
                  style={styles.headerBtn}
                  accessibilityLabel={t('sounds.playlistRename')}
                >
                  <Ionicons name="pencil" size={20} color={colors.text} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => setPendingAction({ type: 'deletePlaylist', playlist: activePlaylist })}
                  style={styles.headerBtn}
                  accessibilityLabel={t('sounds.playlistDelete')}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                </Pressable>
              </>
            ) : null}
          </View>
        }
      />

      {/* Segmented control (top level only — hidden inside a playlist) */}
      {!activePlaylist ? (
        <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {(['songs', 'playlists'] as Tab[]).map((seg) => {
            const active = tab === seg;
            return (
              <Pressable
                key={seg}
                onPress={() => switchTab(seg)}
                style={[styles.segmentBtn, active ? { backgroundColor: colors.accent } : null]}
              >
                <Text style={[styles.segmentText, { color: active ? colors.background : colors.textMuted }]}>
                  {t(seg === 'songs' ? 'sounds.tabSongs' : 'sounds.tabPlaylists')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Search (only in song views) */}
      {showingSongs ? (
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('sounds.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {query.length > 0 ? (
            <Pressable hitSlop={8} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Body */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : showingSongs ? (
        visibleSongs.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="musical-notes-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.text }]}>
              {activePlaylist ? t('sounds.playlistEmpty') : t('sounds.empty')}
            </Text>
            {!activePlaylist ? (
              <Text style={[styles.emptyHint, { color: colors.textMuted }]}>{t('sounds.emptyHint')}</Text>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={visibleSongs}
            renderItem={renderSong}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
          />
        )
      ) : (
        // Playlists tab
        <FlatList
          data={sortedPlaylists}
          renderItem={renderPlaylist}
          keyExtractor={keyExtractorPlaylist}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="list-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.text }]}>{t('sounds.noPlaylistsYet')}</Text>
            </View>
          }
          ListFooterComponent={
            <Pressable
              onPress={() => setCreatePlaylistOpen(true)}
              style={[styles.createRow, { borderColor: colors.borderSubtle }]}
            >
              <Ionicons name="add" size={20} color={colors.accent} />
              <Text style={[styles.createRowText, { color: colors.accent }]}>{t('sounds.playlistCreate')}</Text>
            </Pressable>
          }
        />
      )}

      {/* Mini player (hidden while the selection bar occupies the bottom) */}
      {!selectionMode ? <MiniPlayer colors={colors} onOpen={() => router.push('/sound-player' as Href)} /> : null}

      {/* Selection action bar */}
      {selectionMode ? (
        <View style={[styles.selectionBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable hitSlop={8} onPress={exitSelection} style={styles.selectionBtn}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.selectionCount, { color: colors.text }]}>
            {t('sounds.selectedCount', { count: selectedIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable hitSlop={8} onPress={selectAll} style={styles.selectionBtn}>
              <Ionicons name="checkmark-done" size={22} color={colors.text} />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={onToggleFavoriteSelected}
              style={styles.selectionBtn}
              accessibilityLabel={t(selectionAllFavorited ? 'sounds.unfavorite' : 'sounds.favorite')}
            >
              <Ionicons
                name={selectionAllFavorited ? 'heart' : 'heart-outline'}
                size={22}
                color={selectionAllFavorited ? colors.accent : colors.text}
              />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => setPlaylistPickerTarget({ ids: Array.from(selectedIds) })}
              style={styles.selectionBtn}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.text} />
            </Pressable>
            {/* Remove-from-playlist only for regular playlists; in Favorites the heart
                toggle above already does the unfavorite. */}
            {activePlaylist && !activePlaylist.system ? (
              <Pressable
                hitSlop={8}
                onPress={() =>
                  setPendingAction({ type: 'removeFromPlaylist', playlist: activePlaylist, ids: Array.from(selectedIds) })
                }
                style={styles.selectionBtn}
              >
                <Ionicons name="remove-circle-outline" size={22} color={colors.text} />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={8}
              onPress={() => setPendingAction({ type: 'deleteBatch', ids: Array.from(selectedIds) })}
              style={styles.selectionBtn}
            >
              <Ionicons name="trash-outline" size={22} color={colors.error} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {toast ? (
        <View style={[styles.toast, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
          <Text style={[styles.toastText, { color: colors.text }]}>{toast}</Text>
        </View>
      ) : null}

      {/* Sort menu */}
      <SimpleSheet visible={sortMenuOpen} onClose={() => setSortMenuOpen(false)} colors={colors}>
        {(
          [
            ['newest', 'sortNewest'],
            ['oldest', 'sortOldest'],
            ['titleAsc', 'sortTitleAsc'],
            ['titleDesc', 'sortTitleDesc'],
            ['durationDesc', 'sortDurationDesc'],
            ['durationAsc', 'sortDurationAsc'],
          ] as [SortMode, string][]
        ).map(([mode, key]) => (
          <Pressable
            key={mode}
            onPress={() => {
              setSortMode(mode);
              setSortMenuOpen(false);
            }}
            style={[styles.sheetRow, { borderColor: colors.border }]}
          >
            <Text style={[styles.sheetRowText, { color: colors.text }]}>{t(`sounds.${key}`)}</Text>
            {sortMode === mode ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
          </Pressable>
        ))}
      </SimpleSheet>

      {/* Create playlist modal */}
      <InputModal
        visible={createPlaylistOpen}
        colors={colors}
        title={t('sounds.playlistCreateTitle')}
        placeholder={t('sounds.playlistNamePlaceholder')}
        value={newPlaylistName}
        onChangeText={setNewPlaylistName}
        confirmLabel={t('sounds.playlistCreateConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={onCreatePlaylist}
        onCancel={() => {
          setCreatePlaylistOpen(false);
          setNewPlaylistName('');
        }}
      />

      {/* Rename playlist modal */}
      <InputModal
        visible={renameTarget != null}
        colors={colors}
        title={t('sounds.playlistRename')}
        placeholder={t('sounds.playlistNamePlaceholder')}
        value={renameValue}
        onChangeText={setRenameValue}
        confirmLabel={t('sounds.playlistRenameConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={onRenamePlaylist}
        onCancel={() => {
          setRenameTarget(null);
          setRenameValue('');
        }}
      />

      {/* Add-to-playlist picker */}
      <PlaylistPickerModal
        visible={playlistPickerTarget != null}
        colors={colors}
        playlists={playlists.filter((p) => !p.system)}
        title={t('sounds.addToPlaylistTitle')}
        message={
          playlistPickerTarget?.title
            ? t('sounds.addToPlaylistMessage', { title: playlistPickerTarget.title })
            : t('sounds.batchAddToPlaylistMessage', { count: playlistPickerTarget?.ids.length ?? 0 })
        }
        emptyText={t('sounds.noPlaylistsYet')}
        confirmLabel={t('sounds.addToPlaylistConfirm')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setPlaylistPickerTarget(null)}
        onConfirm={(playlistIds) => {
          const ids = playlistPickerTarget?.ids ?? [];
          setPlaylistPickerTarget(null);
          commitAddToPlaylists(ids, playlistIds);
        }}
      />

      {/* Confirmation modal */}
      <ConfirmModal
        visible={pendingAction != null}
        colors={colors}
        busy={actionBusy}
        config={confirmConfig(pendingAction, t)}
        onCancel={() => setPendingAction(null)}
        onConfirm={runPendingAction}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({
  title,
  colors,
  onBack,
  right,
}: {
  title: string;
  colors: any;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={[styles.header, { borderColor: colors.border }]}>
      <Pressable hitSlop={8} onPress={onBack} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>
        {title}
      </Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

function MiniPlayer({ colors, onOpen }: { colors: any; onOpen: () => void }) {
  const track = useActiveTrack();
  const playback = usePlaybackState();
  const playing = playback.state === State.Playing;
  if (!track) return null;
  return (
    <Pressable onPress={onOpen} style={[styles.miniPlayer, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
      <View style={[styles.miniThumb, { backgroundColor: colors.surface }]}>
        {track.artwork ? (
          <Image source={{ uri: String(track.artwork) }} style={styles.miniThumbImg} contentFit="cover" />
        ) : (
          <Ionicons name="musical-note" size={18} color={colors.textMuted} />
        )}
      </View>
      <View style={styles.miniText}>
        <Text numberOfLines={1} style={[styles.miniTitle, { color: colors.text }]}>
          {track.title ?? ''}
        </Text>
        <Text numberOfLines={1} style={[styles.miniArtist, { color: colors.textMuted }]}>
          {track.artist ?? ''}
        </Text>
      </View>
      <Pressable hitSlop={10} onPress={() => (playing ? TrackPlayer.pause() : TrackPlayer.play())} style={styles.miniBtn}>
        <Ionicons name={playing ? 'pause' : 'play'} size={26} color={colors.text} />
      </Pressable>
    </Pressable>
  );
}

function SimpleSheet({
  visible,
  onClose,
  colors,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  colors: any;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function InputModal({
  visible,
  colors,
  title,
  placeholder,
  value,
  onChangeText,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  colors: any;
  title: string;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            autoFocus
            style={[styles.cardInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceHover }]}
          />
          <View style={styles.cardButtons}>
            <Pressable onPress={onCancel} style={[styles.cardButton, { backgroundColor: colors.surfaceHover }]}>
              <Text style={[styles.cardButtonText, { color: colors.text }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={[styles.cardButton, { backgroundColor: colors.accent }]}>
              <Text style={[styles.cardButtonText, { color: colors.background }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PlaylistPickerModal({
  visible,
  colors,
  playlists,
  title,
  message,
  emptyText,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  colors: any;
  playlists: LocalSoundPlaylist[];
  title: string;
  message: string;
  emptyText: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (playlistIds: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (visible) setSelected(new Set());
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.cardMessage, { color: colors.textMuted }]}>{message}</Text>
          {playlists.length === 0 ? (
            <Text style={[styles.cardMessage, { color: colors.textMuted }]}>{emptyText}</Text>
          ) : (
            <ScrollView style={styles.pickerList}>
              {playlists.map((pl) => {
                const checked = selected.has(pl.id);
                return (
                  <Pressable
                    key={pl.id}
                    onPress={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(pl.id)) next.delete(pl.id);
                        else next.add(pl.id);
                        return next;
                      })
                    }
                    style={[styles.pickerRow, { borderColor: colors.border }]}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? colors.accent : colors.textMuted}
                    />
                    <Text style={[styles.pickerRowText, { color: colors.text }]}>{pl.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={styles.cardButtons}>
            <Pressable onPress={onCancel} style={[styles.cardButton, { backgroundColor: colors.surfaceHover }]}>
              <Text style={[styles.cardButtonText, { color: colors.text }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              disabled={selected.size === 0}
              onPress={() => onConfirm(Array.from(selected))}
              style={[styles.cardButton, { backgroundColor: colors.accent, opacity: selected.size === 0 ? 0.5 : 1 }]}
            >
              <Text style={[styles.cardButtonText, { color: colors.background }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function confirmConfig(
  action: PendingAction,
  t: (k: string, opts?: any) => string
): { title: string; message: string; confirm: string; destructive: boolean } | null {
  if (!action) return null;
  switch (action.type) {
    case 'deleteSingle':
      return {
        title: t('sounds.deleteTitle'),
        message: t('sounds.deleteMessage', { title: action.song.title }),
        confirm: t('sounds.deleteConfirm'),
        destructive: true,
      };
    case 'deleteBatch':
      return {
        title: t('sounds.batchDeleteTitle', { count: action.ids.length }),
        message: t('sounds.batchDeleteMessage'),
        confirm: t('sounds.batchDeleteConfirm'),
        destructive: true,
      };
    case 'removeFromPlaylist':
      return {
        title: t('sounds.batchRemoveFromPlaylistTitle', { count: action.ids.length }),
        message: t('sounds.batchRemoveFromPlaylistMessage', { name: action.playlist.name }),
        confirm: t('sounds.removeFromPlaylistConfirm'),
        destructive: false,
      };
    case 'deletePlaylist':
      return {
        title: t('sounds.playlistDeleteTitle'),
        message: t('sounds.playlistDeleteMessage', { name: action.playlist.name }),
        confirm: t('sounds.playlistDeleteConfirm'),
        destructive: true,
      };
    default:
      return null;
  }
}

function ConfirmModal({
  visible,
  colors,
  busy,
  config,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  colors: any;
  busy: boolean;
  config: { title: string; message: string; confirm: string; destructive: boolean } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!config) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{config.title}</Text>
          <Text style={[styles.cardMessage, { color: colors.textMuted }]}>{config.message}</Text>
          <View style={styles.cardButtons}>
            <Pressable onPress={onCancel} style={[styles.cardButton, { backgroundColor: colors.surfaceHover }]}>
              <Text style={[styles.cardButtonText, { color: colors.text }]}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={[styles.cardButton, { backgroundColor: config.destructive ? colors.error : colors.accent }]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text style={[styles.cardButtonText, { color: colors.background }]}>{config.confirm}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerBtn: { padding: 6 },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 12,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  segmentBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10 },
  segmentText: { fontSize: 14, lineHeight: 19, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  listContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 160 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLead: { marginRight: 2 },
  thumb: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 2 },
  rowAction: { padding: 4 },
  playlistActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  createRowText: { fontSize: 14, fontWeight: '600' },
  selectionBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  selectionCount: { flex: 1, fontSize: 15, fontWeight: '600' },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectionBtn: { padding: 6 },
  miniPlayer: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 8,
  },
  miniThumb: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  miniThumbImg: { width: '100%', height: '100%' },
  miniText: { flex: 1 },
  miniTitle: { fontSize: 14, fontWeight: '600' },
  miniArtist: { fontSize: 12, marginTop: 1 },
  miniBtn: { padding: 6 },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 90,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  toastText: { fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: '#000000CC', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420, borderRadius: 16, borderWidth: 1, paddingVertical: 8 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowText: { fontSize: 15 },
  card: { width: '100%', maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 20, gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  cardMessage: { fontSize: 14, lineHeight: 20 },
  cardInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  pickerList: { maxHeight: 260 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerRowText: { fontSize: 15, flex: 1 },
  cardButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cardButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 12, minHeight: 44 },
  cardButtonText: { fontSize: 15, fontWeight: '700' },
});
