package com.olivier.commandcenter.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import kotlin.random.Random

class ConnStateTest {
    // ---- failure classification ---------------------------------------------

    @Test
    fun httpAuthAndVersionRejectionsAreTerminal() {
        assertEquals(Failure.AUTH, Failures.of(IOException("x"), 401))
        assertEquals(Failure.AUTH, Failures.of(IOException("x"), 426))
    }

    @Test
    fun tlsFailuresAreTerminalWhereverTheyHideInTheChain() {
        assertEquals(Failure.AUTH, Failures.of(SSLHandshakeException("pin"), null))
        assertEquals(Failure.AUTH, Failures.of(SSLPeerUnverifiedException("pin"), null))
        assertEquals(Failure.AUTH, Failures.of(IOException("wrap", SSLHandshakeException("pin")), null))
        // Multi-address host: OkHttp reports the last route's error; the TLS
        // rejection only sits in suppressed.
        val lastRoute = ConnectException("Failed to connect to ::1")
        lastRoute.addSuppressed(SSLHandshakeException("pin"))
        assertEquals(Failure.AUTH, Failures.of(lastRoute, null))
    }

    @Test
    fun plainNetworkErrorsRetry() {
        assertEquals(Failure.RETRY, Failures.of(ConnectException("refused"), null))
        assertEquals(Failure.RETRY, Failures.of(IOException("reset"), 502))
    }

    @Test
    fun closeCodes() {
        assertEquals(Failure.AUTH, Failures.ofClose(4001))
        assertEquals(Failure.AUTH, Failures.ofClose(4002))
        assertEquals(Failure.KICKED, Failures.ofClose(4003))
        for (c in listOf(1000, 1001, 1006, 1011, 1012, 1013)) assertEquals(Failure.RETRY, Failures.ofClose(c))
    }

    // ---- state machine ------------------------------------------------------

    private class Clock(var t: Long = 0) {
        fun now() = t
    }

    private fun machine(clock: Clock = Clock(), seed: Int = 7) = ConnState(Random(seed), clock::now)

    @Test
    fun backoffIsFullJitterBoundedByExponentAndCap() {
        val m = machine()
        val ceilings = listOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L, 30000L, 30000L)
        for (ceiling in ceilings) {
            val delay = m.failed(m.connecting(), Failure.RETRY)!!
            assertTrue("delay $delay <= $ceiling", delay in 0..ceiling)
            assertTrue(m.state is State.Offline)
        }
    }

    @Test
    fun aConnectionThatStayedUpResetsTheBackoff() {
        val clock = Clock()
        val m = machine(clock)
        repeat(6) { m.failed(m.connecting(), Failure.RETRY) } // ceiling now 30s
        val gen = m.connecting()
        m.opened(gen)
        assertEquals(State.Connected, m.state)
        clock.t += 10_000
        val delay = m.failed(gen, Failure.RETRY)!!
        assertTrue("reset to the first ceiling, got $delay", delay <= 1000)
    }

    @Test
    fun aShortLivedConnectionKeepsTheBackoffGrowing() {
        // Across seeds, the 6th attempt after a 2s connection must be able to
        // exceed the first ceiling (i.e. it was not reset).
        val delays = (1..20).map { seed ->
            val clock = Clock()
            val m = machine(clock, seed)
            repeat(5) { m.failed(m.connecting(), Failure.RETRY) }
            val gen = m.connecting()
            m.opened(gen)
            clock.t += 2_000
            m.failed(gen, Failure.RETRY)!!
        }
        assertTrue(delays.any { it > 1000 })
        assertTrue(delays.all { it <= 30_000 })
    }

    @Test
    fun authFailureAndKickNeverRetry() {
        val m = machine()
        assertNull(m.failed(m.connecting(), Failure.AUTH))
        assertEquals(State.AuthFailed, m.state)
        val k = machine()
        assertNull(k.failed(k.connecting(), Failure.KICKED))
        assertEquals(State.Kicked, k.state)
    }

    @Test
    fun onlyOneCallbackPerConnectionCountsSoFailureAndCloseNeverDoubleReconnect() {
        val m = machine()
        val gen = m.connecting()
        assertNotNull(m.failed(gen, Failure.RETRY))
        assertNull(m.failed(gen, Failure.RETRY)) // e.g. onClosed after onFailure
    }

    @Test
    fun stopInvalidatesTheInFlightConnection() {
        val m = machine()
        val gen = m.connecting()
        m.stop()
        assertEquals(State.Idle, m.state)
        assertNull(m.failed(gen, Failure.RETRY))
        m.opened(gen)
        assertEquals(State.Idle, m.state)
    }

    @Test
    fun networkComingBackResetsBackoffAndReconnectsOnlyWhenOffline() {
        val m = machine()
        repeat(4) { m.failed(m.connecting(), Failure.RETRY) }
        assertTrue(m.networkAvailable())
        assertTrue(m.failed(m.connecting(), Failure.RETRY)!! <= 1000)
        val auth = machine()
        auth.failed(auth.connecting(), Failure.AUTH)
        assertFalse(auth.networkAvailable())
    }
}
