package com.dsdelivery.restaurant.data.api

import android.content.Context
import android.content.SharedPreferences
import com.dsdelivery.restaurant.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

class ApiConfig(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _baseUrlFlow = MutableStateFlow(loadBaseUrl())
    val baseUrlFlow: StateFlow<String> = _baseUrlFlow.asStateFlow()

    var baseUrl: String
        get() = _baseUrlFlow.value
        set(value) {
            val normalized = normalizeUrl(value)
            // Refuse (do not store) anything that fails the HTTPS policy.
            if (validationError(normalized) != null) return
            prefs.edit().putString(KEY_BASE_URL, normalized).apply()
            _baseUrlFlow.value = normalized
        }

    private fun loadBaseUrl(): String {
        val saved = prefs.getString(KEY_BASE_URL, null)
        val savedNormalized = saved?.takeIf { it.isNotBlank() }?.let { normalizeUrl(it) }
        return if (savedNormalized != null && validationError(savedNormalized) == null) {
            savedNormalized
        } else {
            normalizeUrl(BuildConfig.DEFAULT_BASE_URL)
        }
    }

    fun resetToDefault() {
        baseUrl = BuildConfig.DEFAULT_BASE_URL
    }

    companion object {
        private const val PREFS_NAME = "ds_restaurant_api_config"
        private const val KEY_BASE_URL = "api_base_url"

        const val EMULATOR_URL = "http://10.0.2.2:4000/"
        const val LOCALHOST_URL = "http://127.0.0.1:4000/"

        fun normalizeUrl(url: String): String {
            var trimmed = url.trim()
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
                // Local development may omit the scheme; everything else is HTTPS.
                trimmed = if (BuildConfig.DEBUG) "http://$trimmed" else "https://$trimmed"
            }
            if (!trimmed.endsWith("/")) {
                trimmed = "$trimmed/"
            }
            return trimmed
        }

        /**
         * Null when [url] may be used. Production (release) builds accept HTTPS only; plain HTTP
         * is limited to debug builds talking to a local-development host.
         */
        fun validationError(url: String): String? {
            val parsed = normalizeUrl(url).toHttpUrlOrNull()
                ?: return "URL formati noto‘g‘ri"
            if (parsed.isHttps) return null
            if (!BuildConfig.DEBUG) return "Faqat HTTPS manzillariga ruxsat beriladi"
            if (!isLocalDevelopmentHost(parsed.host)) {
                return "HTTP faqat lokal ishlab chiqish manzillari uchun (10.0.2.2, localhost, lokal tarmoq IP)"
            }
            return null
        }

        private fun isLocalDevelopmentHost(host: String): Boolean {
            if (host == "localhost" || host == "10.0.2.2" || host == "127.0.0.1") return true
            val parts = host.split(".").mapNotNull { it.toIntOrNull() }
            if (parts.size != 4 || host.split(".").size != 4 || parts.any { it !in 0..255 }) return false
            return parts[0] == 10 ||
                (parts[0] == 192 && parts[1] == 168) ||
                (parts[0] == 172 && parts[1] in 16..31)
        }
    }
}
