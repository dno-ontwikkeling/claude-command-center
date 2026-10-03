package com.olivier.commandcenter.remote

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

/**
 * Owns the pinned WebSocket to the desktop while the app is visible. It is a
 * thin transport: it authenticates (the token never reaches the WebView), keeps
 * the connection alive and forwards every frame unchanged to the WebView through
 * EventBus. There is no background service: with the app closed, alerts reach
 * the phone as FCM pushes (PushService) instead.
 *
 * Every entry point is posted to the main looper, as are all socket callbacks,
 * so ConnState is only ever touched from one thread.
 */
class RemoteConnection private constructor(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val conn = ConnState()
    private var socket: WebSocket? = null
    private var reconnect: Runnable? = null

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            main.post { if (conn.networkAvailable()) connectNow() }
        }
    }

    /** Send one protocol frame (JSON text) to the desktop. */
    fun send(text: String): Boolean = socket?.send(text) ?: false

    /** Tell the desktop this phone's FCM token, so it can push alerts. */
    fun registerPush(token: String) {
        main.post {
            if (conn.state == State.Connected) {
                socket?.send(JSONObject().put("t", "push-register").put("token", token).toString())
            }
        }
    }

    private var watchingNetwork = false

    private fun begin() {
        if (!watchingNetwork) {
            context.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback)
            watchingNetwork = true
        }
        connectNow()
    }

    private fun connectNow() {
        reconnect?.let { main.removeCallbacks(it) }
        reconnect = null
        val creds = CredStore(context).load()
        if (creds == null) {
            shutdown("unpaired")
            return
        }
        val pin = try {
            CertPin.parse(creds.certSha256)
        } catch (e: IllegalArgumentException) {
            shutdown("unpaired")
            return
        }
        socket?.cancel()
        val gen = conn.connecting()
        EventBus.state("connecting")
        socket = PinnedSocket.connect(creds.url, creds.token, pin, Listener(gen))
    }

    private inner class Listener(private val gen: Int) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            main.post {
                conn.opened(gen)
                if (conn.state == State.Connected) {
                    EventBus.state("connected")
                    PushToken.fetch(context) { registerPush(it) }
                }
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            main.post { EventBus.message(text) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            main.post { ended(gen, Failures.ofClose(code)) }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            main.post { ended(gen, Failures.ofClose(code)) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            main.post { ended(gen, Failures.of(t, response?.code)) }
        }
    }

    private fun ended(gen: Int, failure: Failure) {
        val delay = conn.failed(gen, failure) ?: run {
            // Stale generation, or terminal.
            when (conn.state) {
                State.AuthFailed -> shutdown("auth-failed")
                State.Kicked -> shutdown("kicked")
                else -> Unit
            }
            return
        }
        EventBus.state("offline", (delay / 1000).toString())
        reconnect = Runnable { connectNow() }.also { main.postDelayed(it, delay) }
    }

    private fun shutdown(state: String) {
        conn.stop()
        reconnect?.let { main.removeCallbacks(it) }
        socket?.close(1000, null)
        socket = null
        if (watchingNetwork) {
            runCatching { context.getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback) }
            watchingNetwork = false
        }
        if (instance === this) instance = null
        EventBus.state(state)
    }

    companion object {
        @Volatile var instance: RemoteConnection? = null
            private set

        /** Connect (or reconnect) with the stored pairing. */
        fun start(context: Context) {
            val c = instance ?: RemoteConnection(context.applicationContext).also { instance = it }
            c.main.post { c.begin() }
        }

        fun stop(context: Context) {
            val c = instance ?: return
            c.main.post { c.shutdown("idle") }
        }
    }
}
