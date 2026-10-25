package com.dsdelivery.restaurant.data.alarm

/**
 * Decides when the kitchen is rung. Pure logic (no Android classes), so it is unit-checked.
 *
 * An order "needs the kitchen" while it sits in the server's `new` bucket (a payment to verify, or paid and cooking with no "ready in N minutes"
 * chosen yet). The alarm rings as long as at least one such order exists and is not silenced. "Silence" mutes the CURRENT orders for [silenceMs];
 * an order that arrives meanwhile rings at once, and when the time is over the still-waiting orders ring again - a silenced alarm is never forgotten.
 * An order that leaves the bucket (the time was chosen, it was cancelled) is forgotten together with its silence.
 */
class NewOrderAttention(private val silenceMs: Long = DEFAULT_SILENCE_MS) {

    private val silencedUntil = HashMap<String, Long>()
    private var waiting: Set<String> = emptySet()

    /** Feed the ids currently in the `new` bucket. Returns the ids that should be ringing right now. */
    fun update(ids: Collection<String>, now: Long): Set<String> {
        waiting = ids.toSet()
        silencedUntil.keys.retainAll(waiting)
        return ringing(now)
    }

    fun ringing(now: Long): Set<String> = waiting.filterTo(HashSet()) { (silencedUntil[it] ?: 0L) <= now }

    /** Mute everything that is waiting now. */
    fun silence(now: Long) {
        waiting.forEach { silencedUntil[it] = now + silenceMs }
    }

    /** Ids still waiting for the kitchen (ringing or silenced). */
    fun pending(): Set<String> = waiting

    companion object {
        const val DEFAULT_SILENCE_MS = 30_000L
    }
}
