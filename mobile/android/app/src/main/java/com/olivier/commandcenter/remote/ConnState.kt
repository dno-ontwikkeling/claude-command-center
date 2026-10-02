package com.olivier.commandcenter.remote

import javax.net.ssl.SSLException
import kotlin.math.min
import kotlin.random.Random

/** What a connection failure means for reconnecting. */
enum class Failure {
    /** Network trouble: retry with backoff. */
    RETRY,
    /** Wrong token, revoked pairing, protocol mismatch or cert pin mismatch: stop, re-pair. */
    AUTH,
    /** "Disconnect all" on the desktop: stop, but the pairing is still valid. */
    KICKED,
}

object Failures {
    /** Classify an OkHttp onFailure (exception + HTTP status of the upgrade response, if any). */
    fun of(t: Throwable, responseCode: Int?): Failure {
        if (responseCode == 401 || responseCode == 426) return Failure.AUTH
        return if (hasTlsFailure(t, HashSet())) Failure.AUTH else Failure.RETRY
    }

    /** Classify a close frame from the desktop. */
    fun ofClose(code: Int): Failure =
        when (code) {
            4001, 4002 -> Failure.AUTH
            4003 -> Failure.KICKED
            else -> Failure.RETRY
        }

    // Walk causes AND suppressed: with a multi-address host OkHttp reports the
    // last route's ConnectException and keeps the TLS rejection in suppressed.
    private fun hasTlsFailure(t: Throwable?, seen: MutableSet<Throwable>): Boolean {
        if (t == null || !seen.add(t)) return false
        if (t is SSLException) return true
        return hasTlsFailure(t.cause, seen) || t.suppressed.any { hasTlsFailure(it, seen) }
    }
}

sealed class State {
    object Idle : State()
    object Connecting : State()
    object Connected : State()
    data class Offline(val retryInMs: Long) : State()
    object AuthFailed : State()
    object Kicked : State()

    override fun toString(): String = javaClass.simpleName
}

/**
 * Reconnect state machine, free of Android and OkHttp so it is unit tested.
 * Every connection attempt gets a generation number; only the first terminal
 * callback of the current generation counts, so OkHttp's onFailure and
 * onClosed can never both schedule a reconnect.
 */
class ConnState(
    private val random: Random = Random.Default,
    private val now: () -> Long = System::currentTimeMillis,
    private val baseMs: Long = 1_000,
    private val capMs: Long = 30_000,
    private val stableMs: Long = 10_000,
) {
    var state: State = State.Idle
        private set

    private var generation = 0
    private var attempt = 0
    private var connectedAt = 0L

    /** Starting a connection; returns its generation. */
    fun connecting(): Int {
        generation++
        state = State.Connecting
        return generation
    }

    fun opened(gen: Int) {
        if (gen != generation) return
        state = State.Connected
        connectedAt = now()
    }

    /**
     * The connection of [gen] ended. Returns the reconnect delay in ms, or null
     * when no reconnect should be scheduled (terminal failure, or a stale /
     * already-handled generation).
     */
    fun failed(gen: Int, failure: Failure): Long? {
        if (gen != generation) return null
        generation++ // later callbacks for this connection are stale
        val wasStable = state == State.Connected && now() - connectedAt >= stableMs
        return when (failure) {
            Failure.AUTH -> {
                state = State.AuthFailed
                null
            }
            Failure.KICKED -> {
                state = State.Kicked
                null
            }
            Failure.RETRY -> {
                if (wasStable) attempt = 0
                // Full jitter: uniform in [0, min(cap, base * 2^attempt)].
                val ceiling = min(capMs, baseMs shl min(attempt, 20))
                attempt++
                val delay = random.nextLong(0, ceiling + 1)
                state = State.Offline(delay)
                delay
            }
        }
    }

    /** User disconnected / unpaired: drop the in-flight connection. */
    fun stop() {
        generation++
        attempt = 0
        state = State.Idle
    }

    /** The network came back: reset backoff; true if the caller should reconnect now. */
    fun networkAvailable(): Boolean {
        attempt = 0
        return state is State.Offline
    }
}
