package com.dsdelivery.admin.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.LocalTaxi
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.R
import com.dsdelivery.admin.core.WatchState
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.data.TodayDto
import com.dsdelivery.admin.ui.kit.EmptyState
import com.dsdelivery.admin.ui.kit.ListRow
import com.dsdelivery.admin.ui.kit.LoadingSkeleton
import com.dsdelivery.admin.ui.kit.MetricTile
import com.dsdelivery.admin.ui.kit.Notice
import com.dsdelivery.admin.ui.kit.SectionHeader
import com.dsdelivery.admin.ui.kit.SecondaryButton
import com.dsdelivery.admin.ui.kit.StatusChip
import kotlinx.coroutines.delay
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

/** The four bottom tabs (docs/ADMIN_UI_PLAN.md): everything else is reached from "Yana" or from a card on "Diqqat". */
private enum class Tab(val label: String, val title: String) {
    ATTENTION("Diqqat", "DS Admin"), MONEY("Pul", "Pul"), SUPPORT("Murojaat", "Murojaatlar"), MORE("Yana", "Yana")
}

/** The parts of the "Pul" tab, as a row of chips. */
private enum class MoneySection(val label: String) {
    CHECK("Tekşiruv"), REPORT("Hisobot"), REFUNDS("Qaytariş"), COMMISSION("Komissiya"), CARDS("Kartalar")
}

/** The screens listed under "Yana". SETTINGS is last on purpose. */
private enum class MoreItem(val label: String, val hint: String) {
    RESTAURANTS("Restoranlar", "Restoranlar röyxati va sozlamalari"),
    TAXI("Taksi", "Taksi kompaniyalari va sörovlar"),
    CUSTOMERS("Mijozlar", "Ogohlantirişlar va bloklar"),
    PROMO("Aksiya", "Bannerlar va aksiyalar"),
    LANDMARKS("Joylar", "Xaritadagi nomli joylar"),
    PLATFORM("Platforma", "Tölov, naqd, narx va reyting sozlamalari"),
    SETTINGS("Sozlamalar", "Signal, ovoz va navbatçilik"),
}

private fun MoreItem.icon() = when (this) {
    MoreItem.RESTAURANTS -> Icons.Filled.Restaurant
    MoreItem.TAXI -> Icons.Filled.LocalTaxi
    MoreItem.CUSTOMERS -> Icons.Filled.People
    MoreItem.PROMO -> Icons.Filled.LocalOffer
    MoreItem.LANDMARKS -> Icons.Filled.Place
    MoreItem.PLATFORM -> Icons.Filled.Tune
    MoreItem.SETTINGS -> Icons.Filled.Settings
}

/** Where an attention item is dealt with: a tab, and inside it a chip (money) or a list entry (more). */
private data class Dest(val tab: Tab, val money: MoneySection? = null, val more: MoreItem? = null) {
    val label: String get() = money?.label ?: more?.label ?: tab.label
}

/** null = the card itself is all there is to it (call the restaurant, or wait). */
private fun destFor(kind: String): Dest? = when (kind) {
    "MONEY_REVIEW", "PAYMENT_UNVERIFIED" -> Dest(Tab.MONEY, money = MoneySection.CHECK)
    "CARD_PENDING", "CARD_TURN_MID", "CARD_TURN_HIGH" -> Dest(Tab.MONEY, money = MoneySection.CARDS)
    "REFUND_DISPUTED", "REFUND_POOL_DUE" -> Dest(Tab.MONEY, money = MoneySection.REFUNDS)
    "SUPPORT_TICKET" -> Dest(Tab.SUPPORT)
    "TAXI_NEEDS_HELP", "READY_NO_TAXI" -> Dest(Tab.MORE, more = MoreItem.TAXI)
    else -> null
}

/** Open (not yet acknowledged) attention items that belong to a tab: the number on its icon. */
private fun badgeFor(tab: Tab, items: List<AttentionItem>): Int =
    if (tab == Tab.ATTENTION) items.count { !it.acked } else items.count { !it.acked && destFor(it.kind)?.tab == tab }

private fun Tab.icon() = when (this) {
    Tab.ATTENTION -> Icons.Filled.Notifications
    Tab.MONEY -> Icons.Filled.AttachMoney
    Tab.SUPPORT -> Icons.Filled.SupportAgent
    Tab.MORE -> Icons.Filled.MoreHoriz
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(readiness: Readiness, onReadinessChanged: () -> Unit) {
    val app = AdminApp.instance
    val context = androidx.compose.ui.platform.LocalContext.current
    val state by app.watcher.state.collectAsState()
    val duty by app.session.duty.collectAsState()
    var tab by rememberSaveable { mutableStateOf(Tab.ATTENTION) }
    var moneySection by rememberSaveable { mutableStateOf(MoneySection.CHECK) }
    var more by rememberSaveable { mutableStateOf<MoreItem?>(null) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var busyKey by remember { mutableStateOf<String?>(null) }

    fun say(message: String) { scope.launch { snack.showSnackbar(message) } }

    fun go(dest: Dest) {
        tab = dest.tab
        dest.money?.let { moneySection = it }
        more = dest.more
    }

    fun ack(key: String, minutes: Int) {
        if (busyKey != null) return
        busyKey = key
        scope.launch {
            app.watcher.ack(key, minutes)?.let { snack.showSnackbar(it) }
            busyKey = null
        }
    }

    // Back: close an opened "Yana" screen first, then return to the home tab; only from there does back leave the app.
    BackHandler(enabled = tab == Tab.MORE && more != null) { more = null }
    BackHandler(enabled = tab != Tab.ATTENTION && !(tab == Tab.MORE && more != null)) { tab = Tab.ATTENTION }

    val openedMore = if (tab == Tab.MORE) more else null

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    if (tab == Tab.ATTENTION) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Image(painterResource(R.drawable.ic_logo_ds), contentDescription = null, modifier = Modifier.size(28.dp))
                            Text(Tab.ATTENTION.title, maxLines = 1)
                        }
                    } else Text(openedMore?.label ?: tab.title, maxLines = 1)
                },
                navigationIcon = {
                    if (openedMore != null) IconButton(onClick = { more = null }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Orqaga") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface, titleContentColor = MaterialTheme.colorScheme.onSurface, navigationIconContentColor = MaterialTheme.colorScheme.onSurface),
            )
        },
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                Tab.values().forEach { t ->
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = { if (t == Tab.MORE && tab == Tab.MORE) more = null; tab = t },
                        icon = {
                            val count = badgeFor(t, state.items)
                            if (count > 0) BadgedBox(badge = { Badge { Text(count.toString()) } }) { Icon(t.icon(), null) } else Icon(t.icon(), null)
                        },
                        label = { Text(t.label, style = MaterialTheme.typography.labelMedium) },
                        colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.primaryContainer),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.ATTENTION -> AttentionHome(
                    state = state, duty = duty, readiness = readiness, busyKey = busyKey,
                    onFix = { go(Dest(Tab.MORE, more = MoreItem.SETTINGS)) },
                    onRefresh = { app.watcher.refreshNow() },
                    onSilence = { app.watcher.silence() },
                    onCall = { key, phone ->
                        runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialable(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        ack(key, 15) // calling the restaurant counts as "I am on it"
                    },
                    onAck = { key, minutes -> ack(key, minutes) },
                    onGo = { go(it) },
                )
                Tab.MONEY -> MoneyTabs(moneySection, onSection = { moneySection = it }, onMessage = { say(it) })
                Tab.SUPPORT -> SupportPane(onMessage = { say(it) })
                Tab.MORE -> when (more) {
                    null -> MoreList(readiness, state.items, onOpen = { more = it })
                    MoreItem.RESTAURANTS -> RestaurantsPane(onMessage = { say(it) })
                    MoreItem.TAXI -> TaxiPane(onMessage = { say(it) })
                    MoreItem.CUSTOMERS -> CustomersPane(onMessage = { say(it) })
                    MoreItem.PROMO -> PromoPane(onMessage = { say(it) })
                    MoreItem.LANDMARKS -> LandmarksPane(onMessage = { say(it) })
                    MoreItem.PLATFORM -> PlatformPane(onMessage = { say(it) })
                    MoreItem.SETTINGS -> SettingsTab(readiness, duty, onReadinessChanged, onMessage = { say(it) })
                }
            }
        }
    }
}

// ---- Pul -------------------------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MoneyTabs(selected: MoneySection, onSection: (MoneySection) -> Unit, onMessage: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MoneySection.values().forEach { s ->
                FilterChip(selected = selected == s, onClick = { onSection(s) }, label = { Text(s.label, style = MaterialTheme.typography.labelLarge) })
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (selected) {
                MoneySection.CHECK -> MoneyTab(onMessage)
                MoneySection.REPORT -> PayoutsPane(onMessage)
                MoneySection.REFUNDS -> RefundsPane(onMessage)
                MoneySection.COMMISSION -> CommissionPane(onMessage)
                MoneySection.CARDS -> CardsTab(onMessage)
            }
        }
    }
}

// ---- Yana ------------------------------------------------------------------------------------------------------------------------------

@Composable
private fun MoreList(readiness: Readiness, items: List<AttentionItem>, onOpen: (MoreItem) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
            Column {
                MoreItem.values().forEachIndexed { i, m ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    val waiting = items.count { !it.acked && destFor(it.kind)?.more == m }
                    ListRow(
                        title = m.label, subtitle = m.hint, leading = m.icon(), onClick = { onOpen(m) },
                        trailing = when {
                            waiting > 0 -> ({ StatusChip("$waiting ta kutyapti", Tone.URGENT) })
                            m == MoreItem.SETTINGS && !readiness.allGood -> ({ StatusChip("Tuzatiş kerak", Tone.WARN) })
                            else -> null
                        },
                    )
                }
            }
        }
    }
}

// ---- Diqqat (home) ---------------------------------------------------------------------------------------------------------------------

@Composable
private fun AttentionHome(
    state: WatchState,
    duty: Boolean,
    readiness: Readiness,
    busyKey: String?,
    onFix: () -> Unit,
    onRefresh: () -> Unit,
    onSilence: () -> Unit,
    onCall: (key: String, phone: String) -> Unit,
    onAck: (key: String, minutes: Int) -> Unit,
    onGo: (Dest) -> Unit,
) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var today by remember { mutableStateOf<TodayDto?>(null) }
    var todayFailed by remember { mutableStateOf(false) }

    suspend fun loadToday() {
        when (val r = app.repository.today()) {
            is ApiResult.Ok -> { today = r.data; todayFailed = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> todayFailed = true
        }
    }

    // Today's numbers change slowly: a refresh every 30 seconds while this screen is open, and on pull-down.
    LaunchedEffect(Unit) {
        while (true) {
            loadToday()
            delay(30_000)
        }
    }

    PullRefresh(onRefresh = { onRefresh(); scope.launch { loadToday() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { StatusStrip(state, duty) }
            if (!readiness.allGood) item { ReadinessNotice(readiness, onFix) }

            item { SectionHeader("Bugun") }
            item { TodayGrid(today, todayFailed, onGo) }

            item { SectionHeader("Şoşilinç işlar") }
            if (state.items.isEmpty()) {
                item {
                    if (!state.loaded) LoadingSkeleton(cards = 2)
                    else EmptyState(
                        title = "Hammasi joyida",
                        hint = if (duty) "Biror narsa osilib qolsa, telefon signal beradi." else "Navbatçilik öçirilgan: ilova yopiq bölsa signal çalinmaydi.",
                    )
                }
            }
            items(state.items, key = { it.key }) { item ->
                val dest = destFor(item.kind)
                AttentionCard(
                    item = item, fetchedAtMs = state.fetchedAtMs,
                    ringing = state.ringing && item.key in state.waiting,
                    busy = busyKey == item.key,
                    onCall = { onCall(item.key, it) },
                    onAck = { onAck(item.key, it) },
                    onSilence = onSilence,
                    openLabel = dest?.let { "${it.label}ni oçiş" },
                    onOpen = { dest?.let(onGo) },
                )
            }
        }
    }
}

@Composable
private fun TodayGrid(today: TodayDto?, failed: Boolean, onGo: (Dest) -> Unit) {
    if (today == null) {
        if (failed) Notice("Bugungi raqamlarni yuklab bölmadi. Ulanişni tekşiring.", Tone.WARN) else LoadingSkeleton(cards = 1)
        return
    }
    val o = today.orders
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (failed) Notice("Raqamlar eskirgan bölişi mumkin: ulaniş yöq.", Tone.WARN)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricTile(
                "Buyurtmalar", o.total.toString(), Modifier.weight(1f),
                hint = "yetkazildi ${o.delivered} · yölda ${o.inProgress} · bekor ${o.cancelled}",
            )
            MetricTile(
                "Tuşum", somText(today.revenueSom), Modifier.weight(1f),
                hint = if (today.cashSom > 0) "şundan naqd: ${somText(today.cashSom)}" else "tölangan buyurtmalar",
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val due = today.commissionDue
            MetricTile(
                "Komissiya qarzi", somText(due.amountSom), Modifier.weight(1f),
                tone = if (due.amountSom > 0) Tone.WARN else Tone.NEUTRAL,
                hint = if (due.restaurants > 0) "${due.restaurants} ta restoran" else "qarz yöq",
                onClick = { onGo(Dest(Tab.MONEY, money = MoneySection.COMMISSION)) },
            )
            MetricTile(
                "Oçiq murojaatlar", today.openTickets.toString(), Modifier.weight(1f),
                tone = if (today.openTickets > 0) Tone.INFO else Tone.NEUTRAL,
                hint = "pul tekşiruvi: ${today.moneyReviews} ta",
                onClick = { onGo(if (today.openTickets == 0 && today.moneyReviews > 0) Dest(Tab.MONEY, money = MoneySection.CHECK) else Dest(Tab.SUPPORT)) },
            )
        }
    }
}

@Composable
private fun StatusStrip(state: WatchState, duty: Boolean) {
    val (text, tone) = when {
        state.offline -> "Ulaniş yöq — yangi holatlar kelmayapti" to Tone.URGENT
        !duty -> "Navbatçilik öçirilgan" to Tone.NEUTRAL
        state.quietActive -> "Jim soat: faqat şoşilinç holatlar signal beradi" to Tone.NEUTRAL
        else -> "Ulangan • navbatçilik yoqilgan" to Tone.OK
    }
    Notice(text, tone)
}

@Composable
private fun ReadinessNotice(r: Readiness, onFix: () -> Unit) {
    val problems = listOfNotNull(
        if (!r.notifications) "bildirişnomalar öçirilgan" else null,
        if (!r.volume) "signal ovozi past" else null,
        if (!r.battery) "batareya tejaş yoqilgan" else null,
        if (!r.fullScreen) "töliq ekran ruxsati yöq" else null,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Notice("Signal işonçli işlamasligi mumkin: " + problems.joinToString(", ") + ".", Tone.WARN)
        SecondaryButton("Tuzatiş", onFix)
    }
}
