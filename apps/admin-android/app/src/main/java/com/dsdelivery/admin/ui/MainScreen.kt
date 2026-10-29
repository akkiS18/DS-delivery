package com.dsdelivery.admin.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.core.WatchState
import com.dsdelivery.admin.data.AttentionItem
import kotlinx.coroutines.launch

/** What must be true for the phone to ring reliably. Checked every time the app comes back to the screen. */
data class Readiness(val notifications: Boolean, val battery: Boolean, val volume: Boolean, val fullScreen: Boolean) {
    val allGood: Boolean get() = notifications && battery && volume && fullScreen

    companion object {
        fun read(context: Context): Readiness {
            val app = AdminApp.instance
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

/** SETTINGS is not in the bottom bar (the gear icon in the top bar opens it): five tabs is the most a bottom bar should hold. */
private enum class Tab(val label: String) { ATTENTION("Diqqat"), MONEY("Pul"), CARDS("Kartalar"), MANAGE("Boshqaruv"), HELP("Yordam"), SETTINGS("Sozlamalar") }

/** Which tab deals with an attention item (null = the card itself is all there is to it). */
private fun tabFor(kind: String): Tab? = when (kind) {
    "MONEY_REVIEW", "PAYMENT_UNVERIFIED" -> Tab.MONEY
    "CARD_PENDING", "CARD_TURN_MID", "CARD_TURN_HIGH" -> Tab.CARDS
    "SUPPORT_TICKET", "TAXI_NEEDS_HELP", "READY_NO_TAXI" -> Tab.HELP
    else -> null
}

/** Which part of the Yordam tab an attention item belongs to: 0 = murojaatlar, 1 = taksi. */
private fun helpSectionFor(kind: String): Int = if (kind == "TAXI_NEEDS_HELP" || kind == "READY_NO_TAXI") 1 else 0

/** Open (not yet acknowledged) attention items that belong to a tab: the number on its icon. */
private fun badgeFor(tab: Tab, items: List<AttentionItem>): Int = when (tab) {
    Tab.ATTENTION -> items.count { !it.acked }
    Tab.MONEY, Tab.CARDS, Tab.HELP -> items.count { !it.acked && tabFor(it.kind) == tab }
    Tab.MANAGE, Tab.SETTINGS -> 0
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(readiness: Readiness, onReadinessChanged: () -> Unit) {
    val app = AdminApp.instance
    val context = androidx.compose.ui.platform.LocalContext.current
    val state by app.watcher.state.collectAsState()
    val duty by app.session.duty.collectAsState()
    var tab by remember { mutableStateOf(Tab.ATTENTION) }
    var helpSection by remember { mutableStateOf(0) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var busyKey by remember { mutableStateOf<String?>(null) }

    fun say(message: String) { scope.launch { snack.showSnackbar(message) } }

    fun ack(key: String, minutes: Int) {
        if (busyKey != null) return
        busyKey = key
        scope.launch {
            app.watcher.ack(key, minutes)?.let { snack.showSnackbar(it) }
            busyKey = null
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text(if (tab == Tab.SETTINGS) "Sozlamalar" else "DS Admin", maxLines = 1) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = AdminBlue, titleContentColor = Color.White, actionIconContentColor = Color.White),
                actions = {
                    IconButton(onClick = { tab = if (tab == Tab.SETTINGS) Tab.ATTENTION else Tab.SETTINGS }) {
                        Icon(Icons.Filled.Settings, contentDescription = "Sozlamalar")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                Tab.values().filter { it != Tab.SETTINGS }.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t, onClick = { tab = t },
                        icon = {
                            val icon = when (t) { Tab.ATTENTION -> Icons.Filled.Notifications; Tab.MONEY -> Icons.Filled.AttachMoney; Tab.CARDS -> Icons.Filled.CreditCard; Tab.MANAGE -> Icons.Filled.Tune; Tab.HELP -> Icons.Filled.SupportAgent; Tab.SETTINGS -> Icons.Filled.Settings }
                            val count = badgeFor(t, state.items)
                            if (count > 0) BadgedBox(badge = { Badge { Text(count.toString()) } }) { Icon(icon, null) } else Icon(icon, null)
                        },
                        label = { Text(t.label) },
                        colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.primaryContainer),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.ATTENTION -> AttentionTab(
                    state = state, duty = duty, readiness = readiness, busyKey = busyKey,
                    onFix = { tab = Tab.SETTINGS },
                    onRefresh = { app.watcher.refreshNow() },
                    onSilence = { app.watcher.silence() },
                    onCall = { key, phone ->
                        runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialable(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        ack(key, 15) // calling the restaurant counts as "I am on it"
                    },
                    onAck = { key, minutes -> ack(key, minutes) },
                    onOpen = { t, section -> if (t == Tab.HELP) helpSection = section; tab = t },
                )
                Tab.MONEY -> MoneyTab(onMessage = { say(it) })
                Tab.CARDS -> CardsTab(onMessage = { say(it) })
                Tab.MANAGE -> ManageTab(onMessage = { say(it) })
                Tab.HELP -> HelpTab(section = helpSection, onSection = { helpSection = it }, onMessage = { say(it) })
                Tab.SETTINGS -> SettingsTab(readiness, duty, onReadinessChanged, onMessage = { say(it) })
            }
        }
    }
}

@Composable
private fun AttentionTab(
    state: WatchState,
    duty: Boolean,
    readiness: Readiness,
    busyKey: String?,
    onFix: () -> Unit,
    onRefresh: () -> Unit,
    onSilence: () -> Unit,
    onCall: (key: String, phone: String) -> Unit,
    onAck: (key: String, minutes: Int) -> Unit,
    onOpen: (Tab, helpSection: Int) -> Unit,
) {
    PullRefresh(onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { StatusStrip(state, duty) }
            if (!readiness.allGood) item { ReadinessBanner(readiness, onFix) }
            if (state.items.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        if (!state.loaded) Text("Yuklanmoqda…", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else {
                            Text("Hammasi joyida", style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.size(6.dp))
                            Text(
                                if (duty) "Biror narsa osilib qolsa, telefon signal beradi." else "Navbatchilik o‘chirilgan: ilova yopiq bo‘lsa signal chalinmaydi.",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            items(state.items, key = { it.key }) { item ->
                AttentionCard(
                    item = item, fetchedAtMs = state.fetchedAtMs,
                    ringing = state.ringing && item.key in state.waiting,
                    busy = busyKey == item.key,
                    onCall = { onCall(item.key, it) },
                    onAck = { onAck(item.key, it) },
                    onSilence = onSilence,
                    openLabel = tabFor(item.kind)?.let { "${it.label}ni ochish" },
                    onOpen = { tabFor(item.kind)?.let { onOpen(it, helpSectionFor(item.kind)) } },
                )
            }
        }
    }
}

@Composable
private fun StatusStrip(state: WatchState, duty: Boolean) {
    val (text, color) = when {
        state.offline -> "Ulanish yo‘q — yangi holatlar kelmayapti" to UrgentColor
        !duty -> "Navbatchilik o‘chirilgan" to NeutralColor
        state.quietActive -> "Jim soat: faqat shoshilinch holatlar signal beradi" to NeutralColor
        else -> "Ulangan • navbatchilik yoqilgan" to OkColor
    }
    Row(
        Modifier.fillMaxWidth().background(color.copy(alpha = 0.12f), RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).background(color, RoundedCornerShape(50)))
        Spacer(Modifier.size(10.dp))
        Text(text, color = color, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
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
        Text("Signal ishonchli ishlamasligi mumkin", color = WarnColor, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge)
        Text(problems.joinToString(", ").replaceFirstChar { it.uppercase() } + ".", style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onFix, colors = ButtonDefaults.buttonColors(containerColor = WarnColor)) { Text("Tuzatish") }
    }
}
