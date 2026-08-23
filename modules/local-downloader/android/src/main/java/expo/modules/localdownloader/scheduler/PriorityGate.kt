package expo.modules.localdownloader.scheduler

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * A counting gate that admits waiters in a chosen order rather than in arrival order.
 *
 * This is the whole scheduler. Downloads used to run strictly one at a time: a job held
 * the entire pipeline from the first network byte to the last write, so the CPU sat idle
 * through a ten-minute transfer and the network sat idle through a five-minute transcode.
 * Each stage now takes a permit from its own gate and gives it back before asking for the
 * next one, which is what lets one download be written to disk while another is still
 * arriving.
 *
 * Deliberately *not* preemptive. Nothing here interrupts work that has started, because
 * the expensive work is not ours to interrupt — it happens in forked ffmpeg processes and
 * in CPython under Chaquopy, and the kernel already time-slices those across the cores.
 * Slicing minute-long jobs against each other would only make both finish later. This
 * decides what may *start*, and in what order.
 *
 * **Order.** Shortest expected duration first, so a three-minute song shared while an
 * eight-hour ambient track is mid-transcode does not wait for it. [agingMs] is what stops
 * that starving the long track: once a waiter has waited that long it is promoted ahead of
 * every un-aged waiter, whatever its size.
 *
 * **Waiting is sleeping.** A waiter suspends and is resumed when a permit is handed to it.
 * Nothing polls, and a permit is passed straight from the releaser to the chosen waiter
 * rather than being returned to a pool the waiters race for.
 *
 * Free of Android and of this app, so its behaviour is verified on the JVM by
 * `PriorityGateTest` rather than by watching a phone.
 */
class PriorityGate(
  private val permits: Int,
  private val agingMs: Long = DEFAULT_AGING_MS,
  private val clock: () -> Long = { System.currentTimeMillis() },
) {

  init {
    require(permits > 0) { "permits must be positive, was $permits" }
    require(agingMs > 0) { "agingMs must be positive, was $agingMs" }
  }

  private val lock = Any()

  /** Permits nobody is holding and nobody has been handed. */
  private var available: Int = permits

  private val waiters = ArrayList<Waiter>()

  private class Waiter(
    val priority: Long,
    val enqueuedAt: Long,
    val continuation: CancellableContinuation<Unit>,
  )

  /** How many permits are currently held. Test and diagnostics only. */
  val inUse: Int get() = synchronized(lock) { permits - available }

  /** How many callers are asleep waiting. Test and diagnostics only. */
  val queued: Int get() = synchronized(lock) { waiters.size }

  /**
   * Wait for a permit.
   *
   * @param priority lower goes first — the expected duration of the work in
   * milliseconds. Use [UNKNOWN_PRIORITY] when it cannot be estimated; aging still
   * guarantees such a waiter eventually runs.
   */
  suspend fun acquire(priority: Long = UNKNOWN_PRIORITY) {
    synchronized(lock) {
      if (available > 0) {
        available -= 1
        return
      }
    }
    suspendCancellableCoroutine { continuation ->
      val waiter = Waiter(priority, clock(), continuation)
      var granted = false
      synchronized(lock) {
        // Re-check: a permit may have been released between the fast path above and
        // here, and nobody would wake us because we were not on the list yet.
        if (available > 0) {
          available -= 1
          granted = true
        } else {
          waiters.add(waiter)
        }
      }
      if (granted) {
        continuation.resume(Unit)
        return@suspendCancellableCoroutine
      }
      continuation.invokeOnCancellation {
        val stillWaiting = synchronized(lock) { waiters.remove(waiter) }
        // If it is no longer on the list a permit was already handed to it, and the
        // cancellation means nothing will ever give that permit back.
        if (!stillWaiting) release()
      }
    }
  }

  /** Give a permit back, handing it directly to whichever waiter should go next. */
  fun release() {
    val next: Waiter? = synchronized(lock) {
      val chosen = selectLocked()
      if (chosen == null) {
        check(available < permits) { "release() called more times than acquire()" }
        available += 1
      } else {
        waiters.remove(chosen)
      }
      chosen
    }
    // Resumed outside the lock: a continuation can run its caller inline on this thread,
    // and doing that while holding the monitor invites a deadlock.
    next?.continuation?.resume(Unit)
  }

  private fun selectLocked(): Waiter? {
    if (waiters.isEmpty()) return null
    val now = clock()
    var aged: Waiter? = null
    var shortest: Waiter? = null
    for (waiter in waiters) {
      if (now - waiter.enqueuedAt >= agingMs) {
        // Among aged waiters the one that has waited longest goes first.
        if (aged == null || waiter.enqueuedAt < aged.enqueuedAt) aged = waiter
      }
      val better = shortest == null ||
        waiter.priority < shortest.priority ||
        (waiter.priority == shortest.priority && waiter.enqueuedAt < shortest.enqueuedAt)
      if (better) shortest = waiter
    }
    return aged ?: shortest
  }

  companion object {
    /**
     * Ten minutes. Long enough that ordinary short jobs still overtake a long one — the
     * point of ordering at all — and short enough that a long track queued behind a
     * stream of short ones starts within a bounded time rather than never.
     */
    const val DEFAULT_AGING_MS: Long = 10 * 60 * 1000L

    /**
     * Used when no duration estimate exists. Deliberately large rather than
     * [Long.MAX_VALUE], so arithmetic on it cannot overflow.
     */
    const val UNKNOWN_PRIORITY: Long = Long.MAX_VALUE / 4
  }
}

/**
 * Run [block] holding one of [gate]'s permits, and give it back however [block] ends.
 *
 * Not an extension on the class so it stays a plain function the tests can reason about.
 */
suspend inline fun <T> PriorityGate.withPermit(priority: Long, block: () -> T): T {
  acquire(priority)
  try {
    return block()
  } finally {
    release()
  }
}
