package com.dsdelivery.admin.core

import android.os.SystemClock
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.data.QuietHours
import com.dsdelivery.admin.data.Repository
import com.dsdelivery.admin.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class WatchState(
    val items: List<AttentionItem> = emptyList(),
    val quiet: QuietHours? = null,
    val quietActive: Boolean = false,
    /** True once at least one list has arrived (so the screen can tell "all clear" from "not loaded yet"). */
    val loaded: Boolean = false,
    /** Several polls in a row failed: the app cannot hear new problems right now. */
    val offline: Boolean = false,
    val ringing: Boolean = false,
    /** Keys that may ring (ringing or silenced for a moment). */
    val waiting: Set<String> = emptySet(),
    /** SystemClock.elapsedRealtime() of the last good answer: ages shown on screen = server age + time since then. */
    val fetchedAtMs: Long = 0L,
)

/**
 * The heart of the app: polls the server every few seconds, keeps the screen state, and runs the alarm. One instance for the whole
 * process; the foreground service keeps the process (and so this loop) alive while the administrator is on duty.
 */
class Watcher(
    private val scope: CoroutineScope,
    private val repo: Repository,
    private val session: SessionStore,
    private val alarm: AlarmPlayer,
    private val notifier: Notifier,
    private val onSignedOut: () -> Unit,
) {
    private val tracker = AttentionTracker()
    private val notices = NoticeTracker()
    private val _state = MutableStateFlow(WatchState())
    val state: StateFlow<WatchState> = _state.asStateFlow()

    private var job: Job? = null
    private var failures = 0
    private var latest: List<AttentionItem> = emptyList()

    @Synchronized
    fun start() {
        if (job?.isActive == true || !session.isLoggedIn) return
        job = scope.launch {
            while (isActive) {
                pollOnce()
                if (!session.isLoggedIn) break
                delay(if (_state.value.ringing) FAST_MS else POLL_MS)
            }
        }
    }

    @Synchronized
    fun stop() {
        job?.cancel()
        job = null
        alarm.setLevel(AlarmLevel.NONE)
        notifier.alert(emptyList(), false)
        notifier.notices(emptyList(), notices.update(emptyList()).gone, false, 0)
        failures = 0
        latest = emptyList()
        _state.value = WatchState()
    }

    /** Pull-to-refresh and the "returned to the app" refresh. */
    fun refreshNow() {
        scope.launch { pollOnce() }
    }

    /** Mutes what rings right now for a short while (a real acknowledgement is [ack]). */
    fun silence() {
        tracker.silence(SystemClock.elapsedRealtime())
        publish()
    }

    /** "I called" / "I saw it": the server keeps the item quiet for [minutes] (null = the server default). Returns an Uzbek message on a refusal, or null on success. */
    suspend fun ack(key: String, minutes: Int?): String? = handle(repo.ack(key, minutes))

    /** Quiet hours: below-critical items stay silent inside the window (they are still listed). */
    suspend fun setQuiet(off: Boolean, from: String?, to: String?): String? = handle(repo.setQuietHours(off, from, to))

    private suspend fun <T> handle(r: ApiResult<T>): String? = when (r) {
        is ApiResult.Ok -> { pollOnce(); null }
        is ApiResult.Unauthorized -> { signedOut(); "Sessiya tugagan. Qayta kiring." }
        is ApiResult.Offline -> "Internet yo‘q. Qayta urinib ko‘ring."
        is ApiResult.Locked -> "Biroz kuting."
        is ApiResult.Failed -> { pollOnce(); r.message ?: "Amal bajarilmadi." }
    }

    private suspend fun pollOnce() {
        if (!session.isLoggedIn) return
        when (val r = repo.attention()) {
            is ApiResult.Ok -> {
                failures = 0
                latest = r.data.items
                _state.update {
                    it.copy(items = r.data.items, quiet = r.data.quiet, quietActive = r.data.quietActive, loaded = true, offline = false,
                        fetchedAtMs = SystemClock.elapsedRealtime())
                }
                publish()
            }
            is ApiResult.Unauthorized -> signedOut()
            else -> {
                failures++
                if (failures >= OFFLINE_AFTER) _state.update { it.copy(offline = true) }
            }
        }
    }

    /** Recomputes what rings and updates the sound and the notifications. */
    private fun publish() {
        val onDuty = session.duty.value
        val ringingNow = tracker.update(latest, SystemClock.elapsedRealtime())
        val waiting = tracker.pending()
        val level = if (onDuty) AttentionTracker.levelOf(ringingNow) else AlarmLevel.NONE
        alarm.setLevel(level)
        if (onDuty) notifier.alert(waiting, level != AlarmLevel.NONE) else notifier.alert(emptyList(), false)
        if (onDuty) notifier.updateDuty(dutyText(latest.size, waiting.size))
        // Items that never ring: one ordinary notification each (silent in quiet hours), withdrawn when solved or when off duty.
        val upd = notices.update(if (onDuty) latest.filter { it.notify } else emptyList())
        notifier.notices(upd.fresh, upd.gone, _state.value.quietActive, notices.openCount())
        _state.update { it.copy(ringing = level != AlarmLevel.NONE, waiting = waiting.map { w -> w.key }.toSet()) }
    }

    private fun dutyText(open: Int, ringing: Int): String = when {
        ringing > 0 -> "$ringing ta holat diqqat talab qiladi"
        open > 0 -> "$open ta ochiq holat (jiringlamaydi)"
        else -> "Hammasi joyida"
    }

    /** Re-evaluates the alarm when the duty switch changes. */
    fun dutyChanged() = publish()

    private fun signedOut() {
        session.clear()
        stop()
        onSignedOut()
    }

    /** Called from the PIN screen after too many wrong tries, and by the Settings sign-out. */
    fun signOutLocally() = signedOut()

    private companion object {
        const val POLL_MS = 5_000L
        const val FAST_MS = 3_000L
        const val OFFLINE_AFTER = 3
    }
}
