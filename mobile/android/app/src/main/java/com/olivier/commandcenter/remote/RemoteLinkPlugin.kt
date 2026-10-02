package com.olivier.commandcenter.remote

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Bridge between the WebView (www/js/remote-link.mjs) and RemoteService.
 *
 * Methods: connect({url,token,certSha256}?) — with a pairing it is validated
 * and stored first, without one the stored pairing is used; disconnect;
 * unpair; send({text}); getState; requestNotificationPermission;
 * requestBatteryExemption.
 * Events: message {text}, state {state, detail}, notificationTap {agentId}.
 */
@CapacitorPlugin(
    name = "RemoteLink",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")],
)
class RemoteLinkPlugin : Plugin() {
    private val creds by lazy { CredStore(context) }

    override fun load() {
        EventBus.listener = object : EventBus.Listener {
            override fun onMessage(text: String) {
                notifyListeners("message", JSObject().put("text", text))
            }

            override fun onState(state: String, detail: String?) {
                notifyListeners("state", JSObject().put("state", state).put("detail", detail), true)
            }
        }
        // Cold start from a needs-input notification.
        activity?.intent?.let { deliverTap(it) }
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        deliverTap(intent)
    }

    override fun handleOnDestroy() {
        EventBus.listener = null
        super.handleOnDestroy()
    }

    private fun deliverTap(intent: Intent) {
        val agentId = intent.getStringExtra(RemoteService.EXTRA_AGENT_ID) ?: return
        intent.removeExtra(RemoteService.EXTRA_AGENT_ID) // deliver once
        notifyListeners("notificationTap", JSObject().put("agentId", agentId), true)
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val url = call.getString("url")
        if (url != null) {
            val token = call.getString("token").orEmpty()
            val cert = call.getString("certSha256").orEmpty()
            if (!url.startsWith("wss://")) return call.reject("Pairing URL must be wss://")
            if (!Regex("^[0-9a-f]{64}$").matches(token)) return call.reject("Invalid pairing token")
            try {
                CertPin.parse(cert)
            } catch (e: IllegalArgumentException) {
                return call.reject("Invalid certificate fingerprint")
            }
            creds.save(CredStore.Creds(url, token, cert))
        } else if (creds.load() == null) {
            return call.reject("Not paired")
        }
        RemoteService.start(context)
        call.resolve()
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        RemoteService.stop(context)
        call.resolve()
    }

    @PluginMethod
    fun unpair(call: PluginCall) {
        RemoteService.stop(context)
        creds.clear()
        EventBus.state("unpaired")
        call.resolve()
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("text is required")
        val sent = RemoteService.instance?.send(text) ?: false
        call.resolve(JSObject().put("sent", sent))
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        val stored = creds.load()
        val running = RemoteService.instance != null
        val state = if (running) EventBus.lastState else if (stored == null) "unpaired" else EventBus.lastState
        call.resolve(
            JSObject()
                .put("state", state)
                .put("detail", EventBus.lastDetail)
                .put("paired", stored != null)
                .put("url", stored?.url),
        )
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("notifications", call, "notificationsCallback")
        }
    }

    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }

    /** Ask to be exempt from battery optimisation so Doze doesn't stall the link. */
    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        val pm = context.getSystemService(PowerManager::class.java)
        val ignoring = pm.isIgnoringBatteryOptimizations(context.packageName)
        if (!ignoring) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:${context.packageName}"))
            activity.startActivity(intent)
        }
        call.resolve(JSObject().put("ignoring", ignoring))
    }
}
