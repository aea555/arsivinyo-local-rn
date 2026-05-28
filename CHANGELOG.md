# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html) with `-beta.N` prerelease suffixes.

## [Unreleased]

## [2.2.0-beta.1] — vault organization (tags + folders)

Tags and folders for the private vault, plus batch operations for both.

### Added
- **Tags.** User-defined labels, many per video. Auto-assigned color from a 12-color palette. Filter the vault list by tag (OR semantics — videos matching any selected tag show). Manage tags (create, rename, delete) from the "Manage" chip in the filter row. Cascade-removes from every entry when a tag is deleted.
- **Folders.** Flat hierarchy (no nesting in v1). Each video belongs to 0 or 1 folder. Folder rows appear at root with item-count badges; tap to enter, tap the back chevron in the header to exit. Long-press a folder row to delete (videos inside move to root).
- **Single-video tag + folder edits.** Per-row "Tags" and "Move" buttons open dedicated pickers. Inline "Create new" affordances inside both pickers so users don't have to context-switch to create a tag or folder.
- **Batch tag + folder operations.** Multi-select bar gains Tag and Move icons. Both go through the same confirmation modal pattern as Copy/Delete. Batch tag union-merges with each entry's existing tags (additive, not replace).
- **Per-row tag chips.** Up to 3 visible chips per row + `+N` overflow indicator.
- New `Chip` / `ChipRow` components in [src/components/Chip.tsx](src/components/Chip.tsx) — reusable pill primitive with size variants.
- Native Tag + Folder APIs in `LocalDownloaderModule.kt` with `tag` and `folder` biometric auth purposes.
- All UI strings localized in EN + TR (other 8 locales fall back to English).
- Index.json schema bumped to v3 (additive: `tagDefinitions[]`, `folders[]`). v2 indexes auto-upgrade on first write.

### Changed
- `PrivateVideoEntry` gains `tags: List<String>` and `folderId: String?` (both default to empty/null for backward compat).
- `LocalPrivateAuthPurpose` adds `'tag'`, `'folder'`, `'bundleExport'`, `'bundleImport'`.
- `pendingBatch` state in `private-videos.tsx` extends to `'delete' | 'copy' | 'tag' | 'folder' | null`.
- Filter chain composition (memoized): `folder scope → active tag set → search query → sort` — single useMemo, recomputes only when any input actually changes.

### Deferred
- **Encrypted export/import bundle** (originally in this plan) — split off into v2.3.0 to keep the release scope shippable. Stub work for that release: `bundleExport` / `bundleImport` auth purposes already defined, but no UI / native implementation yet.
- Color editing for existing tags (auto-assigned color is permanent in v1; users can delete and re-create to get a new color).
- Folder nesting (flat only in v1).

## [2.1.0-beta.1] — vault hardening (first pass)

Backwards-compatible read of existing v2/v3 vault items. New imports use cipher v4. Opt-in re-encryption migration available in Settings.

### Added
- Cipher v4: Tink `AesGcmHkdfStreaming` with 1 MB segments — per-segment GCM tags give integrity (the prior CTR mode had none) and seekable random-access reads.
- Loopback HTTP server (`127.0.0.1`, ephemeral port, per-session token) for streaming v4 playback. No plaintext temp file is written during playback of v4 items.
- Encrypted thumbnails for vault items, generated at import time via `MediaMetadataRetriever` with ffmpeg-via-Chaquopy fallback for unsupported codecs.
- Rename support for vault items. Title is now decoupled from container extension.
- "Re-encrypt vault to current security" action in Settings — biometric-gated, pause/resume across launches, disk-space and battery pre-flight.
- Diagnostics screen now shows app version, version code, channel, and a "Vault" section (cipher counts, server status, active sessions, last migration result, Tink version).
- `CHANGELOG.md` (this file).
- Versioning convention documented in `CLAUDE.md`.

### Changed
- `app.config.js` is now the single source of truth for both `version` and `android.versionCode`. `expo prebuild` propagates them to `android/app/build.gradle`.
- `LocalPrivateAuthPurpose` gains a `'rename'` value (lighter than `'view'`, which triggers playback cleanup).
- New imports default to cipher v4. v2 and v3 reads remain supported.
- `PrivateVideoEntry` gains `thumbFileName`, `thumbWidth`, `thumbHeight`, `containerExt`, `durationSecExact`, `migrationFailed`.

### Fixed
- `FLAG_SECURE` is now applied before navigation to `private-player`, closing a one-frame screenshot window present in 2.0.x.
- Playback file extension is no longer derived from `entry.title` (would break after rename) — derived from new `containerExt` field, backfilled on first access for legacy entries.
- `android/app/build.gradle` `versionCode` is no longer hardcoded to `1`. It now comes from `app.config.js` `android.versionCode`, allowing Play Store updates.
- `KeyPermanentlyInvalidatedException` from the vault master key path is now caught and surfaced as a recoverable error instead of crashing (occurs when the user changes their device lock).
- `src/config.ts` no longer claims a fake `1.1.0` version when `expoConfig.version` is missing — surfaces `'unknown'` instead.

### Security
- Vault content is now authenticated (chunked AEAD). Tampering with encrypted bytes on disk is now detected at decrypt time.
- Playback of v4 items never decrypts the full file to disk. ExoPlayer streams from the in-process loopback server.

## [2.0.1] — 2025-05-11

Prior baseline. See git history.

## [2.0.0]

Major UX changes. See git history.

## [1.1.1] / [1.0.0]

Historical releases. See git history.
