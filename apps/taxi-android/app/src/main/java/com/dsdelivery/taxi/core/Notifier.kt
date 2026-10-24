package com.dsdelivery.taxi.core

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.dsdelivery.taxi.R
import com.dsdelivery.taxi.data.RequestDto
import com.dsdelivery.taxi.service.SilenceReceiver
import com.dsdelivery.taxi.ui.MainActivity

/** Status-bar notifications. The sound itself comes from [AlarmPlayer], so the channels are silent. */
class Notifier(private val context: Context) {

    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_DUTY, "Navbatchilik", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Ilova ochiq turganini ko‘rsatadi"
                setShowBadge(false)
            })
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ALERT, "Yangi so‘rovlar", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Javob kutayotgan taksi so‘rovlari"
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
        }
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    /** The permanent notification of the background service. */
    fun duty(text: String): Notification = NotificationCompat.Builder(context, CHANNEL_DUTY)
        .setSmallIcon(R.drawable.ic_stat_taxi)
        .setContentTitle("DS Taxi — navbatchilik")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(openApp())
        .build()

    fun updateDuty(text: String) {
        if (canPost()) manager.notify(ID_DUTY, duty(text))
    }

    /** Shown while requests wait for an answer (ringing or silenced). [ringing] adds the silence button. */
    fun alert(waiting: List<RequestDto>, ringing: Boolean) {
        if (waiting.isEmpty()) { manager.cancel(ID_ALERT); return }
        if (!canPost()) return
        val first = waiting.first()
        val title = if (waiting.size == 1) "Yangi so‘rov #${first.orderNumber}" else "${waiting.size} ta so‘rov javob kutmoqda"
        val body = if (waiting.size == 1) "${first.restaurant.name} → ${first.delivery.address}" else waiting.joinToString { "#${it.orderNumber}" }
        val silence = PendingIntent.getBroadcast(
            context, 1, Intent(context, SilenceReceiver::class.java).setAction(SilenceReceiver.ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val b = NotificationCompat.Builder(context, CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_stat_taxi)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp())
            .setFullScreenIntent(openApp(), true)
        if (ringing) b.addAction(0, "Ovozni o‘chirish", silence)
        manager.notify(ID_ALERT, b.build())
    }

    fun canPost(): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            manager.areNotificationsEnabled()

    fun canFullScreen(): Boolean = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()

    companion object {
        const val CHANNEL_DUTY = "duty"
        const val CHANNEL_ALERT = "alert"
        const val ID_DUTY = 1001
        const val ID_ALERT = 1002
    }
}
