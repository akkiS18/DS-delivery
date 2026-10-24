package com.dsdelivery.restaurant.data.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.dsdelivery.restaurant.MainActivity
import com.dsdelivery.restaurant.data.model.Order
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** True while the app's UI is visible (set from MainActivity). Polling only runs in the foreground. */
object AppForeground {
    private val _isForeground = MutableStateFlow(false)
    val isForeground: StateFlow<Boolean> = _isForeground
    fun set(value: Boolean) { _isForeground.value = value }
}

/**
 * Local "new order" notification. This is NOT push: it is posted when the foreground poll sees an order the app has not
 * announced before. Background delivery is not guaranteed (see docs/STAGE_6E.md for the FCM path). Each order id is
 * announced at most once, remembered across restarts, so repeated polls or relaunches never repeat a notification.
 */
class NewOrderNotifier(private val context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun notifyNewOrders(orders: List<Order>) {
        val fresh = orders.filter { !alreadyAnnounced(it.id) }
        if (fresh.isEmpty()) return
        fresh.forEach { remember(it.id) }
        if (!canPost()) return
        ensureChannel()
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        fresh.forEach { order ->
            val n = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Yangi buyurtma ${order.orderNumberDisplay}")
                .setContentText("${order.itemsCount} ta mahsulot • ${order.formattedTotal}")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(open)
                .build()
            // Same id per order number: a repeat would replace, never stack.
            NotificationManagerCompat.from(context).notify(order.code.hashCode(), n)
        }
    }

    private fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Yangi buyurtmalar", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    private fun alreadyAnnounced(id: String): Boolean = prefs.getStringSet(KEY, emptySet())?.contains(id) == true

    private fun remember(id: String) {
        val current = prefs.getStringSet(KEY, emptySet()).orEmpty()
        // Keep the set bounded; only recent orders can still be "new".
        val next = (current + id).toList().takeLast(MAX_REMEMBERED).toSet()
        prefs.edit().putStringSet(KEY, next).apply()
    }

    private companion object {
        const val PREFS = "new_order_notices"
        const val KEY = "announced_order_ids"
        const val CHANNEL_ID = "new_orders"
        const val MAX_REMEMBERED = 200
    }
}
