package com.olivier.commandcenter.remote

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/**
 * This phone's FCM registration token. The desktop needs it to push alerts, so
 * it is sent right after every connect (and when Firebase rotates it).
 * Builds without google-services.json have no Firebase app: no token, no push,
 * everything else still works.
 */
object PushToken {
    private const val PREFS = "cc_push"
    private const val KEY = "token"

    fun available(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    fun stored(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)

    fun store(context: Context, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, token).apply()
    }

    /** The current token (stored, then refreshed from Firebase); [onToken] runs for each. */
    fun fetch(context: Context, onToken: (String) -> Unit) {
        stored(context)?.let(onToken)
        if (!available(context)) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (token != null) {
                store(context, token)
                onToken(token)
            }
        }
    }
}
