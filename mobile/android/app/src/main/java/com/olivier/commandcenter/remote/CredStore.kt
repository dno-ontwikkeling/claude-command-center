package com.olivier.commandcenter.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The pairing (desktop URL, token, cert pin), encrypted at rest with an
 * AES-256-GCM key held in the Android Keystore (the key never leaves it).
 * Replaces the deprecated EncryptedSharedPreferences. Backups are disabled in
 * the manifest, so the ciphertext can't be restored onto another device either.
 */
class CredStore(context: Context) {
    data class Creds(val url: String, val token: String, val certSha256: String)

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(creds: Creds) {
        val plain = JSONObject()
            .put("url", creds.url)
            .put("token", creds.token)
            .put("certSha256", creds.certSha256)
            .toString()
            .toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val blob = cipher.iv + cipher.doFinal(plain)
        prefs.edit().putString(KEY_CREDS, Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
    }

    /** The stored pairing, or null if none (or it can no longer be decrypted). */
    fun load(): Creds? {
        val stored = prefs.getString(KEY_CREDS, null) ?: return null
        return try {
            val blob = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob, 0, IV_BYTES))
            val json = JSONObject(String(cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES), Charsets.UTF_8))
            Creds(json.getString("url"), json.getString("token"), json.getString("certSha256"))
        } catch (e: Exception) {
            // Key invalidated (e.g. lock screen reset) or corrupt blob: treat as unpaired.
            null
        }
    }

    fun clear() {
        prefs.edit().remove(KEY_CREDS).apply()
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // The foreground service must reconnect with the screen locked.
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return gen.generateKey()
    }

    private companion object {
        const val PREFS = "cc_remote"
        const val KEY_CREDS = "creds"
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "cc_remote_creds"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
