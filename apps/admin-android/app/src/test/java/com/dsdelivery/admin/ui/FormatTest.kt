package com.dsdelivery.admin.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {

    @Test fun `age is shown in the natural unit`() {
        assertEquals("", ageText(null))
        assertEquals("0 soniya", ageText(-5))
        assertEquals("45 soniya", ageText(45))
        assertEquals("2 daqiqa", ageText(150))
        assertEquals("1 soat", ageText(3600))
        assertEquals("2 soat 10 daqiqa", ageText(7800))
    }

    @Test fun `money is grouped by thousands`() {
        assertEquals("0 so‘m", somText(0))
        assertEquals("950 so‘m", somText(950))
        assertEquals("12 300 000 so‘m", somText(12_300_000))
        assertEquals("40 000 000 so‘m", somText(40_000_000))
        assertEquals("−1 500 so‘m", somText(-1500))
    }

    @Test fun `phone numbers are dialled without spaces and dashes`() {
        assertEquals("+998901234567", dialable("+998 90 123-45-67"))
        assertEquals("", dialable(" - "))
    }

    @Test fun `severity maps to a tone`() {
        assertEquals(Tone.URGENT, toneOf("CRITICAL"))
        assertEquals(Tone.WARN, toneOf("HIGH"))
        assertEquals(Tone.INFO, toneOf("MEDIUM"))
        assertEquals(Tone.NEUTRAL, toneOf("OTHER"))
    }

    @Test fun `a message time shows the date only when it is not today`() {
        val utc = java.time.ZoneOffset.UTC
        val today = java.time.LocalDate.of(2026, 10, 30)
        assertEquals("14:05", stampOf("2026-10-30T14:05:00Z", today, utc))
        assertEquals("29.10 23:59", stampOf("2026-10-29T23:59:00Z", today, utc))
        assertEquals("", stampOf(null, today, utc))
        assertEquals("", stampOf("not a time", today, utc))
    }

    @Test fun `payout days read as today, yesterday or dd_MM`() {
        val now = java.time.LocalDate.of(2026, 10, 30)
        assertEquals("Bugun", dayLabel("2026-10-30", now))
        assertEquals("Kecha", dayLabel("2026-10-29", now))
        assertEquals("28.10", dayLabel("2026-10-28", now))
        assertEquals("garbage", dayLabel("garbage", now))
    }

    @Test fun `quiet hours convert between hours and HH_MM`() {
        assertEquals(1, hourOf("01:00"))
        assertEquals(23, hourOf("23:30"))
        assertEquals(0, hourOf("garbage"))
        assertEquals("07:00", hhmm(7))
        assertEquals("00:00", hhmm(24))
        assertEquals("23:00", hhmm(-1))
    }
}
