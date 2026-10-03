package com.olivier.commandcenter.remote

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

/** Shows and clears the notifications for [Alert]s. Tapping one opens that agent. */
class AlertNotifier(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    fun handle(alert: Alert) {
        ensureChannel()
        when (alert) {
            is Alert.Show -> show(alert)
            is Alert.Dismiss -> manager.cancel(notificationId(alert.kind, alert.agentId))
            Alert.Test -> manager.notify(ID_TEST, build("CommandCenter alerts work", "This is a test from your PC.", null, true))
        }
    }

    private fun show(alert: Alert.Show) {
        val who = alert.label ?: "An agent"
        val title = if (alert.kind == "needs-input") "$who needs your input" else "$who finished"
        manager.notify(
            notificationId(alert.kind, alert.agentId),
            build(title, "Tap to open the terminal.", alert.agentId, alert.kind == "needs-input"),
        )
    }

    private fun build(title: String, text: String, agentId: String?, urgent: Boolean) =
        NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(if (urgent) android.R.drawable.ic_dialog_alert else android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (urgent) NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(agentId))
            .build()

    private fun openAppIntent(agentId: String?): PendingIntent {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (agentId != null) putExtra(EXTRA_AGENT_ID, agentId)
        }
        return PendingIntent.getActivity(
            context,
            agentId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun ensureChannel() {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Agent alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "An agent on your PC needs input or finished."
            },
        )
    }

    companion object {
        const val EXTRA_AGENT_ID = "agentId"
        private const val CHANNEL = "needs_input"
        private const val ID_TEST = 2
        private const val BASE = 1000

        // Separate ranges, so "finished" and "needs input" don't replace each other.
        fun notificationId(kind: String, agentId: String) =
            BASE + (if (kind == "finished") 0x10000 else 0) + (agentId.hashCode() and 0xFFFF)
    }
}
