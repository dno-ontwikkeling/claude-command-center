package com.olivier.commandcenter.remote

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Receives the desktop's pushes while the app is closed or in the background. */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        Alert.parse(message.data)?.let { AlertNotifier(applicationContext).handle(it) }
    }

    override fun onNewToken(token: String) {
        PushToken.store(applicationContext, token)
        // Connected right now: tell the desktop at once. Otherwise the next connect does.
        RemoteConnection.instance?.registerPush(token)
    }
}
