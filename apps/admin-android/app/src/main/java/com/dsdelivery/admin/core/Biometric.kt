package com.dsdelivery.admin.core

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal

/**
 * Fingerprint / face check with the platform's own prompt (no extra library). It only answers "is the person at the phone the one who
 * enrolled on it": it protects the screen exactly like the PIN does, so a failure or a cancel simply leaves the PIN keypad in place and never
 * counts as a wrong PIN. Needs Android 10 (API 29); on older phones [available] is false and only the PIN is used.
 */
object Biometric {

    /** True when this phone has a strong biometric enrolled right now (checked on every use, so removing a finger switches it off by itself). */
    fun available(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val manager = context.getSystemService(BiometricManager::class.java) ?: return false
        return if (Build.VERSION.SDK_INT >= 30) {
            manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            manager.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS
        }
    }

    /**
     * Shows the prompt. [onResult] gets true once, when the person was recognised; false when the prompt ended without it (cancelled,
     * "PIN" button, too many wrong fingers, no sensor). A finger that is not recognised makes the system ask again by itself.
     * Returns the signal to cancel the prompt (call it when the screen goes away).
     */
    fun prompt(context: Context, title: String, subtitle: String?, usePinText: String, onResult: (Boolean) -> Unit): CancellationSignal? {
        if (!available(context)) { onResult(false); return null }
        val signal = CancellationSignal()
        var finished = false
        fun finish(ok: Boolean) { if (!finished) { finished = true; onResult(ok) } }
        val builder = BiometricPrompt.Builder(context).setTitle(title).apply { subtitle?.let { setSubtitle(it) } }
        if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        builder.setNegativeButton(usePinText, context.mainExecutor) { _, _ -> finish(false) }
        runCatching {
            builder.build().authenticate(signal, context.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) = finish(true)
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) = finish(false)
            })
        }.onFailure { finish(false) }
        return signal
    }
}
