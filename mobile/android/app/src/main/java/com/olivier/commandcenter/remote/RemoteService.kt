package com.olivier.commandcenter.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * Foreground service that owns the pinned WebSocket to the desktop, so the
 * link (and needs-input notifications) survive the app being backgrounded or
 * the phone being locked. It is a thin transport: it authenticates (the token
 * never reaches the WebView), keeps the connection alive, looks at `agents`
 * frames only to raise/clear needs-input notifications, and forwards every
 * frame unchanged to the WebView through EventBus.
 *
 * All socket callbacks are posted to the main looper, so ConnState and the
 * notification bookkeeping are only ever touched from one thread.
 */
class RemoteService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val conn = ConnState()
    private val needsInput = NeedsInput()
    private var socket: WebSocket? = null
    private var reconnect: Runnable? = null
    private lateinit var notifications: NotificationManager

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            main.post { if (conn.networkAvailable()) connectNow() }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(
            NotificationChannel(CHANNEL_LINK, "Connection to PC", NotificationManager.IMPORTANCE_LOW),
        )
        notifications.createNotificationChannel(
            NotificationChannel(CHANNEL_INPUT, "Agent needs input", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "An agent on your PC is waiting for you."
            },
        )
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISCONNECT -> {
                shutdown("idle")
                return START_NOT_STICKY
            }
            else -> {
                val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
                ServiceCompat.startForeground(this, ID_LINK, linkNotification("Connecting…"), type)
                connectNow()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        conn.stop()
        reconnect?.let { main.removeCallbacks(it) }
        socket?.close(1000, null)
        socket = null
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback) }
        instance = null
        super.onDestroy()
    }

    /** Send one protocol frame (JSON text) to the desktop. */
    fun send(text: String): Boolean = socket?.send(text) ?: false

    private fun connectNow() {
        reconnect?.let { main.removeCallbacks(it) }
        reconnect = null
        val creds = CredStore(this).load()
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
        publish("connecting")
        socket = PinnedSocket.connect(creds.url, creds.token, pin, Listener(gen))
    }

    private inner class Listener(private val gen: Int) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            main.post {
                conn.opened(gen)
                if (conn.state == State.Connected) publish("connected")
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            main.post {
                NeedsInput.parseAgents(text)?.let { agents ->
                    val labels = NeedsInput.parseLabels(text)
                    val result = needsInput.apply(agents)
                    result.dismiss.forEach { notifications.cancel(notificationId(it)) }
                    result.notify.forEach { postNeedsInput(it, labels[it]) }
                }
                EventBus.message(text)
            }
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
                State.AuthFailed -> {
                    postInfo("Re-pair needed", "The PC no longer accepts this phone. Scan a new pairing QR.")
                    shutdown("auth-failed")
                }
                State.Kicked -> shutdown("kicked")
                else -> Unit
            }
            return
        }
        publish("offline", (delay / 1000).toString())
        updateLink("PC offline — reconnecting")
        reconnect = Runnable { connectNow() }.also { main.postDelayed(it, delay) }
    }

    private fun publish(state: String, detail: String? = null) {
        EventBus.state(state, detail)
        when (state) {
            "connecting" -> updateLink("Connecting…")
            "connected" -> updateLink("Connected to PC")
        }
    }

    private fun shutdown(state: String) {
        conn.stop()
        reconnect?.let { main.removeCallbacks(it) }
        socket?.close(1000, null)
        socket = null
        EventBus.state(state)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ---- notifications ------------------------------------------------------

    private fun openAppIntent(agentId: String?): PendingIntent {
        val intent = packageManager.getLaunchIntentForPackage(packageName)!!.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (agentId != null) putExtra(EXTRA_AGENT_ID, agentId)
        }
        return PendingIntent.getActivity(
            this,
            agentId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun linkNotification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_LINK)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("CC Remote")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(openAppIntent(null))
            .build()

    private fun updateLink(text: String) {
        notifications.notify(ID_LINK, linkNotification(text))
    }

    private fun postNeedsInput(agentId: String, label: String?) {
        val n = NotificationCompat.Builder(this, CHANNEL_INPUT)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("${label?.ifBlank { null } ?: "An agent"} needs your input")
            .setContentText("Tap to open the terminal.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(agentId))
            .build()
        notifications.notify(notificationId(agentId), n)
    }

    private fun postInfo(title: String, text: String) {
        val n = NotificationCompat.Builder(this, CHANNEL_INPUT)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(null))
            .build()
        notifications.notify(ID_INFO, n)
    }

    private fun notificationId(agentId: String) = NOTIFY_BASE + (agentId.hashCode() and 0xFFFF)

    companion object {
        const val ACTION_CONNECT = "com.olivier.commandcenter.remote.CONNECT"
        const val ACTION_DISCONNECT = "com.olivier.commandcenter.remote.DISCONNECT"
        const val EXTRA_AGENT_ID = "agentId"
        private const val CHANNEL_LINK = "link"
        private const val CHANNEL_INPUT = "needs_input"
        private const val ID_LINK = 1
        private const val ID_INFO = 2
        private const val NOTIFY_BASE = 1000

        @Volatile var instance: RemoteService? = null
            private set

        fun start(context: Context) {
            // Must be called while the app is visible (Android 12+ blocks
            // starting a foreground service from the background).
            ContextCompat.startForegroundService(
                context,
                Intent(context, RemoteService::class.java).setAction(ACTION_CONNECT),
            )
        }

        fun stop(context: Context) {
            if (instance == null) return
            context.startService(Intent(context, RemoteService::class.java).setAction(ACTION_DISCONNECT))
        }
    }
}
