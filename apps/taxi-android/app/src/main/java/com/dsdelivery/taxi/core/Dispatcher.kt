package com.dsdelivery.taxi.core

import android.os.SystemClock
import com.dsdelivery.taxi.data.ApiResult
import com.dsdelivery.taxi.data.RequestDto
import com.dsdelivery.taxi.data.Repository
import com.dsdelivery.taxi.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class DispatchState(
    val active: List<RequestDto> = emptyList(),
    val history: List<RequestDto> = emptyList(),
    /** True once at least one list has arrived (so the screen can tell "empty" from "not loaded yet"). */
    val loaded: Boolean = false,
    /** Several polls in a row failed: the app cannot hear new requests right now. */
    val offline: Boolean = false,
    val ringing: Boolean = false,
    /** Keys (id:status) the operator has to answer. */
    val waiting: Set<String> = emptySet(),
    val lastOkAtMs: Long = 0L,
    /** Server clock minus phone clock, so countdowns are right even when the phone clock is off. */
    val clockOffsetMs: Long = 0L,
)

/**
 * The heart of the app: polls the server every few seconds, keeps the screen state, and runs the alarm. One instance for the whole process;
 * the foreground service keeps the process (and so this loop) alive while the operator is on duty.
 */
class Dispatcher(
    private val scope: CoroutineScope,
    private val repo: Repository,
    private val session: SessionStore,
    private val alarm: AlarmPlayer,
    private val notifier: Notifier,
    private val onSignedOut: () -> Unit,
) {
    private val tracker = AttentionTracker()
    private val _state = MutableStateFlow(DispatchState())
    val state: StateFlow<DispatchState> = _state.asStateFlow()

    private var job: Job? = null
    private var failures = 0
    private var latest: List<RequestDto> = emptyList()

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
        alarm.setRinging(false)
        notifier.alert(emptyList(), false)
        failures = 0
        latest = emptyList()
        _state.value = DispatchState()
    }

    /** Pull-to-refresh and the "returned to the app" refresh. */
    fun refreshNow() {
        scope.launch { pollOnce() }
    }

    fun silence() {
        tracker.silence(SystemClock.elapsedRealtime())
        publish()
    }

    /** Presses a button. Returns the server's Uzbek message on a refusal, or null on success. */
    suspend fun act(id: String, action: String): String? {
        return when (val r = repo.act(id, action)) {
            is ApiResult.Ok -> { pollOnce(); null }
            is ApiResult.Unauthorized -> { signedOut(); "Sessiya tugagan. Qayta kiring." }
            is ApiResult.Offline -> "Internet yo‘q. Qayta urinib ko‘ring."
            is ApiResult.Locked -> "Biroz kuting."
            is ApiResult.Failed -> { pollOnce(); r.message ?: "Amal bajarilmadi." }
        }
    }

    private suspend fun pollOnce() {
        if (!session.isLoggedIn) return
        when (val r = repo.requests()) {
            is ApiResult.Ok -> {
                failures = 0
                val now = System.currentTimeMillis()
                val server = runCatching { java.time.Instant.parse(r.data.serverNow).toEpochMilli() }.getOrDefault(now)
                latest = r.data.active
                _state.update {
                    it.copy(active = r.data.active, history = r.data.history, loaded = true, offline = false,
                        lastOkAtMs = SystemClock.elapsedRealtime(), clockOffsetMs = server - now)
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

    /** Recomputes who is ringing and updates the sound and the notifications. */
    private fun publish() {
        val onDuty = session.duty.value
        val ringingKeys = tracker.update(latest, SystemClock.elapsedRealtime())
        val waiting = tracker.pending()
        val ring = onDuty && ringingKeys.isNotEmpty()
        alarm.setRinging(ring)
        val pendingRequests = latest.filter { AttentionTracker.keyOf(it) in waiting }
        if (onDuty) notifier.alert(pendingRequests, ring) else notifier.alert(emptyList(), false)
        if (onDuty) notifier.updateDuty(dutyText(latest.size, pendingRequests.size))
        _state.update { it.copy(ringing = ring, waiting = waiting) }
    }

    private fun dutyText(active: Int, waiting: Int): String = when {
        waiting > 0 -> "$waiting ta so‘rov javob kutmoqda"
        active > 0 -> "$active ta faol buyurtma"
        else -> "Yangi so‘rovlarni kutyapman"
    }

    /** Re-evaluates the alarm when the duty switch changes. */
    fun dutyChanged() = publish()

    private fun signedOut() {
        session.clear()
        stop()
        onSignedOut()
    }

    private companion object {
        const val POLL_MS = 3_000L
        const val FAST_MS = 2_000L
        const val OFFLINE_AFTER = 3
    }
}
