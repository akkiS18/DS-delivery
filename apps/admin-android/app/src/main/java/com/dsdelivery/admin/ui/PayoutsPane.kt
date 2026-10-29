package com.dsdelivery.admin.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.InProgressDto
import com.dsdelivery.admin.data.PayoutDayDto
import com.dsdelivery.admin.data.PayoutDetailDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SECTIONS = listOf("Tekshiruv", "To‘lov hisoboti")

/** "Pul": mismatched money to check (the bot's /money) and the daily payout report. */
@Composable
fun MoneyHome(onMessage: (String) -> Unit) {
    var section by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = section, containerColor = MaterialTheme.colorScheme.surface) {
            SECTIONS.forEachIndexed { i, label ->
                Tab(selected = section == i, onClick = { section = i }, text = { Text(label) })
            }
        }
        if (section == 0) MoneyTab(onMessage) else PayoutsPane(onMessage)
    }
}

/**
 * The daily payout report for restaurants whose customers pay onto the platform's cards. It only SHOWS what to transfer to each restaurant:
 * collected - commission - refunds the restaurant sent. DS never moves money; the administrator transfers it in the bank by hand.
 */
@Composable
fun PayoutsPane(onMessage: (String) -> Unit) {
    var openDate by rememberSaveable { mutableStateOf<String?>(null) }
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var openName by rememberSaveable { mutableStateOf("") }
    val date = openDate
    val id = openId
    BackHandler(enabled = date != null) { openDate = null; openId = null }
    if (date == null || id == null) PayoutsHome(onOpen = { d, r, n -> openDate = d; openId = r; openName = n }, onMessage = onMessage)
    else PayoutDayScreen(date = date, restaurantId = id, name = openName, onBack = { openDate = null; openId = null }, onMessage = onMessage)
}

@Composable
private fun PayoutsHome(onOpen: (String, String, String) -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var days by remember { mutableStateOf<List<PayoutDayDto>?>(null) }
    var inProgress by remember { mutableStateOf<List<InProgressDto>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.payouts(7)) {
            is ApiResult.Ok -> { days = r.data.days; inProgress = r.data.inProgress; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(Unit) {
        while (true) {
            load()
            delay(30_000)
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (offline) item { Banner("Ulanish yo‘q — ma’lumot eskirgan bo‘lishi mumkin", UrgentColor) }
            item {
                Text(
                    "Faqat platforma kartasiga tushgan, yetkazilgan buyurtmalar. Beriladi = yig‘ilgan − komissiya − restoran yuborgan qaytarishlar. Taksi haqi kirmaydi. DS pul o‘tkazmaydi: summani bankda o‘zingiz o‘tkazasiz.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val list = days
            if (list == null) item { Text(if (offline) "Yuklab bo‘lmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else {
                if (inProgress.isNotEmpty()) item {
                    Card {
                        Text("⏳ Yo‘lda (hali yetkazilmagan — hozir berilmaydi)", style = MaterialTheme.typography.titleMedium)
                        inProgress.forEach { Text("${it.name}: ${it.orders} ta, ${somText(it.amountSom)}", style = MaterialTheme.typography.bodyMedium) }
                    }
                }
                if (list.all { it.restaurants.isEmpty() }) item { Text("Oxirgi 7 kunda to‘lanadigan buyurtma yo‘q.", style = MaterialTheme.typography.bodyLarge) }
                list.filter { it.restaurants.isNotEmpty() }.forEach { day ->
                    item {
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("${dayLabel(day.date)} (${day.date})", style = MaterialTheme.typography.titleMedium)
                            Text("Jami: ${somText(day.totalPayableSom)}", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    items(day.restaurants.size) { i ->
                        val r = day.restaurants[i]
                        Card(Modifier.clickable { onOpen(day.date, r.restaurantId, r.name) }) {
                            Text(r.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                "Beriladi: ${somText(r.payableSom)}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                                color = if (r.payableSom < 0) UrgentColor else OkColor,
                            )
                            Text(
                                "${r.orders} ta buyurtma • yig‘ilgan ${somText(r.collectedSom)} − komissiya ${somText(r.commissionSom)}" +
                                    (if (r.refundsSom > 0) " − qaytarish ${somText(r.refundsSom)}" else ""),
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            if (r.withOpenTicket > 0) Text("⚠️ ${r.withOpenTicket} ta buyurtmada ochiq murojaat bor — to‘lashdan oldin tekshiring", style = MaterialTheme.typography.bodyMedium, color = WarnColor)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PayoutDayScreen(date: String, restaurantId: String, name: String, onBack: () -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    var detail by remember { mutableStateOf<PayoutDetailDto?>(null) }
    var offline by remember { mutableStateOf(false) }
    var empty by remember { mutableStateOf(false) }

    LaunchedEffect(date, restaurantId) {
        while (true) {
            when (val r = app.repository.payoutDay(date, restaurantId)) {
                is ApiResult.Ok -> { detail = r.data; offline = false; empty = false }
                is ApiResult.Unauthorized -> app.watcher.signOutLocally()
                is ApiResult.Failed -> if (r.code == 404) { detail = null; empty = true; offline = false } else offline = true
                else -> offline = true
            }
            delay(30_000)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Orqaga") }
        }
        if (offline) Banner("Ulanish yo‘q — ma’lumot eskirgan bo‘lishi mumkin", UrgentColor)
        val d = detail
        when {
            d != null -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Text("${d.name} • ${dayLabel(d.date)} (${d.date})", style = MaterialTheme.typography.titleMedium) }
                item { Text("Yetkazilgan buyurtmalar", style = MaterialTheme.typography.titleMedium) }
                if (d.orders.isEmpty()) item { Text("Bu kuni yetkazilgan buyurtma yo‘q.", style = MaterialTheme.typography.bodyMedium) }
                items(d.orders.size) { i ->
                    val o = d.orders[i]
                    Card {
                        Text("#${o.code} • ${stampOf(o.at)}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                        Text("Yig‘ilgan ${somText(o.collectedSom)} − komissiya ${somText(o.commissionSom)} = ${somText(o.collectedSom - o.commissionSom)}", style = MaterialTheme.typography.bodyMedium)
                        if (o.openTicket) Text("⚠️ ochiq murojaat bor", style = MaterialTheme.typography.bodyMedium, color = WarnColor)
                    }
                }
                if (d.refunds.isNotEmpty()) item { Text("Restoran yuborgan qaytarishlar", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
                items(d.refunds.size) { i ->
                    val f = d.refunds[i]
                    Card {
                        Text("Qaytarish #${f.number} • buyurtma #${f.orderCode} • ${stampOf(f.at)}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                        Text("− ${somText(f.amountSom)}", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            empty -> Text("Bu kun uchun yozuv yo‘q.", modifier = Modifier.padding(16.dp))
            else -> Text(if (offline) "Yuklab bo‘lmadi." else "Yuklanmoqda…", modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
