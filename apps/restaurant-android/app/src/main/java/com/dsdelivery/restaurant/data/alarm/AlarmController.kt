package com.dsdelivery.restaurant.data.alarm

import android.content.Context
import android.content.SharedPreferences
import com.dsdelivery.restaurant.data.auth.SessionState
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** The one switch for the kitchen bell (default ON), remembered on the phone. */
class AlarmSettings(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("alarm_settings", Context.MODE_PRIVATE)
    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY_ENABLED, true))
    val enabled: StateFlow<Boolean> = _enabled

    fun setEnabled(on: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, on).apply()
        _enabled.value = on
    }

    private companion object { const val KEY_ENABLED = "enabled" }
}

/**
 * Keeps the bell running exactly while a restaurant is signed in and the bell is switched on: it starts the [OrderWatcher] and the foreground
 * service that keeps the process alive, and stops both on logout (including a 401 that cleared the session) or when the switch is turned off.
 */
class AlarmController(
    private val context: Context,
    repository: RestaurantRepository,
    val settings: AlarmSettings
) {
    val watcher = OrderWatcher(context, repository)
    private val sessionState = repository.sessionState
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun init() {
        scope.launch {
            var wasLoggedOut = false
            sessionState.collect { state ->
                // A fresh sign-in on this phone puts it on duty (like the taxi app); an app start with a saved session keeps the choice made earlier.
                if (state is SessionState.LoggedIn && wasLoggedOut) settings.setEnabled(true)
                wasLoggedOut = state is SessionState.LoggedOut
                refresh()
            }
        }
        scope.launch { settings.enabled.collect { refresh() } }
    }

    /** Idempotent: brings the watcher and the service in line with "signed in AND switched on". */
    fun refresh() {
        if (sessionState.value is SessionState.LoggedIn && settings.enabled.value) {
            watcher.start()
            WatchService.start(context)
        } else {
            watcher.stop()
            WatchService.stop(context)
        }
    }
}
