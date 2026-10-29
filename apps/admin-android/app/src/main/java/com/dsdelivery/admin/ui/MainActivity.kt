package com.dsdelivery.admin.ui

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.core.PinLock
import com.dsdelivery.admin.service.WatchService

class MainActivity : ComponentActivity() {

    private var readiness by mutableStateOf<Readiness?>(null)
    private var unlocked by mutableStateOf(false)
    /** elapsedRealtime when the screen last went away; null = the app was just started. */
    private var leftAt: Long? = null

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshReadiness() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // No screenshots and no preview in the recent-apps list: the screen shows restaurant phones and order details.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        val app = application as AdminApp
        setContent {
            DSAdminTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val account by app.session.account.collectAsState()
                    // Re-read when the account changes: a fresh sign-in has no PIN yet.
                    var pinSet by remember(account) { mutableStateOf(app.session.hasPin) }
                    when {
                        account == null -> LoginScreen(onSignedIn = { onSignedIn() })
                        !pinSet -> PinScreen(create = true, onDone = { pinSet = true; unlocked = true; startListening() })
                        !unlocked -> PinScreen(create = false, onDone = { unlocked = true })
                        else -> MainScreen(readiness = readiness ?: Readiness.read(this), onReadinessChanged = { refreshReadiness() })
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (PinLock.needsUnlock(leftAt, SystemClock.elapsedRealtime())) unlocked = false
        startListening()
    }

    override fun onResume() {
        super.onResume()
        refreshReadiness()
    }

    override fun onStop() {
        val app = application as AdminApp
        leftAt = SystemClock.elapsedRealtime()
        if (!app.session.duty.value) app.watcher.stop() // off duty: nothing listens in the background
        super.onStop()
    }

    /** Whenever the screen is visible the list is live; on duty, the foreground service also keeps it alive with the screen off. */
    private fun startListening() {
        val app = application as AdminApp
        if (!app.session.isLoggedIn) return
        app.watcher.start()
        WatchService.start(this)
        app.watcher.refreshNow()
    }

    private fun onSignedIn() {
        val app = application as AdminApp
        app.session.setDuty(true)
        if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        refreshReadiness()
        // The listening starts once the PIN is set (see PinScreen(create = true)).
    }

    private fun refreshReadiness() {
        readiness = Readiness.read(this)
    }
}
