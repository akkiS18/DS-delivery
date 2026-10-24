package com.dsdelivery.taxi.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dsdelivery.taxi.TaxiApp

/** After a reboot or an app update the phone goes back on duty by itself (if the operator was signed in and on duty). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            DispatchService.start(context)
        }
    }
}

/** The "Ovozni o‘chirish" button of the alert notification. */
class SilenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION) (context.applicationContext as TaxiApp).dispatcher.silence()
    }

    companion object { const val ACTION = "com.dsdelivery.taxi.SILENCE" }
}
