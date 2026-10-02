package com.olivier.commandcenter.remote

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.X509TrustManager

/**
 * The desktop's self-signed certificate is trusted by exact pin only: SHA-256
 * of the leaf certificate's DER bytes, as carried in the pairing QR (the
 * desktop's normalized X509Certificate.fingerprint256). There is no CA, no
 * hostname check and no expiry check: the pin alone identifies the PC.
 */
object CertPin {
    /** Accepts "ab12..." or Node-style "AB:12:...". Throws on anything but 32 bytes of hex. */
    fun parse(fingerprint: String): ByteArray {
        val hex = fingerprint.replace(":", "").lowercase()
        require(hex.length == 64 && hex.all { it in '0'..'9' || it in 'a'..'f' }) {
            "certificate fingerprint must be 32 bytes of hex"
        }
        return ByteArray(32) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    fun sha256(der: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(der)

    /** Constant-time comparison of the leaf's hash with the pin. */
    fun matches(cert: X509Certificate, pin: ByteArray): Boolean = MessageDigest.isEqual(sha256(cert.encoded), pin)
}

/**
 * Trusts exactly one certificate: the pinned leaf. Never a trust-all manager:
 * an empty chain, a different leaf, or a CA-signed leaf whose issuer is the
 * pinned cert all fail. Client auth is never used here, so it always fails.
 */
class PinTrustManager(private val pin: ByteArray) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        if (chain.isEmpty()) throw CertificateException("empty certificate chain")
        if (!CertPin.matches(chain[0], pin)) throw CertificateException("certificate does not match the paired PC")
    }

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("client certificates are not supported")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
