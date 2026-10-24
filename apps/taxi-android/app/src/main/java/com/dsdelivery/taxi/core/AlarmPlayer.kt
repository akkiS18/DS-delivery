package com.dsdelivery.taxi.core

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
 * The alarm: a short car-horn "pip-piiip" that repeats every couple of seconds until the request is answered.
 * The sound is generated here (no audio file) and played on the ALARM volume, so the phone's ringer/media volume and silent mode do not
 * mute it. Safe to call from any thread.
 */
class AlarmPlayer(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var loop: Job? = null
    private var track: AudioTrack? = null
    private var focus: AudioFocusRequest? = null

    @Volatile private var wanted = false

    /** True while the horn is repeating. */
    val isRinging: Boolean get() = wanted

    fun setRinging(on: Boolean) {
        if (on == wanted) return
        wanted = on
        if (on) start() else stop()
    }

    /** One horn, for the "Ovozni sinash" button. */
    fun beepOnce() {
        scope.launch { playHorn() }
    }

    /** Alarm volume 0..1 (0 = muted: the operator would not hear a thing). */
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
            while (isActive && wanted) {
                playHorn()
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

    private suspend fun playHorn() {
        val t = buildTrack() ?: return
        synchronized(this) { releaseTrack(); track = t }
        runCatching { t.play() }
        delay(HORN_MS.toLong())
    }

    private fun buildTrack(): AudioTrack? = runCatching {
        val pcm = hornPcm()
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

    private fun vibrate() {
        val v = vibrator() ?: return
        if (!v.hasVibrator()) return
        runCatching { v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 180, 90, 380), -1)) }
    }

    companion object {
        private const val SAMPLE_RATE = 22_050
        const val REPEAT_MS = 2_600L
        /** Two short blasts: ~0.2 s, a tiny gap, ~0.45 s. */
        private const val HORN_MS = 900

        /** Two detuned tones (like a two-note car horn) with a hard attack and a short release, so it is loud and unmistakable. */
        internal fun hornPcm(): ShortArray {
            fun blast(ms: Int): FloatArray {
                val n = SAMPLE_RATE * ms / 1000
                return FloatArray(n) { i ->
                    val t = i.toDouble() / SAMPLE_RATE
                    val tone = sin(2 * PI * 420 * t) + sin(2 * PI * 520 * t) + 0.35 * sin(2 * PI * 840 * t)
                    val attack = minOf(1.0, i / (SAMPLE_RATE * 0.004))
                    val release = minOf(1.0, (n - i) / (SAMPLE_RATE * 0.03))
                    (tone / 2.35 * attack * release).toFloat()
                }
            }
            val gap = FloatArray(SAMPLE_RATE * 90 / 1000)
            val all = blast(200) + gap + blast(450)
            return ShortArray(all.size) { (all[it].coerceIn(-1f, 1f) * 0.95f * Short.MAX_VALUE).toInt().toShort() }
        }
    }
}
