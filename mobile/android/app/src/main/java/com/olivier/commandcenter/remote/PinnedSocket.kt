package com.olivier.commandcenter.remote

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext

/**
 * OkHttp WebSocket to the desktop, trusting only the pinned certificate.
 * Auth goes in the upgrade request (Authorization: Bearer), so the desktop
 * rejects a bad token with HTTP 401 before any WebSocket exists.
 */
object PinnedSocket {
    const val PROTO_VERSION = "1"
    private const val PING_SECONDS = 25L

    /** A dedicated client per pin — never reused for any other host. */
    fun client(pin: ByteArray): OkHttpClient {
        val tm = PinTrustManager(pin)
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
        return OkHttpClient.Builder()
            .sslSocketFactory(ctx.socketFactory, tm)
            // Connecting by IP or DDNS name: the hostname cannot be verified
            // against the self-signed cert. Safe ONLY because PinTrustManager is
            // the sole trust path on this client.
            .hostnameVerifier { _, _ -> true }
            // Detects half-open sockets (PC asleep, network changed): a missed
            // pong fails the socket within about two intervals.
            .pingInterval(PING_SECONDS, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }

    fun request(url: String, token: String): Request =
        Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("x-cc-proto", PROTO_VERSION)
            .build()

    fun connect(url: String, token: String, pin: ByteArray, listener: WebSocketListener): WebSocket =
        client(pin).newWebSocket(request(url, token), listener)
}
