package com.dsdelivery.taxi.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class Account(val companyName: String, val login: String)

/** The bearer token and the "on duty" choice, kept in encrypted preferences. The password is never stored. */
class SessionStore(private val context: Context) {

    private val prefs: SharedPreferences = createPrefs()

    private val _account = MutableStateFlow(load())
    val account: StateFlow<Account?> = _account.asStateFlow()

    private val _duty = MutableStateFlow(prefs.getBoolean(KEY_DUTY, true))
    /** On duty = the app listens in the background and rings. Off = it only shows requests while it is open. */
    val duty: StateFlow<Boolean> = _duty.asStateFlow()

    val token: String? get() = prefs.getString(KEY_TOKEN, null)
    val isLoggedIn: Boolean get() = _account.value != null && !token.isNullOrBlank()

    private fun createPrefs(): SharedPreferences = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "ds_taxi_secure_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        Log.e(TAG, "Encrypted preferences unavailable, using app-private storage", e)
        context.getSharedPreferences("ds_taxi_private_session", Context.MODE_PRIVATE)
    }

    private fun load(): Account? {
        val token = prefs.getString(KEY_TOKEN, null)
        val name = prefs.getString(KEY_COMPANY, null)
        val login = prefs.getString(KEY_LOGIN, null)
        return if (!token.isNullOrBlank() && !name.isNullOrBlank() && !login.isNullOrBlank()) Account(name, login) else null
    }

    fun save(token: String, companyName: String, login: String) {
        prefs.edit().putString(KEY_TOKEN, token).putString(KEY_COMPANY, companyName).putString(KEY_LOGIN, login).apply()
        _account.value = Account(companyName, login)
    }

    fun clear() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_COMPANY).remove(KEY_LOGIN).apply()
        _account.value = null
    }

    fun setDuty(on: Boolean) {
        prefs.edit().putBoolean(KEY_DUTY, on).apply()
        _duty.value = on
    }

    private companion object {
        const val TAG = "SessionStore"
        const val KEY_TOKEN = "token"
        const val KEY_COMPANY = "company"
        const val KEY_LOGIN = "login"
        const val KEY_DUTY = "duty"
    }
}
