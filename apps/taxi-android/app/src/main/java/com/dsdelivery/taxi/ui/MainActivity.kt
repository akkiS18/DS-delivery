package com.dsdelivery.taxi.ui

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.dsdelivery.taxi.TaxiApp
import com.dsdelivery.taxi.service.DispatchService

class MainActivity : ComponentActivity() {

    private var readiness by mutableStateOf<Readiness?>(null)

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshReadiness() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as TaxiApp
        setContent {
            DSTaxiTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val account by app.session.account.collectAsState()
                    if (account == null) {
                        LoginScreen(onSignedIn = { onSignedIn() })
                    } else {
                        MainScreen(
                            readiness = readiness ?: Readiness.read(this),
                            onReadinessChanged = { refreshReadiness() },
                            onSignedOut = { refreshReadiness() },
                        )
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val app = application as TaxiApp
        // Whenever the screen is visible the list is live; on duty, the foreground service also keeps it alive when the screen is off.
        app.dispatcher.start()
        DispatchService.start(this)
        app.dispatcher.refreshNow()
    }

    override fun onResume() {
        super.onResume()
        refreshReadiness()
    }

    override fun onStop() {
        val app = application as TaxiApp
        if (!app.session.duty.value) app.dispatcher.stop() // off duty: nothing listens in the background
        super.onStop()
    }

    private fun onSignedIn() {
        val app = application as TaxiApp
        app.session.setDuty(true)
        if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        app.dispatcher.start()
        DispatchService.start(this)
        refreshReadiness()
    }

    private fun refreshReadiness() {
        readiness = Readiness.read(this)
    }
}
