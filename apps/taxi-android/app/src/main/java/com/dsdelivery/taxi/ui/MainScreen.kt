package com.dsdelivery.taxi.ui

import android.content.Context
import android.os.PowerManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LocalTaxi
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.dsdelivery.taxi.TaxiApp
import kotlinx.coroutines.launch

/** What must be true for the phone to ring reliably. Checked every time the app comes back to the screen. */
data class Readiness(val notifications: Boolean, val battery: Boolean, val volume: Boolean, val fullScreen: Boolean) {
    val allGood: Boolean get() = notifications && battery && volume && fullScreen

    companion object {
        fun read(context: Context): Readiness {
            val app = TaxiApp.instance
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            return Readiness(
                notifications = app.notifier.canPost(),
                battery = pm.isIgnoringBatteryOptimizations(context.packageName),
                volume = app.alarm.volumeFraction() >= 0.5f,
                fullScreen = app.notifier.canFullScreen(),
            )
        }
    }
}

private enum class Tab(val label: String) { REQUESTS("So‘rovlar"), HISTORY("Tarix"), SETTINGS("Sozlamalar") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(readiness: Readiness, onReadinessChanged: () -> Unit, onSignedOut: () -> Unit) {
    val app = TaxiApp.instance
    val state by app.dispatcher.state.collectAsState()
    val account by app.session.account.collectAsState()
    val duty by app.session.duty.collectAsState()
    var tab by remember { mutableStateOf(Tab.REQUESTS) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var busyId by remember { mutableStateOf<String?>(null) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text(account?.companyName ?: "DS Taxi", maxLines = 1) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = TaxiYellow, titleContentColor = Color(0xFF1B1B1F)),
            )
        },
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                Tab.values().forEach { t ->
                    NavigationBarItem(
                        selected = tab == t, onClick = { tab = t },
                        icon = {
                            Icon(
                                when (t) { Tab.REQUESTS -> Icons.Filled.LocalTaxi; Tab.HISTORY -> Icons.Filled.History; Tab.SETTINGS -> Icons.Filled.Settings }, null,
                            )
                        },
                        label = { Text(t.label) },
                        colors = NavigationBarItemDefaults.colors(indicatorColor = TaxiYellow),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.REQUESTS -> RequestsTab(
                    state = state, duty = duty, readiness = readiness, busyId = busyId,
                    onFix = { tab = Tab.SETTINGS },
                    onRefresh = { app.dispatcher.refreshNow() },
                    onSilence = { app.dispatcher.silence() },
                    onAction = { id, action ->
                        if (busyId == null) {
                            busyId = id
                            scope.launch {
                                val problem = app.dispatcher.act(id, action)
                                busyId = null
                                if (problem != null) snack.showSnackbar(problem)
                            }
                        }
                    },
                )
                Tab.HISTORY -> HistoryTab(state.history, state.clockOffsetMs, onRefresh = { app.dispatcher.refreshNow() })
                Tab.SETTINGS -> SettingsTab(readiness, duty, onReadinessChanged, onSignedOut)
            }
        }
    }
}

@Composable
private fun RequestsTab(
    state: com.dsdelivery.taxi.core.DispatchState,
    duty: Boolean,
    readiness: Readiness,
    busyId: String?,
    onFix: () -> Unit,
    onRefresh: () -> Unit,
    onSilence: () -> Unit,
    onAction: (String, String) -> Unit,
) {
    PullRefresh(onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { StatusStrip(state.offline, duty) }
            if (!readiness.allGood) item { ReadinessBanner(readiness, onFix) }
            if (state.active.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        if (!state.loaded) Text("Yuklanmoqda…", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else {
                            Text("Hozir so‘rov yo‘q", style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.size(6.dp))
                            Text(
                                if (duty) "Yangi so‘rov kelsa, telefon gudok chaladi." else "Navbatchilik o‘chirilgan: ilova yopiq bo‘lsa so‘rov kelmaydi.",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            items(state.active, key = { it.id }) { r ->
                RequestCard(
                    r = r, clockOffsetMs = state.clockOffsetMs,
                    ringing = state.ringing && "${r.id}:${r.status}" in state.waiting,
                    busy = busyId == r.id,
                    onAction = { onAction(r.id, it) },
                    onSilence = onSilence,
                )
            }
        }
    }
}

@Composable
private fun StatusStrip(offline: Boolean, duty: Boolean) {
    val (text, color) = when {
        offline -> "Ulanish yo‘q — yangi so‘rovlar kelmayapti" to UrgentColor
        !duty -> "Navbatchilik o‘chirilgan" to NeutralColor
        else -> "Ulangan • navbatchilik yoqilgan" to OkColor
    }
    Row(
        Modifier.fillMaxWidth().background(color.copy(alpha = 0.12f), RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).background(color, RoundedCornerShape(50)))
        Spacer(Modifier.size(10.dp))
        Text(text, color = color, style = MaterialTheme.typography.bodyLarge, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
    }
}

@Composable
private fun ReadinessBanner(r: Readiness, onFix: () -> Unit) {
    val problems = listOfNotNull(
        if (!r.notifications) "bildirishnomalar o‘chirilgan" else null,
        if (!r.volume) "signal ovozi past" else null,
        if (!r.battery) "batareya tejash yoqilgan" else null,
        if (!r.fullScreen) "to‘liq ekran ruxsati yo‘q" else null,
    )
    Column(
        Modifier.fillMaxWidth().background(WarnColor.copy(alpha = 0.12f), RoundedCornerShape(12.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Signal ishonchli ishlamasligi mumkin", color = WarnColor, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, style = MaterialTheme.typography.bodyLarge)
        Text(problems.joinToString(", ").replaceFirstChar { it.uppercase() } + ".", style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onFix, colors = ButtonDefaults.buttonColors(containerColor = WarnColor)) { Text("Tuzatish") }
    }
}

@Composable
private fun HistoryTab(history: List<com.dsdelivery.taxi.data.RequestDto>, offsetMs: Long, onRefresh: () -> Unit) {
    PullRefresh(onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text("So‘nggi 24 soat", style = MaterialTheme.typography.titleMedium) }
            if (history.isEmpty()) item { Text("Hali hech narsa yo‘q.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(history, key = { it.id }) { r ->
                val look = statusLook(r.status)
                Column(
                    Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp)).padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Row {
                        Text("#${r.orderNumber}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Text(look.label, color = toneColor(look.tone), fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                    }
                    Text("${r.restaurant.name} → ${r.delivery.address}", style = MaterialTheme.typography.bodyMedium)
                    clockOf(r.deliveredAt ?: r.updatedAt)?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
    }
}
