package com.olivier.commandcenter.remote

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NeedsInputTest {
    private fun resource(name: String): String =
        requireNotNull(javaClass.classLoader?.getResourceAsStream(name)) { "missing $name" }.bufferedReader().readText()

    private fun JSONArray.toStrings() = (0 until length()).map { getString(it) }

    @Test
    fun followsTheSharedSnapshotSequence() {
        // test/fixtures/remote-proto/agents-sequence.json — one service lifetime.
        val steps = JSONObject(resource("agents-sequence.json")).getJSONArray("steps")
        val detector = NeedsInput()
        for (i in 0 until steps.length()) {
            val step = steps.getJSONObject(i)
            val snap = step.getJSONArray("snapshot")
            val agents = (0 until snap.length()).map { j ->
                val a = snap.getJSONObject(j)
                AgentStatus(a.getString("id"), a.getString("status"), a.getBoolean("dormant"))
            }
            val expect = step.getJSONObject("expect")
            val result = detector.apply(agents)
            assertEquals("step $i notify", expect.getJSONArray("notify").toStrings(), result.notify)
            assertEquals("step $i dismiss", expect.getJSONArray("dismiss").toStrings(), result.dismiss)
        }
    }

    @Test
    fun parsesAgentsFramesFromTheSharedFixtures() {
        val frames = JSONObject(resource("frames.json")).getJSONObject("serverToClient").getJSONArray("valid")
        assertEquals(
            listOf(AgentStatus("a1", "busy", false), AgentStatus("a2", "dead", true)),
            NeedsInput.parseAgents(frames.getJSONObject(0).toString()),
        )
        // Any other frame type (or junk) is not an agents frame.
        assertNull(NeedsInput.parseAgents(frames.getJSONObject(2).toString()))
        assertNull(NeedsInput.parseAgents("{nope"))
    }

    @Test
    fun labelsComeAlongForTheNotificationText() {
        val frame =
            """{"t":"agents","seq":1,"desktopUi":true,"list":[{"id":"a1","label":"main","status":"needs-input","dormant":false}]}"""
        assertEquals("main", NeedsInput.parseLabels(frame)["a1"])
    }
}
