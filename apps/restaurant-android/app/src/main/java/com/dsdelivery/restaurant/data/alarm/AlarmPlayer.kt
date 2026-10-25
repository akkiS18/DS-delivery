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
 * The kitchen bell: a short two-tone "ding-dong" that repeats every few seconds until the order is answered. Generated here (no audio file) and
 * played on the ALARM volume, so the ringer/media volume and silent mode do not mute it. Safe to call from any thread.
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
        scope.launch { playBell() }
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
        runCatching { v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 200, 120, 200), -1)) }
    }

    companion object {
        private const val SAMPLE_RATE = 22_050
        const val REPEAT_MS = 3_500L
        private const val BELL_MS = 1_200

        /** Two bell notes (a high one, then a lower one) with a hard attack and a long fade, so it is clear and unlike a phone call. */
        internal fun bellPcm(): ShortArray {
            fun note(hz: Double, ms: Int): FloatArray {
                val n = SAMPLE_RATE * ms / 1000
                return FloatArray(n) { i ->
                    val t = i.toDouble() / SAMPLE_RATE
                    val tone = sin(2 * PI * hz * t) + 0.5 * sin(2 * PI * hz * 2 * t) + 0.25 * sin(2 * PI * hz * 3 * t)
                    val attack = minOf(1.0, i / (SAMPLE_RATE * 0.004))
                    val fade = 1.0 - i.toDouble() / n
                    (tone / 1.75 * attack * fade).toFloat()
                }
            }
            val all = note(880.0, 450) + note(660.0, 650)
            return ShortArray(all.size) { (all[it].coerceIn(-1f, 1f) * 0.95f * Short.MAX_VALUE).toInt().toShort() }
        }
    }
}
