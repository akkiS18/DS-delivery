package com.dsdelivery.restaurant.data.alarm

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.dsdelivery.restaurant.RestaurantApp
import com.dsdelivery.restaurant.data.auth.SessionState

/**
 * Keeps the app alive in the background while a restaurant is signed in and the bell is on, so a new order rings even with the screen off.
 * The work itself is [OrderWatcher]; this service is the process's life support (foreground notification + a partial wake lock).
 */
class WatchService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as RestaurantApp
        if (app.sessionManager.sessionState.value !is SessionState.LoggedIn || !app.alarm.settings.enabled.value) {
            stopSelf()
            return START_NOT_STICKY
        }
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, AlarmNotifier.ID_WATCH, AlarmNotifier(this).watching(), type)
        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dsrestaurant:watch").apply { setReferenceCounted(false); acquire() }
        }
        app.alarm.watcher.start()
        return START_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    companion object {
        /** Safe to call repeatedly; starting is refused by the system only when the app may not run in the background, which is then not fatal. */
        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, WatchService::class.java)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WatchService::class.java))
        }
    }
}
