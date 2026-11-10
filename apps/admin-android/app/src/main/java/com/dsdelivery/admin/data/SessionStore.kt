package com.dsdelivery.admin.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class Account(val telegramUserId: String)

/** The bearer token, the PIN (salted hash only), the failed-PIN counter and the "on duty" choice, in encrypted preferences. */
class SessionStore(private val context: Context) {

    private val prefs: SharedPreferences = createPrefs()

    private val _account = MutableStateFlow(load())
    val account: StateFlow<Account?> = _account.asStateFlow()

    private val _duty = MutableStateFlow(prefs.getBoolean(KEY_DUTY, true))
    /** On duty = the app listens in the background and rings. Off = it only shows items while it is open. */
    val duty: StateFlow<Boolean> = _duty.asStateFlow()

    val token: String? get() = prefs.getString(KEY_TOKEN, null)
    val isLoggedIn: Boolean get() = _account.value != null && !token.isNullOrBlank()

    /** The last Telegram id typed on the login screen (kept after sign-out so it need not be typed again). */
    val lastTelegramId: String get() = prefs.getString(KEY_LAST_ID, null).orEmpty()

    private fun createPrefs(): SharedPreferences = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "ds_admin_secure_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        Log.e(TAG, "Encrypted preferences unavailable, using app-private storage", e)
        context.getSharedPreferences("ds_admin_private_session", Context.MODE_PRIVATE)
    }

    private fun load(): Account? {
        val token = prefs.getString(KEY_TOKEN, null)
        val id = prefs.getString(KEY_ID, null)
        return if (!token.isNullOrBlank() && !id.isNullOrBlank()) Account(id) else null
    }

    fun rememberTelegramId(id: String) {
        prefs.edit().putString(KEY_LAST_ID, id).apply()
    }

    fun save(token: String, telegramUserId: String) {
        // A different administrator on this phone must not inherit the previous PIN.
        if (prefs.getString(KEY_ID, null) != null && prefs.getString(KEY_ID, null) != telegramUserId) clearPin()
        prefs.edit().putString(KEY_TOKEN, token).putString(KEY_ID, telegramUserId).putString(KEY_LAST_ID, telegramUserId).apply()
        _account.value = Account(telegramUserId)
    }

    /** Signing out also removes the PIN: the next sign-in needs a new Telegram code and a new PIN. */
    fun clear() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_ID).apply()
        clearPin()
        _account.value = null
    }

    fun setDuty(on: Boolean) {
        prefs.edit().putBoolean(KEY_DUTY, on).apply()
        _duty.value = on
    }

    // ---- PIN ----
    val hasPin: Boolean get() = !prefs.getString(KEY_PIN_HASH, null).isNullOrBlank()
    val pinSalt: String get() = prefs.getString(KEY_PIN_SALT, null).orEmpty()
    val pinHash: String get() = prefs.getString(KEY_PIN_HASH, null).orEmpty()

    /** [length] is remembered so the keypad can open the app the moment the last digit is typed (0 = unknown: a PIN made by an older version). */
    fun savePin(salt: String, hash: String, length: Int = 0) {
        prefs.edit().putString(KEY_PIN_SALT, salt).putString(KEY_PIN_HASH, hash).putInt(KEY_PIN_LEN, length).putInt(KEY_PIN_FAILS, 0).putLong(KEY_PIN_LOCKED_UNTIL, 0L).apply()
    }

    val pinLength: Int get() = prefs.getInt(KEY_PIN_LEN, 0)

    /** Learned after a correct manual unlock for a PIN that was saved without its length. */
    fun rememberPinLength(length: Int) {
        prefs.edit().putInt(KEY_PIN_LEN, length).apply()
    }

    /** Fingerprint / face unlock chosen by the administrator on this phone (asked when the PIN is created, or switched in Sozlamalar). */
    val biometricEnabled: Boolean get() = prefs.getBoolean(KEY_BIOMETRIC, false)

    fun setBiometricEnabled(on: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC, on).apply()
    }

    private fun clearPin() {
        prefs.edit().remove(KEY_PIN_SALT).remove(KEY_PIN_HASH).remove(KEY_PIN_LEN).remove(KEY_BIOMETRIC).remove(KEY_PIN_FAILS).remove(KEY_PIN_LOCKED_UNTIL).apply()
    }

    val pinFails: Int get() = prefs.getInt(KEY_PIN_FAILS, 0)
    /** Wall-clock time (ms) until which the keypad is locked; 0 = not locked. */
    val pinLockedUntil: Long get() = prefs.getLong(KEY_PIN_LOCKED_UNTIL, 0L)

    fun recordPinFailure(fails: Int, lockedUntilMs: Long) {
        prefs.edit().putInt(KEY_PIN_FAILS, fails).putLong(KEY_PIN_LOCKED_UNTIL, lockedUntilMs).apply()
    }

    fun resetPinFailures() {
        prefs.edit().putInt(KEY_PIN_FAILS, 0).putLong(KEY_PIN_LOCKED_UNTIL, 0L).apply()
    }

    private companion object {
        const val TAG = "SessionStore"
        const val KEY_TOKEN = "token"
        const val KEY_ID = "telegram_id"
        const val KEY_LAST_ID = "last_telegram_id"
        const val KEY_DUTY = "duty"
        const val KEY_PIN_SALT = "pin_salt"
        const val KEY_PIN_HASH = "pin_hash"
        const val KEY_PIN_LEN = "pin_len"
        const val KEY_BIOMETRIC = "biometric"
        const val KEY_PIN_FAILS = "pin_fails"
        const val KEY_PIN_LOCKED_UNTIL = "pin_locked_until"
    }
}
