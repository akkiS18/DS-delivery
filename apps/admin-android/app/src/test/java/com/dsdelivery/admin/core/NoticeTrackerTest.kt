package com.dsdelivery.admin.core

import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.data.Severity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NoticeTrackerTest {

    private fun item(key: String) = AttentionItem(
        key = key, kind = "MONEY_REVIEW", severity = Severity.CRITICAL, title = "t", detail = "d", restaurant = null, orderCode = null,
        since = null, ageSeconds = 10, acked = false, snoozeUntil = null, alarm = false, notify = true,
    )

    @Test fun `an item is announced once while it stays open`() {
        val t = NoticeTracker()
        assertEquals(listOf("a", "b"), t.update(listOf(item("a"), item("b"))).fresh.map { it.key })
        val again = t.update(listOf(item("a"), item("b")))
        assertTrue(again.fresh.isEmpty())
        assertTrue(again.gone.isEmpty())
        assertEquals(listOf("c"), t.update(listOf(item("a"), item("b"), item("c"))).fresh.map { it.key })
    }

    @Test fun `a solved item is withdrawn and announced again if it comes back`() {
        val t = NoticeTracker()
        t.update(listOf(item("a"), item("b")))
        val u = t.update(listOf(item("b")))
        assertEquals(setOf("a"), u.gone)
        assertTrue(u.fresh.isEmpty())
        assertEquals(1, t.openCount())
        assertEquals(listOf("a"), t.update(listOf(item("a"), item("b"))).fresh.map { it.key })
    }

    @Test fun `going off duty withdraws everything`() {
        val t = NoticeTracker()
        t.update(listOf(item("a"), item("b")))
        assertEquals(setOf("a", "b"), t.update(emptyList()).gone)
        assertEquals(0, t.openCount())
    }
}
