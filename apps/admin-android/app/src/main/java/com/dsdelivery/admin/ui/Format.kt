package com.dsdelivery.admin.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.dsdelivery.admin.data.Severity
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val clock = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

fun clockOf(iso: String?): String? = iso?.let { runCatching { clock.format(Instant.parse(it)) }.getOrNull() }

/** "14:05" for today, "29.10 14:05" for another day: when a message was written. */
fun stampOf(iso: String?, today: java.time.LocalDate = java.time.LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): String =
    iso?.let {
        runCatching {
            val at = Instant.parse(it).atZone(zone)
            val time = DateTimeFormatter.ofPattern("HH:mm").format(at)
            if (at.toLocalDate() == today) time else DateTimeFormatter.ofPattern("dd.MM").format(at) + " " + time
        }.getOrNull()
    } ?: ""

/** "2026-10-30" -> "Bugun" / "Kecha" / "28.10": a payout day as the administrator reads it. */
fun dayLabel(key: String, today: java.time.LocalDate = java.time.LocalDate.now()): String {
    val day = runCatching { java.time.LocalDate.parse(key) }.getOrNull() ?: return key
    return when (day) {
        today -> "Bugun"
        today.minusDays(1) -> "Keça"
        else -> DateTimeFormatter.ofPattern("dd.MM").format(day)
    }
}

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

/** 12300000 -> "12 300 000 so‘m". */
fun somText(amount: Long): String {
    val digits = kotlin.math.abs(amount).toString()
    val grouped = digits.reversed().chunked(3).joinToString(" ").reversed()
    return (if (amount < 0) "−" else "") + grouped + " söm"
}

/** Phone numbers are dialled as typed; spaces and dashes are dropped. */
fun dialable(phone: String): String = phone.filter { it.isDigit() || it == '+' }

enum class Tone { URGENT, WARN, INFO, OK, NEUTRAL }

fun toneOf(severity: String): Tone = when (severity) {
    Severity.CRITICAL -> Tone.URGENT
    Severity.HIGH -> Tone.WARN
    Severity.MEDIUM -> Tone.INFO
    else -> Tone.NEUTRAL
}

@Composable
fun toneColor(t: Tone): Color = when (t) {
    Tone.URGENT -> UrgentColor
    Tone.WARN -> WarnColor
    Tone.INFO -> InfoColor
    Tone.OK -> OkColor
    Tone.NEUTRAL -> NeutralColor
}

fun severityLabel(severity: String): String = when (severity) {
    Severity.CRITICAL -> "Şoşilinç"
    Severity.HIGH -> "Muhim"
    Severity.MEDIUM -> "Ma’lumot uçun"
    else -> severity
}

/** "01:00" -> 1. Quiet hours are whole hours in the app (the server accepts minutes too; they are kept when shown). */
fun hourOf(hhmm: String): Int = hhmm.substringBefore(':').toIntOrNull()?.coerceIn(0, 23) ?: 0

fun hhmm(hour: Int): String = "%02d:00".format(((hour % 24) + 24) % 24)
