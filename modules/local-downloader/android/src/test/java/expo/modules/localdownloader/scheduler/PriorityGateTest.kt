package expo.modules.localdownloader.scheduler

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

/**
 * Behaviour of the download scheduler's gate.
 *
 * These are the guarantees the concurrency rests on: capacity is respected, a waiter
 * sleeps rather than spins, order is by expected duration, and a long job cannot be
 * starved for ever by a stream of short ones.
 */
class PriorityGateTest {

  /** A clock the test moves by hand, so aging can be tested without waiting. */
  private class TestClock(var now: Long = 0L) : () -> Long {
    override fun invoke(): Long = now
  }

  // ------------------------------------------------------------------ capacity

  @Test
  fun admitsUpToItsCapacityWithoutSuspending() = runBlocking {
    val gate = PriorityGate(permits = 3)
    repeat(3) { gate.acquire(priority = 1) }

    assertEquals(3, gate.inUse)
    assertEquals(0, gate.queued)
  }

  @Test
  fun theOneOverCapacityWaits() = runBlocking {
    val gate = PriorityGate(permits = 1)
    gate.acquire(priority = 1)

    val second = launch { gate.acquire(priority = 1) }
    // Let it reach the gate and park.
    while (gate.queued == 0) delay(1)

    assertEquals(1, gate.inUse)
    assertTrue(second.isActive)

    gate.release()
    withTimeout(1000) { second.join() }
    assertEquals(1, gate.inUse)
  }

  @Test
  fun neverAdmitsMoreThanCapacityUnderContention() = runBlocking(Dispatchers.Default) {
    val gate = PriorityGate(permits = 3)
    val concurrent = AtomicInteger(0)
    val peak = AtomicInteger(0)

    val jobs = (1..40).map { index ->
      launch {
        gate.withPermit(priority = index.toLong()) {
          val now = concurrent.incrementAndGet()
          peak.updateAndGet { previous -> maxOf(previous, now) }
          // Suspend inside the critical section so the overlap is real, not theoretical.
          delay(2)
          concurrent.decrementAndGet()
        }
      }
    }
    withTimeout(10_000) { jobs.forEach { it.join() } }

    assertTrue("peak was ${peak.get()}", peak.get() <= 3)
    assertEquals(0, gate.inUse)
    assertEquals(0, gate.queued)
  }

  // ------------------------------------------------------------------ ordering

  @Test
  fun theShortestWaitingJobGoesFirst() = runBlocking {
    // The point of ordering at all: a short share must not sit behind a long download
    // just because the long one was queued first.
    val gate = PriorityGate(permits = 1)
    gate.acquire(priority = 0)

    val order = Collections.synchronizedList(mutableListOf<String>())
    val durations = listOf("eight-hours" to 8L * 3600_000, "one-hour" to 3600_000L, "three-minutes" to 180_000L)
    val waiting = durations.map { (name, duration) ->
      launch {
        gate.acquire(priority = duration)
        order.add(name)
      }
    }
    while (gate.queued < durations.size) delay(1)

    // Hand the permit on one job at a time.
    repeat(durations.size) {
      gate.release()
      delay(20)
    }
    withTimeout(2000) { waiting.forEach { it.join() } }

    assertEquals(listOf("three-minutes", "one-hour", "eight-hours"), order.toList())
  }

  @Test
  fun equalDurationsKeepTheirArrivalOrder() = runBlocking {
    val clock = TestClock()
    val gate = PriorityGate(permits = 1, clock = clock)
    gate.acquire(priority = 0)

    val order = Collections.synchronizedList(mutableListOf<Int>())
    val waiting = (1..4).map { index ->
      val job = launch { gate.acquire(priority = 500); order.add(index) }
      while (gate.queued < index) delay(1)
      clock.now += 10
      job
    }

    repeat(4) { gate.release(); delay(20) }
    withTimeout(2000) { waiting.forEach { it.join() } }

    assertEquals(listOf(1, 2, 3, 4), order.toList())
  }

  // ------------------------------------------------------------------ starvation

  @Test
  fun aLongJobIsPromotedOnceItHasWaitedLongEnough() = runBlocking {
    // Without aging, a steady trickle of short jobs would keep an eight-hour track from
    // ever starting.
    val clock = TestClock()
    val gate = PriorityGate(permits = 1, agingMs = 10_000, clock = clock)
    gate.acquire(priority = 0)

    val order = Collections.synchronizedList(mutableListOf<String>())
    val long = launch { gate.acquire(priority = 8L * 3600_000); order.add("long") }
    while (gate.queued < 1) delay(1)

    // The long job has now been waiting past the aging threshold.
    clock.now += 20_000

    val short = launch { gate.acquire(priority = 60_000); order.add("short") }
    while (gate.queued < 2) delay(1)

    repeat(2) { gate.release(); delay(20) }
    withTimeout(2000) { listOf(long, short).forEach { it.join() } }

    assertEquals(listOf("long", "short"), order.toList())
  }

  @Test
  fun beforeItAgesTheLongJobStillYields() = runBlocking {
    // The mirror of the test above: aging must not fire early, or ordering by duration
    // would never take effect at all.
    val clock = TestClock()
    val gate = PriorityGate(permits = 1, agingMs = 10_000, clock = clock)
    gate.acquire(priority = 0)

    val order = Collections.synchronizedList(mutableListOf<String>())
    val long = launch { gate.acquire(priority = 8L * 3600_000); order.add("long") }
    while (gate.queued < 1) delay(1)
    clock.now += 5_000

    val short = launch { gate.acquire(priority = 60_000); order.add("short") }
    while (gate.queued < 2) delay(1)

    repeat(2) { gate.release(); delay(20) }
    withTimeout(2000) { listOf(long, short).forEach { it.join() } }

    assertEquals(listOf("short", "long"), order.toList())
  }

  @Test
  fun anUnknownDurationStillRunsEventually() = runBlocking {
    val clock = TestClock()
    val gate = PriorityGate(permits = 1, agingMs = 10_000, clock = clock)
    gate.acquire(priority = 0)

    val order = Collections.synchronizedList(mutableListOf<String>())
    val unknown = launch { gate.acquire(PriorityGate.UNKNOWN_PRIORITY); order.add("unknown") }
    while (gate.queued < 1) delay(1)
    clock.now += 20_000

    val short = launch { gate.acquire(priority = 1000); order.add("short") }
    while (gate.queued < 2) delay(1)

    repeat(2) { gate.release(); delay(20) }
    withTimeout(2000) { listOf(unknown, short).forEach { it.join() } }

    assertEquals(listOf("unknown", "short"), order.toList())
  }

  // ------------------------------------------------------------------ lifecycle

  @Test
  fun cancellingAWaiterFreesItsPlace() = runBlocking {
    val gate = PriorityGate(permits = 1)
    gate.acquire(priority = 0)

    val cancelled = launch { gate.acquire(priority = 1) }
    while (gate.queued == 0) delay(1)
    cancelled.cancel()
    withTimeout(1000) { cancelled.join() }

    assertEquals(0, gate.queued)

    // The permit must still be handed on correctly afterwards.
    val next = launch { gate.acquire(priority = 1) }
    while (gate.queued == 0) delay(1)
    gate.release()
    withTimeout(1000) { next.join() }
    assertEquals(1, gate.inUse)
  }

  @Test
  fun aFailingJobStillGivesItsPermitBack() = runBlocking {
    val gate = PriorityGate(permits = 1)

    runCatching {
      gate.withPermit(priority = 1) { throw IllegalStateException("boom") }
    }

    assertEquals(0, gate.inUse)
    // Proves the permit is genuinely reusable rather than merely counted back.
    withTimeout(1000) { gate.acquire(priority = 1) }
  }

  @Test
  fun stagesOfDifferentJobsOverlap() = runBlocking {
    // The whole reason the gates exist: one download writing to disk while another is
    // still being fetched. With a single shared gate this ordering is impossible.
    val stages = DownloadStages(fetch = PriorityGate(1), store = PriorityGate(1))
    val events = Collections.synchronizedList(mutableListOf<String>())

    val first = async(start = CoroutineStart.UNDISPATCHED) {
      stages.fetch.withPermit(1) { events.add("fetch-A") }
      stages.store.withPermit(1) {
        events.add("store-A-start")
        delay(50)
        events.add("store-A-end")
      }
    }
    // While A is in its store stage, B must be able to take the fetch permit A released.
    val second = async {
      delay(10)
      stages.fetch.withPermit(1) { events.add("fetch-B") }
    }

    withTimeout(5000) { listOf<Job>(first, second).forEach { it.join() } }

    val fetchB = events.indexOf("fetch-B")
    val storeAEnd = events.indexOf("store-A-end")
    assertTrue("expected B to fetch before A finished storing: $events", fetchB < storeAEnd)
  }
}
