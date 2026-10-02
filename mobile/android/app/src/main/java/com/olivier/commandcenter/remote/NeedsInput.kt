package com.olivier.commandcenter.remote

import org.json.JSONException
import org.json.JSONObject

data class AgentStatus(val id: String, val status: String, val dormant: Boolean)

/**
 * Decides which "needs input" notifications to show and dismiss from successive
 * agents snapshots (contract: test/fixtures/remote-proto/agents-sequence.json).
 *
 * One rule covers every case: notify agents that need input and aren't shown
 * yet, dismiss shown ones that no longer need input. So a reconnect doesn't
 * re-notify an agent whose notification is still up, and an agent that leaves
 * needs-input and comes back is notified again.
 */
class NeedsInput {
    data class Result(val notify: List<String>, val dismiss: List<String>)

    private val shown = LinkedHashSet<String>()

    fun apply(agents: List<AgentStatus>): Result {
        val needing = agents.filter { !it.dormant && it.status == "needs-input" }.map { it.id }
        val notify = needing.filter { it !in shown }
        val dismiss = shown.filter { it !in needing }
        shown.clear()
        shown.addAll(needing)
        return Result(notify, dismiss)
    }

    companion object {
        /** The agent statuses in an `agents` frame, or null for any other frame. */
        fun parseAgents(text: String): List<AgentStatus>? {
            val list = agentsList(text) ?: return null
            return (0 until list.length()).map { i ->
                val a = list.getJSONObject(i)
                AgentStatus(a.optString("id"), a.optString("status"), a.optBoolean("dormant"))
            }
        }

        /** id -> display label, for notification text. */
        fun parseLabels(text: String): Map<String, String> {
            val list = agentsList(text) ?: return emptyMap()
            return (0 until list.length()).associate { i ->
                val a = list.getJSONObject(i)
                a.optString("id") to a.optString("label")
            }
        }

        private fun agentsList(text: String) =
            try {
                val f = JSONObject(text)
                if (f.optString("t") == "agents") f.optJSONArray("list") else null
            } catch (e: JSONException) {
                null
            }
    }
}
