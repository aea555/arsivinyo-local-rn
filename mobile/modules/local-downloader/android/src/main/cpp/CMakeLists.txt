# Native audio-preset renderer.
#
# Builds libaudiopresets.so: the DSP core plus the ffmpeg pipe plumbing and a small
# JNI surface. Deliberately does NOT link FFmpeg — the bundled ffmpeg/ffprobe are
# executed as separate processes for container and codec work only, so this library
# stays small and owns nothing but the signal processing.
#
# The same sources build on the host with scripts/test-audio-presets.sh, which is
# where the DSP and render behaviour are actually verified.

cmake_minimum_required(VERSION 3.22.1)
project(audiopresets LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(audiopresets SHARED
    audio_presets_jni.cpp
    ffmpeg_pipe.cpp
    preset_params.cpp
    dsp/freeverb.cpp
    dsp/resampler.cpp
    dsp/limiter.cpp
    dsp/preset_chain.cpp
)

target_include_directories(audiopresets PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

target_compile_options(audiopresets PRIVATE
    -Wall
    -Wextra
    -ffast-math
    -fvisibility=hidden
)

# Only the JNI entry points are exported; everything else stays internal.
set_target_properties(audiopresets PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
)

# log is for __android_log_* if this ever needs to trace; the JNI headers come from
# the NDK toolchain automatically.
find_library(log-lib log)
target_link_libraries(audiopresets ${log-lib})
