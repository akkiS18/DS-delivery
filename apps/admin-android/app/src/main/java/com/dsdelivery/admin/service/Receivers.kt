package com.dsdelivery.admin.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dsdelivery.admin.AdminApp

/** After a reboot or an app update the phone goes back on duty by itself (if the administrator was signed in and on duty). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            WatchService.start(context)
        }
    }
}

/** The "Ovozni o‘chirish" button of the alert notification. */
class SilenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION) (context.applicationContext as AdminApp).watcher.silence()
    }

    companion object { const val ACTION = "com.dsdelivery.admin.SILENCE" }
}
