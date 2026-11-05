package com.dsdelivery.restaurant.data.model

import kotlin.math.abs

/**
 * Money text for the Moliya screens. Pure Kotlin (no Android), checked by unit-checks/FinanceChecks.kt.
 * Amounts under 10 million are written in full with a space between thousands ("550 000 so‘m"); bigger ones are shortened ("12,4 mln so‘m") so a
 * long number never fills the screen.
 */
object FinanceFormat {
    private const val NBSP = ' '

    fun group(value: Long): String {
        val digits = abs(value).toString()
        val out = StringBuilder()
        for ((i, c) in digits.withIndex()) {
            if (i > 0 && (digits.length - i) % 3 == 0) out.append(NBSP)
            out.append(c)
        }
        return (if (value < 0) "−" else "") + out
    }

    private fun oneDecimal(value: Double): String {
        val tenths = Math.round(value * 10)
        val whole = tenths / 10
        val frac = tenths % 10
        return if (frac == 0L) whole.toString() else "$whole,$frac"
    }

    fun som(value: Long): String {
        val a = abs(value)
        val sign = if (value < 0) "−" else ""
        return when {
            a >= 1_000_000_000L -> "$sign${oneDecimal(a / 1_000_000_000.0)} mlrd so‘m"
            a >= 10_000_000L -> "$sign${oneDecimal(a / 1_000_000.0)} mln so‘m"
            else -> "${group(value)} so‘m"
        }
    }

    /** "+49 000 so‘m" for money coming in, "−5 000 so‘m" for a deduction. */
    fun signed(value: Long): String = (if (value > 0) "+" else "") + som(value)

    /** 0.0..1.0 share for a progress bar; 0 when nothing is earned yet. */
    fun share(part: Long, whole: Long): Float = if (whole <= 0L) 0f else (part.toFloat() / whole.toFloat()).coerceIn(0f, 1f)
}
