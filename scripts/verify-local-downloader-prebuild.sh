#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BUILD_GRADLE="$ROOT_DIR/android/build.gradle"
APP_GRADLE="$ROOT_DIR/android/app/build.gradle"
GRADLE_PROPERTIES="$ROOT_DIR/android/gradle.properties"
MERGED_NATIVE_LIBS_DIR="$ROOT_DIR/android/app/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib"

assert_once() {
  local marker="$1"
  local file="$2"
  local count
  count=$(grep -F "$marker" "$file" | wc -l | tr -d ' ')
  if [[ "$count" != "1" ]]; then
    echo "[verify-local-downloader-prebuild] Expected marker '$marker' exactly once in $file, found $count"
    exit 1
  fi
}

verify_generated_files() {
  if [[ ! -f "$BUILD_GRADLE" || ! -f "$APP_GRADLE" || ! -f "$GRADLE_PROPERTIES" ]]; then
    echo "[verify-local-downloader-prebuild] Android Gradle files were not generated"
    exit 1
  fi

  assert_once "// @generated begin local-downloader-chaquopy-buildscript-repo" "$BUILD_GRADLE"
  assert_once "// @generated begin local-downloader-chaquopy-allprojects-repo" "$BUILD_GRADLE"
  assert_once "// @generated begin local-downloader-chaquopy-buildscript-classpath" "$BUILD_GRADLE"
  assert_once "// @generated begin local-downloader-python-config" "$APP_GRADLE"
  assert_once "// @generated begin local-downloader-sourceset-config" "$APP_GRADLE"

  if ! grep -Fq 'apply plugin: "com.chaquo.python"' "$APP_GRADLE"; then
    echo "[verify-local-downloader-prebuild] Missing Chaquopy apply plugin in app/build.gradle"
    exit 1
  fi

  if ! grep -Fq 'expo.useLegacyPackaging=true' "$GRADLE_PROPERTIES"; then
    echo "[verify-local-downloader-prebuild] expo.useLegacyPackaging must be true in android/gradle.properties"
    exit 1
  fi
}

verify_merged_native_libs() {
  local gradle_log="/tmp/local-downloader-gradle-merge.log"
  (
    cd "$ROOT_DIR/android"
    ./gradlew :app:mergeDebugNativeLibs -x lint -x test --configure-on-demand >"$gradle_log" 2>&1
  ) || {
    cat "$gradle_log"
    exit 1
  }

  local required_abis=("arm64-v8a" "armeabi-v7a" "x86_64")
  for abi in "${required_abis[@]}"; do
    local ffmpeg_lib="$MERGED_NATIVE_LIBS_DIR/$abi/libffmpeg.so"
    local ffprobe_lib="$MERGED_NATIVE_LIBS_DIR/$abi/libffprobe.so"
    if [[ ! -f "$ffmpeg_lib" ]]; then
      echo "[verify-local-downloader-prebuild] Missing merged native lib: $ffmpeg_lib"
      exit 1
    fi
    if [[ ! -f "$ffprobe_lib" ]]; then
      echo "[verify-local-downloader-prebuild] Missing merged native lib: $ffprobe_lib"
      exit 1
    fi
  done
}

for run in 1 2; do
  echo "[verify-local-downloader-prebuild] prebuild run $run"
  CI=1 npx expo prebuild --clean --platform android --no-install >/tmp/local-downloader-prebuild-$run.log 2>&1 || {
    cat /tmp/local-downloader-prebuild-$run.log
    exit 1
  }
  verify_generated_files
  verify_merged_native_libs
  echo "[verify-local-downloader-prebuild] run $run passed"
done

echo "[verify-local-downloader-prebuild] all checks passed"
