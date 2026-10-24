package com.dsdelivery.taxi.ui

import androidx.compose.ui.graphics.Color
import com.dsdelivery.taxi.data.Action
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val clock = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

fun clockOf(iso: String?): String? = iso?.let { runCatching { clock.format(Instant.parse(it)) }.getOrNull() }

fun mmss(totalSeconds: Long): String {
    val s = totalSeconds.coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

fun som(amount: Int): String = NumberFormat.getIntegerInstance(Locale("uz")).format(amount).replace(',', ' ') + " so‘m"

enum class Tone { URGENT, WARN, OK, NEUTRAL }

data class StatusLook(val label: String, val tone: Tone)

fun statusLook(status: String): StatusLook = when (status) {
    "REQUESTED" -> StatusLook("Yangi so‘rov", Tone.URGENT)
    "CANCELLATION_PENDING" -> StatusLook("Javob kechikdi — aniqlashtiring", Tone.URGENT)
    "NEEDS_HELP" -> StatusLook("Aniqlashtirish kerak", Tone.URGENT)
    "ACCEPTED" -> StatusLook("Qabul qilingan — haydovchi yuboring", Tone.WARN)
    "ASSIGNED" -> StatusLook("Taksi yo‘lda", Tone.OK)
    "DELIVERED" -> StatusLook("Yetkazildi", Tone.OK)
    "DECLINED" -> StatusLook("Rad etilgan", Tone.NEUTRAL)
    "CANCELLED" -> StatusLook("Bekor qilingan", Tone.NEUTRAL)
    else -> StatusLook(status, Tone.NEUTRAL)
}

fun actionLabel(action: String, status: String): String = when (action) {
    Action.ACCEPT -> "Qabul qilish"
    Action.SENT -> if (status == "ACCEPTED") "Taksi yuborildi" else "Haydovchi yuborilgan"
    Action.NO_TAXI -> if (status == "REQUESTED") "Rad etish" else "Taksi yo‘q"
    Action.DELIVERED -> "Yetkazildi"
    else -> action
}

/** Phone numbers are dialled as typed; spaces and dashes are dropped. */
fun dialable(phone: String): String = phone.filter { it.isDigit() || it == '+' }

val UrgentColor = Color(0xFFD32F2F)
val WarnColor = Color(0xFFEF6C00)
val OkColor = Color(0xFF2E7D32)
val NeutralColor = Color(0xFF616161)

fun toneColor(t: Tone): Color = when (t) {
    Tone.URGENT -> UrgentColor
    Tone.WARN -> WarnColor
    Tone.OK -> OkColor
    Tone.NEUTRAL -> NeutralColor
}
