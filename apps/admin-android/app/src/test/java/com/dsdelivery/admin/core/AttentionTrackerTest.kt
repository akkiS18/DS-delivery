package com.dsdelivery.admin.core

import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.data.Severity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionTrackerTest {

    private fun item(key: String, severity: String = Severity.HIGH, alarm: Boolean = true) = AttentionItem(
        key = key, kind = "ORDER_UNSEEN", severity = severity, title = "t", detail = "d", restaurant = null, orderCode = "K7M2Q",
        since = null, ageSeconds = 100, acked = !alarm, snoozeUntil = null, alarm = alarm,
    )

    private fun keys(list: List<AttentionItem>) = list.map { it.key }.toSet()

    @Test fun `only items the server marked as alarming ring`() {
        val t = AttentionTracker()
        assertEquals(setOf("a"), keys(t.update(listOf(item("a"), item("b", alarm = false)), 0)))
    }

    @Test fun `silence mutes for the set time and then it rings again`() {
        val t = AttentionTracker(silenceMs = 30_000)
        val list = listOf(item("a"))
        t.update(list, 0)
        t.silence(1_000)
        assertTrue(t.update(list, 5_000).isEmpty())
        assertTrue(t.update(list, 30_999).isEmpty())
        assertEquals(setOf("a"), keys(t.update(list, 31_000)))
    }

    @Test fun `a silenced item that stays open is still pending`() {
        val t = AttentionTracker()
        t.update(listOf(item("a")), 0)
        t.silence(0)
        assertEquals(setOf("a"), keys(t.pending()))
    }

    @Test fun `a new item rings even while another one is silenced`() {
        val t = AttentionTracker()
        t.update(listOf(item("a")), 0)
        t.silence(0)
        assertEquals(setOf("b"), keys(t.update(listOf(item("a"), item("b")), 1_000)))
    }

    @Test fun `an acknowledged item is forgotten and rings again if it returns`() {
        val t = AttentionTracker()
        t.update(listOf(item("a")), 0)
        t.silence(0)
        t.update(listOf(item("a", alarm = false)), 1_000) // acknowledged on the server
        assertEquals(setOf("a"), keys(t.update(listOf(item("a")), 2_000))) // the snooze ran out: no leftover silence
    }

    @Test fun `level is loud for a critical item and soft otherwise`() {
        assertEquals(AlarmLevel.NONE, AttentionTracker.levelOf(emptyList()))
        assertEquals(AlarmLevel.SOFT, AttentionTracker.levelOf(listOf(item("a", Severity.HIGH), item("b", Severity.MEDIUM))))
        assertEquals(AlarmLevel.LOUD, AttentionTracker.levelOf(listOf(item("a", Severity.MEDIUM), item("b", Severity.CRITICAL))))
    }
}
