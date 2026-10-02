package com.olivier.commandcenter.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class TurnFinishedTest {
    private fun s(id: String, status: String, dormant: Boolean = false) = AgentStatus(id, status, dormant)

    @Test
    fun notifiesWhenAWorkingAgentFinishes() {
        val t = TurnFinished()
        assertEquals(TurnFinished.Result(emptyList(), emptyList()), t.apply(listOf(s("a1", "busy"))))
        assertEquals(TurnFinished.Result(listOf("a1"), emptyList()), t.apply(listOf(s("a1", "unseen"))))
        // Still finished: not notified twice.
        assertEquals(TurnFinished.Result(emptyList(), emptyList()), t.apply(listOf(s("a1", "done"))))
    }

    @Test
    fun aQuestionAnsweredAndFinishedCountsToo() {
        val t = TurnFinished()
        t.apply(listOf(s("a1", "needs-input")))
        assertEquals(listOf("a1"), t.apply(listOf(s("a1", "done"))).notify)
    }

    @Test
    fun theFirstSnapshotNeverNotifies() {
        // Connecting to agents that finished long ago is not news.
        val t = TurnFinished()
        assertEquals(emptyList<String>(), t.apply(listOf(s("a1", "unseen"))).notify)
    }

    @Test
    fun workingAgainDismissesTheNotification() {
        val t = TurnFinished()
        t.apply(listOf(s("a1", "busy")))
        t.apply(listOf(s("a1", "done")))
        assertEquals(TurnFinished.Result(emptyList(), listOf("a1")), t.apply(listOf(s("a1", "busy"))))
    }

    @Test
    fun sleepingOrRemovedAgentsAreDismissedAndIgnored() {
        val t = TurnFinished()
        t.apply(listOf(s("a1", "busy"), s("a2", "busy")))
        t.apply(listOf(s("a1", "done"), s("a2", "done")))
        val r = t.apply(listOf(s("a1", "dead", dormant = true)))
        assertEquals(emptyList<String>(), r.notify)
        assertEquals(listOf("a1", "a2"), r.dismiss.sorted())
    }
}
