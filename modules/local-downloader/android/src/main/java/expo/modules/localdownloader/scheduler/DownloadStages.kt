package expo.modules.localdownloader.scheduler

/**
 * The gates a download passes through, and how many jobs each admits at once.
 *
 * A job holds exactly one of these at a time and gives it back before asking for the
 * next, which is what lets the stages of different downloads overlap.
 *
 * **The stages are what the pipeline can actually separate**, not what would be ideal.
 * yt-dlp runs its FFmpeg postprocessors at the end of the same call that fetches the
 * bytes, so from here a transfer and the transcode that follows it are one operation and
 * share [fetch]. Splitting them would mean taking the postprocessing away from yt-dlp and
 * running FFmpeg ourselves.
 *
 * The numbers come from measurements on the maintainer's device: FLAC encoding runs at
 * about 143x realtime on one core, decoding at 457x, and the preset DSP at 238x. The
 * heavy work is single-threaded ffmpeg processes, so these limits put roughly half the
 * phone's eight cores to work at peak. They are tuning constants, not a contract.
 */
data class DownloadStages(
  /**
   * Resolving what a URL is: one metadata fetch, plus yt-dlp's extractor work in CPython.
   * Kept small because that work is CPU-bound Python and serializes on the GIL anyway,
   * and because it is seconds against minutes of transfer.
   */
  val preflight: PriorityGate = PriorityGate(2),

  /**
   * Fetching the media, and the transcode yt-dlp performs at the end of the same call.
   *
   * Five rather than three because each FFmpeg process is single-threaded, so this is
   * also how many of the phone's eight cores a batch of long transcodes can put to work.
   * At three, a queue of four took two passes to clear while five cores sat idle. The
   * remaining three are left for the UI and the system; past six there are no cores to
   * win and each transcode simply gets a thinner slice.
   *
   * Raising this does not make any single download faster — it changes how many are
   * worked on at once.
   */
  val fetch: PriorityGate = PriorityGate(5),

  /**
   * Writing the result into the music library or the vault.
   *
   * More than one because these are genuinely different destinations — the vault writes
   * a plain file in app-private storage while the library writes through MediaProvider —
   * but not many, because concurrent multi-gigabyte writes contend rather than overlap.
   */
  val store: PriorityGate = PriorityGate(2),

  /**
   * Applying audio presets. Lowest capacity of the CPU stages because a render is
   * derived work: the download it came from should land first.
   */
  val render: PriorityGate = PriorityGate(2),
) {
  companion object {
    /**
     * How many URLs may wait to be started.
     *
     * Downloads run concurrently now, so this bounds a waiting list of URL strings and
     * nothing else. It exists only so a share-sheet or clipboard loop cannot grow the
     * list without limit, and is set far above anything a person would queue by hand —
     * the previous limit of three rejected a fourth shared link for no reason the user
     * could act on.
     */
    const val MAX_QUEUED = 256
  }
}
