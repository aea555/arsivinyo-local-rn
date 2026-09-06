// JNI surface for the audio-preset renderer.
//
// Deliberately tiny: one render call plus a version probe for diagnostics. All preset
// identity — built-ins, user-defined presets, slider values — lives in TypeScript and
// arrives here as a flat `key=value;` spec. Native never learns what a preset is
// called, which is why adding or editing a preset needs no native change at all.

#include <jni.h>

#include <string>

#include "ffmpeg_pipe.h"

namespace {

/** Copy a Java string, tolerating null (returns an empty string). */
std::string ToStdString(JNIEnv* env, jstring value) {
  if (value == nullptr) return {};
  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) return {};
  std::string out(chars);
  env->ReleaseStringUTFChars(value, chars);
  return out;
}

}  // namespace

extern "C" {

/**
 * Render one track through a preset.
 *
 * Returns null on success, or a message describing the failure. A message rather than
 * an error code because the useful detail is whatever ffmpeg printed to stderr, which
 * no fixed enum could carry.
 */
JNIEXPORT jstring JNICALL
Java_expo_modules_localdownloader_audio_AudioPresets_nativeApplyPreset(
    JNIEnv* env, jobject /*self*/, jstring ffmpegPath, jstring ffprobePath, jstring inputPath,
    jstring outputPath, jstring paramsSpec, jstring outputFormat, jstring title, jstring artist,
    jstring progressFilePath, jstring cancelFlagPath) {
  arsivinyo::audio::RenderRequest request;
  request.ffmpegPath = ToStdString(env, ffmpegPath);
  request.ffprobePath = ToStdString(env, ffprobePath);
  request.inputPath = ToStdString(env, inputPath);
  request.outputPath = ToStdString(env, outputPath);
  request.paramsSpec = ToStdString(env, paramsSpec);
  request.title = ToStdString(env, title);
  request.artist = ToStdString(env, artist);
  request.progressFilePath = ToStdString(env, progressFilePath);
  request.cancelFlagPath = ToStdString(env, cancelFlagPath);

  const std::string format = ToStdString(env, outputFormat);
  request.outputFormat = format == "m4a" ? "m4a" : "flac";

  std::string error;
  if (arsivinyo::audio::RenderPreset(request, &error)) {
    return nullptr;
  }
  if (error.empty()) error = "RENDER_FAILED";
  return env->NewStringUTF(error.c_str());
}

/** Identifies the native library in the diagnostics screen. */
JNIEXPORT jstring JNICALL
Java_expo_modules_localdownloader_audio_AudioPresets_nativeVersion(JNIEnv* env,
                                                                        jobject /*self*/) {
  return env->NewStringUTF("audiopresets/1.0.0");
}

}  // extern "C"
