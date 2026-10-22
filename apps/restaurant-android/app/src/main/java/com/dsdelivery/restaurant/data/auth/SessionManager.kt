package com.dsdelivery.restaurant.data.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.dsdelivery.restaurant.data.model.Restaurant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface SessionState {
    data object Unchecked : SessionState
    data object LoggedOut : SessionState
    data class LoggedIn(val restaurant: Restaurant, val expiresAt: String) : SessionState
}

class SessionManager(private val context: Context) {

    private val prefs: SharedPreferences = createEncryptedPrefs()

    private val _sessionState = MutableStateFlow<SessionState>(SessionState.Unchecked)
    val sessionState: StateFlow<SessionState> = _sessionState.asStateFlow()

    init {
        loadSession()
    }

    private fun createEncryptedPrefs(): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                context,
                ENCRYPTED_PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize EncryptedSharedPreferences, falling back to secure app-private storage", e)
            context.getSharedPreferences(FALLBACK_PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    private fun loadSession() {
        val token = prefs.getString(KEY_ACCESS_TOKEN, null)
        val id = prefs.getString(KEY_RESTAURANT_ID, null)
        val slug = prefs.getString(KEY_RESTAURANT_SLUG, null)
        val name = prefs.getString(KEY_RESTAURANT_NAME, null)
        val isPaused = prefs.getBoolean(KEY_RESTAURANT_IS_PAUSED, false)
        val expiresAt = prefs.getString(KEY_EXPIRES_AT, null)

        if (!token.isNullOrBlank() && !slug.isNullOrBlank() && !id.isNullOrBlank() && !name.isNullOrBlank() && !expiresAt.isNullOrBlank()) {
            val restaurant = Restaurant(id = id, slug = slug, name = name, isPaused = isPaused)
            _sessionState.value = SessionState.LoggedIn(restaurant = restaurant, expiresAt = expiresAt)
        } else {
            _sessionState.value = SessionState.LoggedOut
        }
    }

    fun saveSession(accessToken: String, restaurant: Restaurant, expiresAt: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_RESTAURANT_ID, restaurant.id)
            .putString(KEY_RESTAURANT_SLUG, restaurant.slug)
            .putString(KEY_RESTAURANT_NAME, restaurant.name)
            .putBoolean(KEY_RESTAURANT_IS_PAUSED, restaurant.isPaused)
            .putString(KEY_EXPIRES_AT, expiresAt)
            .apply()

        _sessionState.value = SessionState.LoggedIn(restaurant = restaurant, expiresAt = expiresAt)
    }

    fun getAccessToken(): String? {
        return prefs.getString(KEY_ACCESS_TOKEN, null)
    }

    fun getRestaurant(): Restaurant? {
        val id = prefs.getString(KEY_RESTAURANT_ID, null) ?: return null
        val slug = prefs.getString(KEY_RESTAURANT_SLUG, null) ?: return null
        val name = prefs.getString(KEY_RESTAURANT_NAME, null) ?: return null
        val isPaused = prefs.getBoolean(KEY_RESTAURANT_IS_PAUSED, false)
        return Restaurant(id = id, slug = slug, name = name, isPaused = isPaused)
    }

    fun getExpiresAt(): String? {
        return prefs.getString(KEY_EXPIRES_AT, null)
    }

    fun clearSession() {
        prefs.edit().clear().apply()
        _sessionState.value = SessionState.LoggedOut
    }

    val isLoggedIn: Boolean
        get() = _sessionState.value is SessionState.LoggedIn

    companion object {
        private const val TAG = "SessionManager"
        private const val ENCRYPTED_PREFS_NAME = "ds_restaurant_secure_session"
        private const val FALLBACK_PREFS_NAME = "ds_restaurant_private_session"

        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_RESTAURANT_ID = "restaurant_id"
        private const val KEY_RESTAURANT_SLUG = "restaurant_slug"
        private const val KEY_RESTAURANT_NAME = "restaurant_name"
        private const val KEY_RESTAURANT_IS_PAUSED = "restaurant_is_paused"
        private const val KEY_EXPIRES_AT = "expires_at"
    }
}
