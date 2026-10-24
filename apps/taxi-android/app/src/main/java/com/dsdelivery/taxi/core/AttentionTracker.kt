package com.dsdelivery.taxi.core

import com.dsdelivery.taxi.data.RequestDto

/**
 * Decides when the app rings. Pure logic (no Android classes) so it is unit-tested.
 *
 * A request "needs attention" while the operator has to answer it (new, late, or the system could not deliver it). Each such request is
 * keyed by id AND status, so a request that changes state rings again. "Silence" mutes the CURRENT ones for [silenceMs]; if the operator
 * still has not answered when that time is over, the app rings again - a silenced alarm must never be forgotten.
 */
class AttentionTracker(private val silenceMs: Long = DEFAULT_SILENCE_MS) {

    private val silencedUntil = HashMap<String, Long>()
    private var attention: Set<String> = emptySet()

    /** Feed the latest list. Returns the keys that should be ringing right now. */
    fun update(requests: List<RequestDto>, now: Long): Set<String> {
        attention = requests.filter { it.attention }.map { keyOf(it) }.toSet()
        silencedUntil.keys.retainAll(attention) // answered or changed: forget its silence
        return ringing(now)
    }

    fun ringing(now: Long): Set<String> = attention.filterTo(HashSet()) { (silencedUntil[it] ?: 0L) <= now }

    /** Mute everything that is ringing now. */
    fun silence(now: Long) {
        attention.forEach { silencedUntil[it] = now + silenceMs }
    }

    /** Keys still waiting for an answer (ringing or silenced). */
    fun pending(): Set<String> = attention

    companion object {
        const val DEFAULT_SILENCE_MS = 30_000L
        fun keyOf(r: RequestDto): String = "${r.id}:${r.status}"
    }
}
