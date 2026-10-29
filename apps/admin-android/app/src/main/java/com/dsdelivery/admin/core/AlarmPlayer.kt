package com.dsdelivery.admin.core

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
 * The alarm. LOUD = a car-horn "pip-piiip" (a critical item: a customer has paid and nobody answers). SOFT = a lighter double beep
 * (an item that matters but is not an emergency). Both repeat until nothing rings any more.
 * The sound is generated here (no audio file) and played on the ALARM volume, so the phone's ringer/media volume and silent mode do not
 * mute it. Safe to call from any thread.
 */
class AlarmPlayer(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var loop: Job? = null
    private var track: AudioTrack? = null
    private var focus: AudioFocusRequest? = null

    @Volatile private var level = AlarmLevel.NONE

    /** True while the alarm is repeating. */
    val isRinging: Boolean get() = level != AlarmLevel.NONE

    fun setLevel(next: AlarmLevel) {
        if (next == level) return
        val was = level
        level = next
        if (next == AlarmLevel.NONE) stop() else if (was == AlarmLevel.NONE) start()
        // LOUD <-> SOFT: the running loop reads the level on every round, nothing to restart.
    }

    /** One horn, for the "Ovozni sinash" button. */
    fun beepOnce() {
        scope.launch { play(hornPcm()) }
    }

    /** Alarm volume 0..1 (0 = muted: the administrator would not hear a thing). */
    fun volumeFraction(): Float {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM).coerceAtLeast(1)
        return audio.getStreamVolume(AudioManager.STREAM_ALARM).toFloat() / max
    }

    fun setVolumeFraction(fraction: Float) {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, (max * fraction).toInt().coerceIn(1, max), AudioManager.FLAG_SHOW_UI) }
    }

    @Synchronized
    private fun start() {
        loop?.cancel()
        loop = scope.launch {
            requestFocus()
            while (isActive && level != AlarmLevel.NONE) {
                val current = level
                play(if (current == AlarmLevel.LOUD) hornPcm() else chimePcm())
                vibrate(current)
                delay(if (current == AlarmLevel.LOUD) LOUD_REPEAT_MS else SOFT_REPEAT_MS)
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

    private suspend fun play(pcm: ShortArray) {
        val t = buildTrack(pcm) ?: return
        synchronized(this) { releaseTrack(); track = t }
        runCatching { t.play() }
        delay(pcm.size * 1000L / SAMPLE_RATE)
    }

    private fun buildTrack(pcm: ShortArray): AudioTrack? = runCatching {
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
        if (Build.VERSION.SDK_INT < 26) return
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .build()
        focus = req
        runCatching { audio.requestAudioFocus(req) }
    }

    private fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= 26) focus?.let { runCatching { audio.abandonAudioFocusRequest(it) } }
        focus = null
    }

    private fun vibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        else @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

    private fun vibrate(forLevel: AlarmLevel) {
        val v = vibrator() ?: return
        if (!v.hasVibrator()) return
        val pattern = if (forLevel == AlarmLevel.LOUD) longArrayOf(0, 180, 90, 380) else longArrayOf(0, 120, 80, 120)
        runCatching { v.vibrate(VibrationEffect.createWaveform(pattern, -1)) }
    }

    companion object {
        private const val SAMPLE_RATE = 22_050
        const val LOUD_REPEAT_MS = 2_600L
        const val SOFT_REPEAT_MS = 4_500L

        private fun envelope(i: Int, n: Int): Double {
            val attack = minOf(1.0, i / (SAMPLE_RATE * 0.004))
            val release = minOf(1.0, (n - i) / (SAMPLE_RATE * 0.03))
            return attack * release
        }

        private fun toShorts(all: FloatArray, gain: Float): ShortArray =
            ShortArray(all.size) { (all[it].coerceIn(-1f, 1f) * gain * Short.MAX_VALUE).toInt().toShort() }

        /** Two detuned tones (like a two-note car horn): two short blasts, loud and unmistakable. */
        internal fun hornPcm(): ShortArray {
            fun blast(ms: Int): FloatArray {
                val n = SAMPLE_RATE * ms / 1000
                return FloatArray(n) { i ->
                    val t = i.toDouble() / SAMPLE_RATE
                    val tone = sin(2 * PI * 420 * t) + sin(2 * PI * 520 * t) + 0.35 * sin(2 * PI * 840 * t)
                    (tone / 2.35 * envelope(i, n)).toFloat()
                }
            }
            val gap = FloatArray(SAMPLE_RATE * 90 / 1000)
            return toShorts(blast(200) + gap + blast(450), 0.95f)
        }

        /** A clean double beep at 880 Hz: noticeable, but clearly not the emergency horn. */
        internal fun chimePcm(): ShortArray {
            fun beep(ms: Int): FloatArray {
                val n = SAMPLE_RATE * ms / 1000
                return FloatArray(n) { i -> (sin(2 * PI * 880 * (i.toDouble() / SAMPLE_RATE)) * envelope(i, n)).toFloat() }
            }
            val gap = FloatArray(SAMPLE_RATE * 120 / 1000)
            return toShorts(beep(160) + gap + beep(160), 0.8f)
        }
    }
}
