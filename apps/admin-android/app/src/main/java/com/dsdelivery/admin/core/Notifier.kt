package com.dsdelivery.admin.core

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
import com.dsdelivery.admin.R
import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.service.SilenceReceiver
import com.dsdelivery.admin.ui.MainActivity

/** Status-bar notifications. The sound itself comes from [AlarmPlayer], so the channels are silent. */
class Notifier(private val context: Context) {

    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_DUTY, "Navbatchilik", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Ilova ochiq turganini ko‘rsatadi"
                setShowBadge(false)
            })
            manager.createNotificationChannel(NotificationChannel(CHANNEL_NOTICE, "Xabarlar", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Shubhali pul, murojaatlar, kartalar: bir marta xabar, jiringlamaydi"
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
            manager.createNotificationChannel(NotificationChannel(CHANNEL_NOTICE_QUIET, "Xabarlar (jim soatlarda)", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Jim soatlarda xabarlar ovozsiz keladi"
            })
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ALERT, "Diqqat talab qiladigan holatlar", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Osilib qolgan buyurtmalar va pul muammolari"
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
        .setSmallIcon(R.drawable.ic_stat_admin)
        .setContentTitle("DS Admin — kuzatuv")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(openApp())
        .build()

    fun updateDuty(text: String) {
        if (canPost()) manager.notify(ID_DUTY, duty(text))
    }

    /** Shown while items may ring (ringing or silenced for a moment). [ringing] adds the silence button. */
    fun alert(waiting: List<AttentionItem>, ringing: Boolean) {
        if (waiting.isEmpty()) { manager.cancel(ID_ALERT); return }
        if (!canPost()) return
        val first = waiting.first()
        val title = if (waiting.size == 1) first.title else "${waiting.size} ta holat diqqat talab qiladi"
        val body = if (waiting.size == 1) listOfNotNull(first.restaurant?.name, first.detail).joinToString(" · ") else waiting.joinToString("\n") { "• ${it.title}" }
        val silence = PendingIntent.getBroadcast(
            context, 1, Intent(context, SilenceReceiver::class.java).setAction(SilenceReceiver.ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val b = NotificationCompat.Builder(context, CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_stat_admin)
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

    /**
     * Ordinary one-time notifications for items that do not ring. [quiet] (quiet hours) delivers them without sound. A burst of more than
     * [MAX_SINGLE] new ones (for example the first look after a long time) is folded into one summary so the phone is not flooded.
     */
    fun notices(fresh: List<AttentionItem>, gone: Set<String>, quiet: Boolean, openCount: Int) {
        gone.forEach { manager.cancel(noticeId(it)) }
        if (openCount == 0) manager.cancel(ID_NOTICE_SUMMARY)
        if (fresh.isEmpty() || !canPost()) return
        val channel = if (quiet) CHANNEL_NOTICE_QUIET else CHANNEL_NOTICE
        if (fresh.size > MAX_SINGLE) {
            val body = fresh.joinToString("\n") { "• ${it.title}" }
            manager.notify(ID_NOTICE_SUMMARY, base(channel, "${fresh.size} ta yangi xabar", body).build())
            return
        }
        fresh.forEach { manager.notify(noticeId(it.key), base(channel, it.title, listOfNotNull(it.restaurant?.name, it.detail).joinToString(" · ")).build()) }
    }

    private fun base(channel: String, title: String, body: String): NotificationCompat.Builder = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_stat_admin)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openApp())

    private fun noticeId(key: String): Int = ID_NOTICE_BASE + (key.hashCode() and 0xFFFF)

    fun canPost(): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            manager.areNotificationsEnabled()

    fun canFullScreen(): Boolean = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()

    companion object {
        const val CHANNEL_DUTY = "duty"
        const val CHANNEL_ALERT = "alert"
        const val CHANNEL_NOTICE = "notice"
        const val CHANNEL_NOTICE_QUIET = "notice_quiet"
        const val MAX_SINGLE = 3
        const val ID_NOTICE_SUMMARY = 2003
        const val ID_NOTICE_BASE = 3000
        const val ID_DUTY = 2001
        const val ID_ALERT = 2002
    }
}
