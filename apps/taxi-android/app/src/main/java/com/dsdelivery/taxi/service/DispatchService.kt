package com.dsdelivery.taxi.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.dsdelivery.taxi.TaxiApp

/**
 * Keeps the app alive in the background while the operator is on duty, so a new request rings even with the screen off or the app closed.
 * The work itself is the [com.dsdelivery.taxi.core.Dispatcher] loop; this service is the process's life support (foreground notification +
 * a partial wake lock so the CPU keeps polling).
 */
class DispatchService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as TaxiApp
        if (!app.session.isLoggedIn || !app.session.duty.value) {
            stopSelf()
            return START_NOT_STICKY
        }
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, com.dsdelivery.taxi.core.Notifier.ID_DUTY, app.notifier.duty("Yangi so‘rovlarni kutyapman"), type)
        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dstaxi:duty").apply { setReferenceCounted(false); acquire() }
        }
        app.dispatcher.start()
        return START_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    companion object {
        /** Starts the service when it is allowed to run (signed in and on duty). Safe to call repeatedly. */
        fun start(context: Context) {
            val app = context.applicationContext as TaxiApp
            if (!app.session.isLoggedIn || !app.session.duty.value) return
            runCatching { ContextCompat.startForegroundService(context, Intent(context, DispatchService::class.java)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, DispatchService::class.java))
        }
    }
}
