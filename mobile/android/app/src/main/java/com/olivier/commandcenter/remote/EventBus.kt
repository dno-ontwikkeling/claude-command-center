package com.olivier.commandcenter.remote

/**
 * Process-wide hand-off from RemoteService (which owns the socket) to
 * RemoteLinkPlugin (which talks to the WebView). A Service has no reference to
 * the plugin instance, and the WebView may not exist at all while the service
 * keeps running in the background — so the plugin attaches/detaches a listener,
 * and the last state is kept for getState() when the UI comes back.
 */
object EventBus {
    interface Listener {
        fun onMessage(text: String)
        fun onState(state: String, detail: String?)
    }

    @Volatile var listener: Listener? = null

    @Volatile var lastState: String = "idle"
        private set

    @Volatile var lastDetail: String? = null
        private set

    fun message(text: String) {
        listener?.onMessage(text)
    }

    fun state(state: String, detail: String? = null) {
        lastState = state
        lastDetail = detail
        listener?.onState(state, detail)
    }
}
