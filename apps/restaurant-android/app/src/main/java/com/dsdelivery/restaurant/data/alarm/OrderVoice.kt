package com.dsdelivery.restaurant.data.alarm

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale

/**
 * The voice of the bell: the phone says "Yangi buyurtma" (new order) after the chime. A voice is pleasant, cannot be mistaken for an ordinary
 * notification and is understood at once in a noisy kitchen. It uses the phone's own speech engine (no audio file, nothing downloaded by the app):
 * Uzbek if the engine has it, otherwise the same words read by the Russian voice, otherwise English "New order". If the phone has no speech engine
 * at all, [say] returns at once and the chime alone rings. Spoken on the ALARM stream like the chime.
 */
class OrderVoice(context: Context) {

    private class Option(val locale: Locale, val text: String)

    private val lock = Any()
    private var tts: TextToSpeech? = null
    private var options: List<Option> = emptyList()
    private var index = 0
    @Volatile private var pending: CompletableDeferred<Boolean>? = null

    init {
        synchronized(lock) { tts = TextToSpeech(context.applicationContext) { status -> onInit(status) } }
    }

    private fun onInit(status: Int) {
        synchronized(lock) { initEngine(status) }
    }

    private fun initEngine(status: Int) {
        val engine = tts ?: return
        if (status != TextToSpeech.SUCCESS) { options = emptyList(); return }
        runCatching {
            engine.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            engine.setSpeechRate(0.92f)
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { pending?.complete(true) }
                @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) { pending?.complete(false) }
                override fun onError(utteranceId: String?, errorCode: Int) { pending?.complete(false) }
            })
            options = listOf(Option(Locale("uz"), "Yangi buyurtma"), Option(Locale("ru"), "Янги буюртма"), Option(Locale.ENGLISH, "New order"))
                .filter { engine.isLanguageAvailable(it.locale) >= TextToSpeech.LANG_AVAILABLE }
        }.onFailure { options = emptyList() }
    }

    /** Speaks once and returns when it is finished (or after a few seconds at most). A language that fails is skipped from then on. */
    suspend fun say() {
        val engine: TextToSpeech
        val option: Option
        synchronized(lock) {
            engine = tts ?: return
            option = options.getOrNull(index) ?: return
        }
        val done = CompletableDeferred<Boolean>()
        pending = done
        val started = runCatching {
            if (engine.setLanguage(option.locale) < TextToSpeech.LANG_AVAILABLE) return@runCatching false
            val params = Bundle().apply {
                putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f)
                putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_ALARM)
            }
            engine.speak(option.text, TextToSpeech.QUEUE_FLUSH, params, "new-order") == TextToSpeech.SUCCESS
        }.getOrDefault(false)
        val ok = if (started) withTimeoutOrNull(SPEECH_TIMEOUT_MS) { done.await() } else false
        if (ok == false) synchronized(lock) { if (options.getOrNull(index) === option) index++ }
    }

    fun stop() {
        runCatching { synchronized(lock) { tts }?.stop() }
        pending?.complete(true)
    }

    private companion object {
        const val SPEECH_TIMEOUT_MS = 4_000L
    }
}
