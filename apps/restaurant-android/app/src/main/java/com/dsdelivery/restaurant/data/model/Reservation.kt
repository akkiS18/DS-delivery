package com.dsdelivery.restaurant.data.model

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One table reservation as the restaurant sees it (GET /api/v1/restaurant/reservations). */
data class Reservation(
    val id: String,
    val code: String,
    val startsAtIso: String,
    val whenText: String,
    val partySize: Int,
    val note: String?,
    val customerName: String,
    val customerPhone: String,
    val depositSom: Int,
    val paidAtText: String,
    /** True once somebody opened the reservation list after it was paid (drives the "Yangi" marker and the notification). */
    val seen: Boolean,
    val isTest: Boolean,
    /** The deposit arrived but nothing confirmed it automatically: one tap books the table. */
    val awaitingConfirm: Boolean,
    val cancelled: Boolean
) {
    val formattedDeposit: String get() = Reservations.money(depositSom)
}

data class ReservationSettings(val enabled: Boolean, val depositSom: Int)

data class ReservationsReport(
    val settings: ReservationSettings,
    val unseenCount: Int,
    val upcoming: List<Reservation>,
    val past: List<Reservation>
)

object Reservations {
    const val DEFAULT_DEPOSIT_SOM = 100_000
    const val MIN_DEPOSIT_SOM = 1_000
    const val MAX_DEPOSIT_SOM = 5_000_000

    private val WHEN: DateTimeFormatter = DateTimeFormatter.ofPattern("dd.MM HH:mm")

    /** "28.10 19:30" on the phone's clock (the restaurant and its phone share the zone). */
    fun formatTime(iso: String?): String =
        try {
            if (iso.isNullOrBlank()) "" else WHEN.format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
        } catch (_: Exception) {
            ""
        }

    /** 100000 -> "100 000 so‘m" */
    fun money(som: Int): String =
        NumberFormat.getIntegerInstance(Locale.US).format(som).replace(',', ' ') + " so‘m"

    /** Digits typed by the owner ("100 000", "100000") -> the amount, or null when it is outside the range the server accepts. */
    fun parseDeposit(text: String): Int? {
        val digits = text.filter { it.isDigit() }
        if (digits.isEmpty() || digits.length > 9) return null
        val value = digits.toLong()
        return if (value in MIN_DEPOSIT_SOM.toLong()..MAX_DEPOSIT_SOM.toLong()) value.toInt() else null
    }
}
