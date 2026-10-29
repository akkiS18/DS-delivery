package com.dsdelivery.admin.ui

import androidx.compose.ui.graphics.Color
import com.dsdelivery.admin.data.Severity
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val clock = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

fun clockOf(iso: String?): String? = iso?.let { runCatching { clock.format(Instant.parse(it)) }.getOrNull() }

/** "45 soniya", "7 daqiqa", "2 soat 10 daqiqa": how long an item has been waiting. */
fun ageText(seconds: Long?): String {
    if (seconds == null) return ""
    val s = seconds.coerceAtLeast(0)
    return when {
        s < 60 -> "$s soniya"
        s < 3600 -> "${s / 60} daqiqa"
        else -> {
            val m = (s % 3600) / 60
            if (m == 0L) "${s / 3600} soat" else "${s / 3600} soat $m daqiqa"
        }
    }
}

/** Phone numbers are dialled as typed; spaces and dashes are dropped. */
fun dialable(phone: String): String = phone.filter { it.isDigit() || it == '+' }

enum class Tone { URGENT, WARN, INFO, OK, NEUTRAL }

val UrgentColor = Color(0xFFD32F2F)
val WarnColor = Color(0xFFEF6C00)
val InfoColor = Color(0xFF1565C0)
val OkColor = Color(0xFF2E7D32)
val NeutralColor = Color(0xFF616161)

fun toneOf(severity: String): Tone = when (severity) {
    Severity.CRITICAL -> Tone.URGENT
    Severity.HIGH -> Tone.WARN
    Severity.MEDIUM -> Tone.INFO
    else -> Tone.NEUTRAL
}

fun toneColor(t: Tone): Color = when (t) {
    Tone.URGENT -> UrgentColor
    Tone.WARN -> WarnColor
    Tone.INFO -> InfoColor
    Tone.OK -> OkColor
    Tone.NEUTRAL -> NeutralColor
}

fun severityLabel(severity: String): String = when (severity) {
    Severity.CRITICAL -> "Shoshilinch"
    Severity.HIGH -> "Muhim"
    Severity.MEDIUM -> "Ma’lumot uchun"
    else -> severity
}

/** "01:00" -> 1. Quiet hours are whole hours in the app (the server accepts minutes too; they are kept when shown). */
fun hourOf(hhmm: String): Int = hhmm.substringBefore(':').toIntOrNull()?.coerceIn(0, 23) ?: 0

fun hhmm(hour: Int): String = "%02d:00".format(((hour % 24) + 24) % 24)
