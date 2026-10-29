package com.dsdelivery.admin.core

import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.data.Severity

enum class AlarmLevel { NONE, SOFT, LOUD }

/**
 * Decides when the app rings. Pure logic (no Android classes) so it is unit-tested.
 *
 * The SERVER decides which items may ring ([AttentionItem.alarm]: not acknowledged, and not a quiet-hours item below critical).
 * "Ovozni o'chirish" here only mutes what rings right now for [silenceMs]; if the item is still open when that time is over,
 * the app rings again - a silenced alarm must never be forgotten. The real "I called" acknowledgement is a server call.
 */
class AttentionTracker(private val silenceMs: Long = DEFAULT_SILENCE_MS) {

    private val silencedUntil = HashMap<String, Long>()
    private var alarming: List<AttentionItem> = emptyList()

    /** Feed the latest list. Returns the items that should be ringing right now. */
    fun update(items: List<AttentionItem>, now: Long): List<AttentionItem> {
        alarming = items.filter { it.alarm }
        val keys = alarming.map { it.key }.toSet()
        silencedUntil.keys.retainAll(keys) // acknowledged, solved or gone: forget its silence
        return ringing(now)
    }

    fun ringing(now: Long): List<AttentionItem> = alarming.filter { (silencedUntil[it.key] ?: 0L) <= now }

    /** Mute everything that is ringing now. */
    fun silence(now: Long) {
        alarming.forEach { silencedUntil[it.key] = now + silenceMs }
    }

    /** Items that may ring (ringing or silenced for a moment). */
    fun pending(): List<AttentionItem> = alarming

    companion object {
        const val DEFAULT_SILENCE_MS = 30_000L

        /** A critical item rings with the loud horn; anything else with the soft double beep. */
        fun levelOf(ringing: List<AttentionItem>): AlarmLevel = when {
            ringing.isEmpty() -> AlarmLevel.NONE
            ringing.any { it.severity == Severity.CRITICAL } -> AlarmLevel.LOUD
            else -> AlarmLevel.SOFT
        }
    }
}
