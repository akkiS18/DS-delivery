package com.dsdelivery.restaurant.data.alarm

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.dsdelivery.restaurant.MainActivity
import com.dsdelivery.restaurant.R
import com.dsdelivery.restaurant.RestaurantApp
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.Reservation
import android.os.Build

/** Status-bar notifications of the kitchen bell. The sound itself comes from [AlarmPlayer], so the channels are silent. */
class AlarmNotifier(private val context: Context) {

    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        manager.createNotificationChannel(NotificationChannel(CHANNEL_WATCH, "Buyurtmalar kuzatuvi", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Ilova yopiq bo‘lsa ham yangi buyurtma haqida xabar berish uchun ishlab turadi"
            setShowBadge(false)
        })
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ALERT, "Yangi buyurtma signali", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Oshxona javob berishi kerak bo‘lgan buyurtmalar"
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        // A paid table reservation is news, not an emergency: one normal sound, no repeating bell.
        manager.createNotificationChannel(NotificationChannel(CHANNEL_RESERVATION, "Yangi bron", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Mijoz bron uchun pul to‘lagan va joy band bo‘lgan"
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    /** The permanent notification of the background service. */
    fun watching(text: String = "Yangi buyurtmalar kuzatilmoqda"): Notification = NotificationCompat.Builder(context, CHANNEL_WATCH)
        .setSmallIcon(R.drawable.ic_stat_restaurant)
        .setContentTitle("DS Restoran")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(openApp())
        .build()

    /** Shown while orders wait for the kitchen (ringing or silenced). [ringing] adds the silence button. */
    fun alert(waiting: List<Order>, ringing: Boolean) {
        if (waiting.isEmpty()) { manager.cancel(ID_ALERT); return }
        if (!canPost()) return
        val title = if (waiting.size == 1) "Yangi buyurtma ${waiting.first().orderNumberDisplay}" else "${waiting.size} ta buyurtma javob kutmoqda"
        val body = if (waiting.size == 1) "${waiting.first().itemsCount} ta mahsulot • ${waiting.first().formattedTotal}" else waiting.joinToString { it.orderNumberDisplay }
        val silence = PendingIntent.getBroadcast(
            context, 1, Intent(context, SilenceReceiver::class.java).setAction(SilenceReceiver.ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val b = NotificationCompat.Builder(context, CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_stat_restaurant)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp())
        if (ringing) b.addAction(0, "Ovozni o‘chirish", silence)
        manager.notify(ID_ALERT, b.build())
    }

    fun clearAlert() = manager.cancel(ID_ALERT)

    /**
     * "Money arrived, the table is booked" for reservations the restaurant has not opened yet (or that still need the payment confirmed).
     * [soundAgain] is true only when a reservation the notification has not mentioned before appeared, so a poll never repeats the sound.
     */
    fun reservationAlert(waiting: List<Reservation>, soundAgain: Boolean) {
        if (waiting.isEmpty()) { manager.cancel(ID_RESERVATION); return }
        if (!canPost()) return
        val needsConfirm = waiting.any { it.awaitingConfirm }
        val title = when {
            waiting.size == 1 && needsConfirm -> "Bron: pulni tasdiqlang"
            waiting.size == 1 -> "Yangi bron: joy band qilindi"
            else -> "${waiting.size} ta yangi bron"
        }
        val body = waiting.joinToString("\n") { "${it.whenText} • ${it.partySize} kishi • ${it.customerName} • ${it.formattedDeposit}" }
        val b = NotificationCompat.Builder(context, CHANNEL_RESERVATION)
            .setSmallIcon(R.drawable.ic_stat_restaurant)
            .setContentTitle(title)
            .setContentText(body.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!soundAgain)
            .setContentIntent(openApp())
        manager.notify(ID_RESERVATION, b.build())
    }

    fun clearReservationAlert() = manager.cancel(ID_RESERVATION)

    private fun canPost(): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            manager.areNotificationsEnabled()

    companion object {
        const val CHANNEL_WATCH = "order_watch"
        const val CHANNEL_ALERT = "order_alert"
        const val CHANNEL_RESERVATION = "reservation_alert"
        const val ID_WATCH = 2001
        const val ID_ALERT = 2002
        const val ID_RESERVATION = 2003
    }
}

/** The "Ovozni o‘chirish" button of the alert notification: mutes the current orders for 30 s. */
class SilenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION) (context.applicationContext as RestaurantApp).alarm.watcher.silence()
    }

    companion object { const val ACTION = "com.dsdelivery.restaurant.SILENCE" }
}

/** After a reboot or an app update the process starts (RestaurantApp.onCreate re-arms the watcher by itself); this receiver only wakes it up. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            (context.applicationContext as RestaurantApp).alarm.refresh()
        }
    }
}
