package com.dsdelivery.restaurant.data.alarm

import android.content.Context
import com.dsdelivery.restaurant.R
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The kitchen alarm: the new-order ringtone followed by the phone's voice saying "Yangi buyurtma" (see [OrderVoice]), repeated until the
 * order is answered. Owner request 2026-10-30: the earlier piercing square-wave beeps were unpleasant and did not sound like "a new order". The
 * ringtone is the owner's own recording (res/raw/new_order.mp3, owner decision 2026-11-05, replacing the generated chime), everything plays on the ALARM
 * stream (silent mode does not mute it), and the alarm volume is raised to the maximum whenever it rings. Safe to call from any thread.
 */
class AlarmPlayer(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var loop: Job? = null
    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null
    private val voice = OrderVoice(context)

    @Volatile private var wanted = false

    val isRinging: Boolean get() = wanted

    fun setRinging(on: Boolean) {
        if (on == wanted) return
        wanted = on
        if (on) start() else stop()
    }

    /** One bell, for the "Ovozni sinash" button. */
    fun beepOnce() {
        raiseToMaxVolume()
        scope.launch { playBell(); voice.say() }
    }

    /** A noisy kitchen needs every bit of the phone's volume: the alarm stream goes to the maximum while the bell rings (and for the test button). */
    private fun raiseToMaxVolume() {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        if (audio.getStreamVolume(AudioManager.STREAM_ALARM) < max) runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, max, 0) }
    }

    /** Alarm volume 0..1 (0 = muted: the kitchen would not hear a thing). */
    fun volumeFraction(): Float {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM).coerceAtLeast(1)
        return audio.getStreamVolume(AudioManager.STREAM_ALARM).toFloat() / max
    }

    @Synchronized
    private fun start() {
        loop?.cancel()
        loop = scope.launch {
            requestFocus()
            while (isActive && wanted) {
                raiseToMaxVolume() // somebody may have turned it down again since the last ring
                vibrate()
                playBell()
                voice.say()
                delay(REPEAT_MS)
            }
        }
    }

    @Synchronized
    private fun stop() {
        loop?.cancel()
        loop = null
        releasePlayer()
        voice.stop()
        abandonFocus()
        vibrator()?.cancel()
    }

    /** Plays the ringtone once and returns when it ends (or after [MAX_RING_MS] at most). */
    private suspend fun playBell() {
        val done = CompletableDeferred<Unit>()
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val p = runCatching { MediaPlayer.create(context, R.raw.new_order, attrs, AudioManager.AUDIO_SESSION_ID_GENERATE) }.getOrNull() ?: return
        p.setOnCompletionListener { done.complete(Unit) }
        p.setOnErrorListener { _, _, _ -> done.complete(Unit); true }
        synchronized(this) { releasePlayer(); player = p }
        runCatching { p.start() }.onFailure { return }
        try { withTimeoutOrNull(MAX_RING_MS) { done.await() } } finally { releasePlayer() } // also when the ring is cancelled mid-way
    }

    @Synchronized
    private fun releasePlayer() {
        player?.let { runCatching { it.stop() }; runCatching { it.release() } }
        player = null
    }

    private fun requestFocus() {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .build()
        focus = req
        runCatching { audio.requestAudioFocus(req) }
    }

    private fun abandonFocus() {
        focus?.let { runCatching { audio.abandonAudioFocusRequest(it) } }
        focus = null
    }

    private fun vibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        else @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

    private fun vibrate() {
        val v = vibrator() ?: return
        if (!v.hasVibrator()) return
        runCatching { v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 120, 300, 120, 300), -1)) }
    }

    companion object {
        /** Pause after the voice before the next round: the order must not be missed, so it stays insistent until it is answered. */
        const val REPEAT_MS = 1_200L
        /** A ringtone that never ends (a broken file) must not freeze the loop. */
        private const val MAX_RING_MS = 15_000L
    }
}
