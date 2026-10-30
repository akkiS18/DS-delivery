package com.dsdelivery.admin.core

import com.dsdelivery.admin.data.AttentionItem

/**
 * Items that only deserve an ordinary notification (the server marks them [AttentionItem.notify]): each key is announced ONCE while it stays open,
 * so a poll every few seconds never repeats it. When it is solved, acknowledged or gone, its notification is withdrawn and, should the same key ever
 * come back, it is announced again. Pure logic (no Android classes) so it is unit-tested.
 */
class NoticeTracker {

    private val announced = HashSet<String>()

    data class Update(val fresh: List<AttentionItem>, val gone: Set<String>)

    /** [open] = the items that currently carry a notice (empty while off duty). */
    fun update(open: List<AttentionItem>): Update {
        val keys = open.map { it.key }.toSet()
        val gone = announced.filter { it !in keys }.toSet()
        announced.removeAll(gone)
        val fresh = open.filter { announced.add(it.key) }
        return Update(fresh, gone)
    }

    fun openCount(): Int = announced.size
}
