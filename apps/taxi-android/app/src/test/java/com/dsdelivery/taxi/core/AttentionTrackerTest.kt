package com.dsdelivery.taxi.core

import com.dsdelivery.taxi.data.DeliveryInfo
import com.dsdelivery.taxi.data.FoodInfo
import com.dsdelivery.taxi.data.RequestDto
import com.dsdelivery.taxi.data.RestaurantInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionTrackerTest {

    private fun req(id: String, status: String, attention: Boolean) = RequestDto(
        id = id, orderCode = "K7M2Q", status = status, attention = attention, createdAt = "2026-01-01T10:00:00Z", sentAt = null, answerBy = null,
        updatedAt = "2026-01-01T10:00:00Z", deliveredAt = null, isTest = false,
        restaurant = RestaurantInfo("R", null, null), delivery = DeliveryInfo("A", null, null, null),
        food = FoodInfo(false, "PREPARING", null, null, null, 1000), actions = emptyList(), deliverBlockedReason = null,
    )

    @Test fun `a new request rings at once`() {
        val t = AttentionTracker()
        assertEquals(setOf("a:REQUESTED"), t.update(listOf(req("a", "REQUESTED", true)), now = 0))
    }

    @Test fun `requests that need no answer never ring`() {
        val t = AttentionTracker()
        assertTrue(t.update(listOf(req("a", "ACCEPTED", false), req("b", "ASSIGNED", false)), 0).isEmpty())
    }

    @Test fun `silence mutes for the set time and then it rings again`() {
        val t = AttentionTracker(silenceMs = 30_000)
        val list = listOf(req("a", "REQUESTED", true))
        t.update(list, 0)
        t.silence(1_000)
        assertTrue(t.update(list, 5_000).isEmpty())
        assertTrue(t.update(list, 30_999).isEmpty())
        assertEquals(setOf("a:REQUESTED"), t.update(list, 31_000))
    }

    @Test fun `a silenced request that changes state rings again at once`() {
        val t = AttentionTracker()
        t.update(listOf(req("a", "REQUESTED", true)), 0)
        t.silence(0)
        assertEquals(setOf("a:CANCELLATION_PENDING"), t.update(listOf(req("a", "CANCELLATION_PENDING", true)), 1_000))
    }

    @Test fun `a new request rings even while another one is silenced`() {
        val t = AttentionTracker()
        t.update(listOf(req("a", "REQUESTED", true)), 0)
        t.silence(0)
        val ringing = t.update(listOf(req("a", "REQUESTED", true), req("b", "REQUESTED", true)), 1_000)
        assertEquals(setOf("b:REQUESTED"), ringing)
        assertEquals(setOf("a:REQUESTED", "b:REQUESTED"), t.pending())
    }

    @Test fun `answering stops the ringing and forgets the silence`() {
        val t = AttentionTracker()
        t.update(listOf(req("a", "REQUESTED", true)), 0)
        t.silence(0)
        assertTrue(t.update(listOf(req("a", "ACCEPTED", false)), 1_000).isEmpty())
        assertTrue(t.pending().isEmpty())
        // the same id coming back as a new question rings (it is a different key/state)
        assertEquals(setOf("a:NEEDS_HELP"), t.update(listOf(req("a", "NEEDS_HELP", true)), 2_000))
    }
}
