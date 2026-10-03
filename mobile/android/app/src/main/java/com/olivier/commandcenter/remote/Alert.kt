package com.olivier.commandcenter.remote

/**
 * A push from the desktop (FCM data message), decoded. The desktop decides
 * what to notify (pushnotify.js); the phone only shows or clears it.
 */
sealed class Alert {
    /** An agent needs input (kind "needs-input") or finished its turn ("finished"). */
    data class Show(val kind: String, val agentId: String, val label: String?) : Alert()

    /** Clear the notification of that kind for an agent. */
    data class Dismiss(val kind: String, val agentId: String) : Alert()

    /** "Send test" from the desktop settings. */
    object Test : Alert()

    companion object {
        private val KINDS = setOf("needs-input", "finished")

        /** The alert in an FCM data payload, or null for anything unrecognised. */
        fun parse(data: Map<String, String>): Alert? {
            val agentId = data["agentId"]?.takeIf { it.isNotEmpty() }
            return when (val type = data["type"]) {
                "test" -> Test
                in KINDS -> agentId?.let { Show(type!!, it, data["label"]?.ifBlank { null }) }
                "dismiss" -> {
                    val kind = data["kind"]
                    if (agentId != null && kind in KINDS) Dismiss(kind!!, agentId) else null
                }
                else -> null
            }
        }
    }
}
