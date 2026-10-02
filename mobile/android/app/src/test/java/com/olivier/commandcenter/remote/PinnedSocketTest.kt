package com.olivier.commandcenter.remote

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.security.MessageDigest
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

class PinnedSocketTest {
    private val server = MockWebServer()

    @Before
    fun setUp() {
        server.start()
    }

    @After
    fun tearDown() {
        server.close()
    }

    private fun serve(held: HeldCertificate, vararg chain: java.security.cert.X509Certificate) {
        val certs = HandshakeCertificates.Builder().heldCertificate(held, *chain).build()
        server.useHttps(certs.sslSocketFactory())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {}).build())
    }

    private fun pinOf(held: HeldCertificate): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(held.certificate.encoded)

    // Connects and returns "open" or the failure.
    private fun connect(pin: ByteArray, token: String = "t".repeat(64)): Any {
        val events = LinkedBlockingQueue<Any>()
        // 127.0.0.1, not "localhost": a multi-address name makes OkHttp try the
        // next route after the TLS failure and report that route's error instead.
        val url = "wss://127.0.0.1:${server.port}/"
        PinnedSocket.connect(url, token, pin, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                events.add("open")
                webSocket.close(1000, null)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                events.add(t)
            }
        })
        return requireNotNull(events.poll(10, TimeUnit.SECONDS)) { "no event within 10s" }
    }

    private fun selfSigned(cn: String) =
        HeldCertificate.Builder().commonName(cn).addSubjectAlternativeName(server.hostName).build()

    @Test
    fun pinnedSelfSignedCertConnectsAndSendsAuthHeaders() {
        val held = selfSigned("cc")
        serve(held)
        assertEquals("open", connect(pinOf(held), token = "a".repeat(64)))
        val req = server.takeRequest()
        assertEquals("Bearer " + "a".repeat(64), req.headers["Authorization"])
        assertEquals("1", req.headers["x-cc-proto"])
    }

    @Test
    fun aDifferentCertIsRejected() {
        serve(selfSigned("impostor"))
        val result = connect(pinOf(selfSigned("the-real-one")))
        assertTrue("expected TLS failure, got $result", result is SSLException)
    }

    @Test
    fun aCaSignedLeafIsRejectedWhenOnlyTheCaIsPinned() {
        // Pinning is leaf-only: trusting the issuer must not trust its leaves.
        val root = HeldCertificate.Builder().commonName("root").certificateAuthority(0).build()
        val leaf = HeldCertificate.Builder().commonName("leaf")
            .addSubjectAlternativeName(server.hostName).signedBy(root).build()
        serve(leaf, root.certificate)
        val result = connect(pinOf(root))
        assertTrue("expected TLS failure, got $result", result is SSLException)
    }

    @Test
    fun clientUsesKeepalivePingsAndNoReadTimeout() {
        val client = PinnedSocket.client(ByteArray(32))
        assertEquals(25_000, client.pingIntervalMillis)
        assertEquals(0, client.readTimeoutMillis)
        assertNotNull(client.sslSocketFactory)
    }
}
