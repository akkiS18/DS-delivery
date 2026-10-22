package com.dsdelivery.restaurant.ui.components

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * A monotonic "now" (SystemClock.elapsedRealtime) that ticks every [periodMs] ONLY while the screen is at least STARTED.
 * In the background nothing runs (no CPU, no battery); on return the value is recomputed immediately, and because the monotonic
 * clock keeps counting while the app is paused the countdown is correct the moment the user is back.
 *
 * It returns a [State] on purpose: callers pass it down and read `.value` inside the small composable that shows the time, so only
 * that composable recomposes each tick, not the whole screen or list.
 */
@Composable
fun rememberNowElapsed(periodMs: Long = 1000L, enabled: Boolean = true): State<Long> {
    val owner = LocalLifecycleOwner.current
    return produceState(initialValue = SystemClock.elapsedRealtime(), periodMs, enabled, owner) {
        value = SystemClock.elapsedRealtime()
        if (!enabled) return@produceState
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                val now = SystemClock.elapsedRealtime()
                value = now
                // align to the next boundary so the displayed second changes on time instead of drifting
                delay((periodMs - (now % periodMs)).coerceIn(50L, periodMs))
            }
        }
    }
}
