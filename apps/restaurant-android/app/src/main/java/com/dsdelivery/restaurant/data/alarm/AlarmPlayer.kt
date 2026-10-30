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
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.tanh

/**
 * The kitchen alarm: a pleasant two-note chime followed by the phone's voice saying "Yangi buyurtma" (see [OrderVoice]), repeated until the
 * order is answered. Owner request 2026-10-30: the earlier piercing square-wave beeps were unpleasant and did not sound like "a new order". The
 * chime is generated here (no audio file), everything plays on the ALARM stream (silent mode does not mute it), and the alarm volume is raised to
 * the maximum whenever it rings. Safe to call from any thread.
 */
class AlarmPlayer(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var loop: Job? = null
    private var track: AudioTrack? = null
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
        releaseTrack()
        voice.stop()
        abandonFocus()
        vibrator()?.cancel()
    }

    private suspend fun playBell() {
        val t = buildTrack() ?: return
        synchronized(this) { releaseTrack(); track = t }
        runCatching { t.play() }
        delay(CHIME_MS.toLong())
    }

    private fun buildTrack(): AudioTrack? = runCatching {
        val pcm = chimePcm()
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
        /** Pause after the voice before the next round: the order must not be missed, so it stays insistent until it is answered. */
        const val REPEAT_MS = 1_200L
        /** Length of [chimePcm] in milliseconds. */
        private const val CHIME_MS = 1_150

        /**
         * A two-note "ding-dong" (B5 then E6, a rising fourth) of bell-like tones: a fundamental plus its 2nd and 3rd partials, a soft 8 ms attack
         * and a smooth decay, so it is clear and friendly rather than sharp. A little soft saturation raises the average loudness without any
         * harsh edge. The voice follows it; the player sets the phone's ALARM volume to the maximum, so the phone's speaker is the limit.
         */
        internal fun chimePcm(): ShortArray {
            fun note(hz: Double, ms: Int, tauMs: Double): FloatArray {
                val n = SAMPLE_RATE * ms / 1000
                val attack = SAMPLE_RATE * 0.008
                return FloatArray(n) { i ->
                    val t = i.toDouble() / SAMPLE_RATE
                    val tone = sin(2 * PI * hz * t) + 0.45 * sin(2 * PI * 2 * hz * t) + 0.18 * sin(2 * PI * 3 * hz * t)
                    val env = minOf(1.0, i / attack) * exp(-t * 1000.0 / tauMs) * minOf(1.0, (n - i) / (SAMPLE_RATE * 0.03))
                    (tone * env / 1.63).toFloat()
                }
            }
            val total = SAMPLE_RATE * CHIME_MS / 1000
            val mix = FloatArray(total)
            fun add(from: FloatArray, at: Int) { for (i in from.indices) if (at + i < total) mix[at + i] += from[i] }
            add(note(987.77, 650, 260.0), 0)
            add(note(1318.51, 800, 330.0), SAMPLE_RATE * 300 / 1000)
            val drive = 1.7
            return ShortArray(total) { (tanh(mix[it] * drive) / tanh(drive) * 0.97 * Short.MAX_VALUE).toInt().toShort() }
        }
    }
}
