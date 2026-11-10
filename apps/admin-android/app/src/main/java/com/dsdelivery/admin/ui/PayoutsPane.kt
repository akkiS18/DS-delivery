package com.dsdelivery.admin.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import com.dsdelivery.admin.data.PaidDto
import com.dsdelivery.admin.data.PayoutDayDto
import com.dsdelivery.admin.data.PayoutDetailDto
import com.dsdelivery.admin.ui.kit.AdminCard
import com.dsdelivery.admin.ui.kit.DetailHeader
import com.dsdelivery.admin.ui.kit.EmptyState
import com.dsdelivery.admin.ui.kit.ListPlaceholder
import com.dsdelivery.admin.ui.kit.Notice
import com.dsdelivery.admin.ui.kit.SecondaryButton
import com.dsdelivery.admin.ui.kit.SectionHeader
import com.dsdelivery.admin.ui.kit.StatusChip
import com.dsdelivery.admin.ui.kit.PrimaryButton as KitPrimaryButton
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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
            if (offline) item { Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin") }
            item {
                Text(
                    "Faqat platforma kartasiga tuşgan, yetkazilgan buyurtmalar. Beriladi = yiğilgan − komissiya − restoran yuborgan qaytarişlar. Taksi haqi kirmaydi. DS pul ötkazmaydi: summani bankda özingiz ötkazasiz.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val list = days
            if (list == null) item { ListPlaceholder(offline) { scope.launch { load() } } }
            else {
                if (inProgress.isNotEmpty()) item {
                    AdminCard {
                        StatusChip("Yölda: hali yetkazilmagan, hozir berilmaydi", Tone.INFO)
                        inProgress.forEach { Text("${it.name}: ${it.orders} ta, ${somText(it.amountSom)}", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle)) }
                    }
                }
                if (list.all { it.restaurants.isEmpty() }) item { EmptyState(title = "Oxirgi 7 kunda tölanadigan buyurtma yöq", icon = Icons.Filled.CheckCircle) }
                list.filter { it.restaurants.isNotEmpty() }.forEach { day ->
                    item {
                        SectionHeader("${dayLabel(day.date)} (${day.date})", action = {
                            Text("Jami: ${somText(day.totalPayableSom)}", style = MaterialTheme.typography.titleSmall.merge(AmountStyle), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        })
                    }
                    items(day.restaurants.size) { i ->
                        val r = day.restaurants[i]
                        AdminCard(onClick = { onOpen(day.date, r.restaurantId, r.name) }) {
                            Text(r.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                "Beriladi: ${somText(r.payableSom)}", style = MaterialTheme.typography.titleLarge.merge(AmountStyle),
                                color = if (r.payableSom < 0) UrgentColor else OkColor,
                            )
                            Text(
                                "${r.orders} ta buyurtma • yiğilgan ${somText(r.collectedSom)} − komissiya ${somText(r.commissionSom)}" +
                                    (if (r.refundsSom > 0) " − qaytariş ${somText(r.refundsSom)}" else ""),
                                style = MaterialTheme.typography.bodyMedium.merge(AmountStyle), color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            PaidLine(r.paid, r.payableSom)
                            if (r.withOpenTicket > 0) StatusChip("${r.withOpenTicket} ta buyurtmada oçiq murojaat bor — tölaşdan oldin tekşiring", Tone.WARN)
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
    var busy by remember { mutableStateOf(false) }
    var marking by remember { mutableStateOf(false) }
    var unmarking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        when (val r = app.repository.payoutDay(date, restaurantId)) {
            is ApiResult.Ok -> { detail = r.data; offline = false; empty = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            is ApiResult.Failed -> if (r.code == 404) { detail = null; empty = true; offline = false } else offline = true
            else -> offline = true
        }
    }

    LaunchedEffect(date, restaurantId) {
        while (true) {
            load()
            delay(30_000)
        }
    }

    Column(Modifier.fillMaxSize()) {
        DetailHeader(name.ifBlank { "Tölov" } + " • " + dayLabel(date), onBack)
        if (offline) Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin")
        val d = detail
        when {
            d != null -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    AdminCard {
                        Text("Beriladi", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(somText(d.payableSom), style = MaterialTheme.typography.displaySmall.merge(AmountStyle), color = if (d.payableSom < 0) UrgentColor else OkColor)
                        Text(
                            "yiğilgan ${somText(d.collectedSom)} − komissiya ${somText(d.commissionSom)}" + (if (d.refundsSom > 0) " − qaytariş ${somText(d.refundsSom)}" else ""),
                            style = MaterialTheme.typography.bodyMedium.merge(AmountStyle), color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        PaidLine(d.paid, d.payableSom)
                        if (d.paid == null) {
                            if (d.payableSom > 0) KitPrimaryButton("Ötkazdim", { marking = true }, enabled = !busy)
                            else Text("Ötkaziladigan summa yöq.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            SecondaryButton("Belgini bekor qiliş", { unmarking = true }, enabled = !busy)
                        }
                    }
                }
                item { SectionHeader("Yetkazilgan buyurtmalar") }
                if (d.orders.isEmpty()) item { Text("Bu kuni yetkazilgan buyurtma yöq.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(d.orders.size) { i ->
                    val o = d.orders[i]
                    AdminCard {
                        Text("#${o.code} • ${stampOf(o.at)}", style = MaterialTheme.typography.titleSmall.merge(AmountStyle))
                        Text("Yiğilgan ${somText(o.collectedSom)} − komissiya ${somText(o.commissionSom)} = ${somText(o.collectedSom - o.commissionSom)}", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle))
                        if (o.openTicket) StatusChip("oçiq murojaat bor", Tone.WARN)
                    }
                }
                if (d.refunds.isNotEmpty()) item { SectionHeader("Restoran yuborgan qaytarişlar") }
                items(d.refunds.size) { i ->
                    val f = d.refunds[i]
                    AdminCard {
                        Text("Qaytariş #${f.number} • buyurtma #${f.orderCode} • ${stampOf(f.at)}", style = MaterialTheme.typography.titleSmall.merge(AmountStyle))
                        Text("− ${somText(f.amountSom)}", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle))
                    }
                }
            }
            empty -> EmptyState(title = "Bu kun uçun yozuv yöq", modifier = Modifier.padding(16.dp))
            else -> ListPlaceholder(offline) { scope.launch { load() } }
        }
    }

    val shown = detail
    if (marking && shown != null) MarkPaidDialog(
        name = shown.name, date = date, amountSom = shown.payableSom, busy = busy, onDismiss = { marking = false },
        onSubmit = { note ->
            busy = true
            scope.launch {
                // the amount on THIS screen is sent along: if it moved meanwhile the server writes nothing and says so
                val res = unwrap(app.repository.markPaid(date, restaurantId, shown.payableSom, note), onMessage)
                busy = false
                marking = false
                if (res != null) onMessage("✅ Ötkazma belgilandi: ${somText(res.amountSom)}.")
                load()
            }
        },
    )
    if (unmarking) NoteDialog(
        title = "Belgini bekor qiliş",
        hint = "Nima uçun bekor qilinayotganini yozing (masalan: adaşib bosildi, pul hali ötkazilmagan).",
        busy = busy, onDismiss = { unmarking = false },
        onSubmit = { note ->
            busy = true
            scope.launch {
                val res = unwrap(app.repository.unmarkPaid(date, restaurantId, note), onMessage)
                busy = false
                unmarking = false
                if (res != null) onMessage("Belgi bekor qilindi.")
                load()
            }
        },
    )
}

/** "Transferred" line: green when the mark still matches what is due, amber when the day changed after the transfer. */
@Composable
private fun PaidLine(paid: PaidDto?, payableSom: Long) {
    if (paid == null) return
    if (paid.amountSom == payableSom) StatusChip("Ötkazilgan: ${somText(paid.amountSom)} (${stampOf(paid.at)})", Tone.OK)
    else Notice(
        "${stampOf(paid.at)} da ${somText(paid.amountSom)} ötkazilgan deb belgilangan, hozir esa beriladigan summa ${somText(payableSom)} — farqni tekşiring.",
        Tone.WARN,
    )
}

@Composable
private fun MarkPaidDialog(name: String, date: String, amountSom: Long, busy: Boolean, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Ötkazdingizmi?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "$name — ${dayLabel(date)} kuni uçun ${somText(amountSom)}. Faqat bankda özingiz ötkazib bölgaç bosing: ilova pul ötkazmaydi, faqat belgilab qöyadi.",
                    style = MaterialTheme.typography.bodyLarge,
                )
                OutlinedTextField(
                    value = note, onValueChange = { if (it.length <= 300) note = it }, label = { Text("Izoh (ixtiyoriy: qaysi ilova, vaqt)") },
                    minLines = 1, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = { onSubmit(note) }) { Text("Ha, ötkazdim") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}
