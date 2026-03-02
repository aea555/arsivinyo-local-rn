#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BUILD_GRADLE="$ROOT_DIR/android/build.gradle"
APP_GRADLE="$ROOT_DIR/android/app/build.gradle"

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
  if [[ ! -f "$BUILD_GRADLE" || ! -f "$APP_GRADLE" ]]; then
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
}

for run in 1 2; do
  echo "[verify-local-downloader-prebuild] prebuild run $run"
  CI=1 npx expo prebuild --clean --platform android --no-install >/tmp/local-downloader-prebuild-$run.log 2>&1 || {
    cat /tmp/local-downloader-prebuild-$run.log
    exit 1
  }
  verify_generated_files
  echo "[verify-local-downloader-prebuild] run $run passed"
done

echo "[verify-local-downloader-prebuild] all checks passed"
