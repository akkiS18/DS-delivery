package com.dsdelivery.restaurant.data.alarm

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

/**
 * The kitchen bell: a LOUD, piercing two-tone "bi-bi-bi" (like a fast-food order buzzer) that repeats until the order is answered. A kitchen is
 * noisy, so it is built to cut through: full-scale square-wave beeps at 2.4 / 3.2 kHz, the range a phone speaker plays loudest and where kitchen
 * noise is weakest. Generated here (no audio file), played on the ALARM stream (silent mode does not mute it), and the alarm volume is raised to
 * the maximum whenever it rings. Safe to call from any thread.
 */
class AlarmPlayer(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var loop: Job? = null
    private var track: AudioTrack? = null
    private var focus: AudioFocusRequest? = null

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
        scope.launch { playBell() }
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
                playBell()
                vibrate()
                delay(REPEAT_MS)
            }
        }
    }

    @Synchronized
    private fun stop() {
        loop?.cancel()
        loop = null
        releaseTrack()
        abandonFocus()
        vibrator()?.cancel()
    }

    private suspend fun playBell() {
        val t = buildTrack() ?: return
        synchronized(this) { releaseTrack(); track = t }
        runCatching { t.play() }
        delay(BELL_MS.toLong())
    }

    private fun buildTrack(): AudioTrack? = runCatching {
        val pcm = bellPcm()
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val format = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
        val t = AudioTrack(attrs, format, pcm.size * 2, AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE)
        t.write(pcm, 0, pcm.size)
        t
    }.getOrNull()

    @Synchronized
    private fun releaseTrack() {
        track?.let { runCatching { it.stop() }; runCatching { it.release() } }
        track = null
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
        private const val SAMPLE_RATE = 44_100
        /** Short pause between rings: the order must not be missed, so the bell stays insistent until it is answered. */
        const val REPEAT_MS = 800L
        /** Two bursts of six beeps (see [bellPcm]) = about 2.5 s of sound. */
        private const val BELL_MS = 2_550

        /**
         * Six beeps alternating 2.4 kHz / 3.2 kHz (130 ms each, 70 ms apart), a short pause, and the six again. Square waves at full scale carry about
         * twice the power of a sine of the same height; the 3 ms ramps only stop the click. The player sets the phone's ALARM volume to the maximum,
         * so after that the phone's speaker is the limit.
         */
        internal fun bellPcm(): ShortArray {
            fun beep(hz: Double, ms: Int): FloatArray {
                val n = SAMPLE_RATE * ms / 1000
                val ramp = SAMPLE_RATE * 0.003
                return FloatArray(n) { i ->
                    val square = if (sin(2 * PI * hz * i / SAMPLE_RATE) >= 0.0) 1.0 else -1.0
                    (square * minOf(1.0, i / ramp, (n - i) / ramp)).toFloat()
                }
            }
            val gap = FloatArray(SAMPLE_RATE * 70 / 1000)
            var burst = FloatArray(0)
            for (k in 0 until 6) burst += beep(if (k % 2 == 0) 2400.0 else 3200.0, 130) + gap
            val all = burst + FloatArray(SAMPLE_RATE * 150 / 1000) + burst
            return ShortArray(all.size) { (all[it].coerceIn(-1f, 1f) * 0.98f * Short.MAX_VALUE).toInt().toShort() }
        }
    }
}
