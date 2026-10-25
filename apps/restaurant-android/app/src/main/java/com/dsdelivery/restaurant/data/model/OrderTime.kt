package com.dsdelivery.restaurant.data.model

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Time helpers for the Orders UI. Every instant shown (age, estimated ready time, overdue) is derived from SERVER timestamps plus the
 * device's MONOTONIC clock (SystemClock.elapsedRealtime) measured since the response arrived, so a wrong phone clock or time zone
 * cannot produce a wrong countdown or a wrong "overdue" figure. Pure Kotlin: no Android types.
 */
data class ServerClock(val serverNowMillis: Long, val receivedAtElapsed: Long) {
    /** The server's current time, extrapolated with the monotonic clock. */
    fun now(nowElapsed: Long): Long = serverNowMillis + (nowElapsed - receivedAtElapsed)
}

private val TASHKENT: ZoneId = ZoneId.of("Asia/Tashkent")
private val HH_MM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

fun parseIsoMillis(value: String?): Long? =
    if (value.isNullOrBlank()) null else runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()

/** Wall-clock time in the restaurant's market (Asia/Tashkent), independent of the phone's time zone setting. */
fun formatClock(millis: Long): String = HH_MM.format(Instant.ofEpochMilli(millis).atZone(TASHKENT))

/** Whole minutes since the order was placed, by the server's clock. Null when it cannot be determined. */
fun ageMinutes(createdAtMillis: Long?, clock: ServerClock?, nowElapsed: Long): Long? {
    if (createdAtMillis == null || clock == null) return null
    return ((clock.now(nowElapsed) - createdAtMillis) / 60_000L).coerceAtLeast(0)
}

/** Waiting for the kitchen: calm up to 5 minutes, then orange, red from 10 (the colour of the age line on an order that needs action). */
enum class Urgency { CALM, SOON, LATE }
fun urgencyOf(ageMinutes: Long?): Urgency = when {
    ageMinutes == null || ageMinutes < 5 -> Urgency.CALM
    ageMinutes < 10 -> Urgency.SOON
    else -> Urgency.LATE
}

/** "hozirgina", "7 daq oldin", "1 soat 5 daq oldin", "2 kun oldin". Null when the age cannot be determined. */
fun ageText(createdAtMillis: Long?, clock: ServerClock?, nowElapsed: Long): String? {
    val minutes = ageMinutes(createdAtMillis, clock, nowElapsed) ?: return null
    return when {
        minutes < 1 -> "hozirgina"
        minutes < 60 -> "$minutes daq oldin"
        minutes < 24 * 60 -> {
            val h = minutes / 60
            val m = minutes % 60
            if (m == 0L) "$h soat oldin" else "$h soat $m daq oldin"
        }
        else -> "${minutes / (24 * 60)} kun oldin"
    }
}

/**
 * What the preparation clock shows right now.
 *  - [text]     headline: "Qolgan vaqt: 12:05" or, once the time is up, "Kechikish: 7 daqiqa" (grows by itself, never resets);
 *  - [detail]   second line: the exact value ("Kechikish 7:42") or the estimated ready clock time;
 *  - [overdue]  true from the moment the estimate is reached.
 * Reaching zero never changes the order: it only changes this text.
 */
data class PrepDisplay(val text: String, val detail: String?, val overdue: Boolean, val remainingSeconds: Long)

private fun mmss(totalSeconds: Long): String {
    val s = kotlin.math.abs(totalSeconds)
    return "%d:%02d".format(s / 60, s % 60)
}

/** Whole minutes late, rounded UP while any lateness exists (so the first second of lateness already reads "1 daqiqa"). */
fun overdueMinutes(remainingSeconds: Long): Long = if (remainingSeconds >= 0) 0 else ((-remainingSeconds) + 59) / 60

fun PrepInfo.display(nowElapsed: Long): PrepDisplay? {
    val remaining = remainingSeconds(nowElapsed) ?: return null
    val readyAt = estimatedReadyAtMillis
    return if (remaining > 0) {
        PrepDisplay("Qolgan vaqt: ${mmss(remaining)}", readyAt?.let { "Taxminiy tayyor: ${formatClock(it)}" }, false, remaining)
    } else {
        // remaining <= 0: the estimate has been reached. 0 reads as "1 daqiqa" too, so there is no dead moment at zero.
        val minutes = maxOf(1L, overdueMinutes(remaining))
        PrepDisplay("Kechikish: $minutes daqiqa", "Kechikish ${mmss(remaining)}" + (readyAt?.let { " • rejalashtirilgan ${formatClock(it)}" } ?: ""), true, remaining)
    }
}
