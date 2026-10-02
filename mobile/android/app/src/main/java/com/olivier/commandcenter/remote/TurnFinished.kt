package com.olivier.commandcenter.remote

/**
 * "Agent finished" notifications from successive agents snapshots: notify when
 * an agent goes from working (busy / needs-input) to finished (done / unseen,
 * the desktop's Stop-hook states); dismiss once it works again, sleeps or
 * disappears. The first snapshot only records state, so connecting to agents
 * that finished long ago doesn't notify.
 */
class TurnFinished {
    data class Result(val notify: List<String>, val dismiss: List<String>)

    private var last: Map<String, String>? = null
    private val shown = LinkedHashSet<String>()

    fun apply(agents: List<AgentStatus>): Result {
        val live = agents.filter { !it.dormant }.associate { it.id to it.status }
        val prev = last
        last = live
        val notify =
            if (prev == null) emptyList()
            else live.filter { (id, st) -> st in FINISHED && prev[id] in WORKING && id !in shown }.keys.toList()
        val dismiss = shown.filter { id -> live[id] == null || live[id] !in FINISHED }
        shown.removeAll(dismiss.toSet())
        shown.addAll(notify)
        return Result(notify, dismiss)
    }

    private companion object {
        val WORKING = setOf("busy", "needs-input")
        val FINISHED = setOf("done", "unseen")
    }
}
