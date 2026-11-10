package com.dsdelivery.admin.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.CustomerDetailDto
import com.dsdelivery.admin.data.CustomerRowDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun who(name: String?, phone: String?, tg: String?): String =
    listOfNotNull(name?.takeIf { it.isNotBlank() }, phone?.takeIf { it.isNotBlank() }, tg?.let { "TG $it" }).joinToString(" • ").ifEmpty { "Noma’lum mijoz" }

private fun standingText(blocked: Boolean, manual: Boolean, strikes: Int, cashAllowed: Boolean): String = when {
    manual -> "⛔ Administrator bloklagan"
    blocked -> "⛔ Bloklangan ($strikes ta strike)"
    !cashAllowed -> "⚠️ $strikes ta strike — naqd tölov yopiq"
    else -> "✅ Çeklov yöq"
}

@androidx.compose.runtime.Composable
private fun standingColor(blocked: Boolean, cashAllowed: Boolean) = when {
    blocked -> UrgentColor
    !cashAllowed -> WarnColor
    else -> OkColor
}

private fun sourceText(source: String): String = when (source) {
    "RESTAURANT" -> "restoran"
    "TAXI" -> "taksi"
    "ADMIN" -> "administrator"
    else -> source.lowercase()
}

/**
 * Customers with strikes or blocks. Owner rule: one active strike turns cash off for that customer, five strikes (or a block by hand) stop them
 * ordering at all. A strike is never erased: it is revoked with a written note. Every change needs a note of 10-300 characters.
 */
@Composable
fun CustomersPane(onMessage: (String) -> Unit) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val id = openId
    BackHandler(enabled = id != null) { openId = null }
    if (id == null) CustomersHome(onOpen = { openId = it }, onMessage = onMessage)
    else CustomerScreen(id = id, onBack = { openId = null }, onMessage = onMessage)
}

@Composable
private fun CustomersHome(onOpen: (String) -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var typed by rememberSaveable { mutableStateOf("") }
    var applied by rememberSaveable { mutableStateOf("") }
    var list by remember { mutableStateOf<List<CustomerRowDto>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.customers(applied)) {
            is ApiResult.Ok -> { list = r.data.customers; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(applied) {
        list = null
        while (true) {
            load()
            delay(15_000)
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (offline) item { Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin", UrgentColor) }
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = typed, onValueChange = { if (it.length <= 80) typed = it }, singleLine = true, modifier = Modifier.weight(1f),
                        label = { Text("Telefon, Telegram ID, ism yoki buyurtma raqami") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { applied = typed.trim() }),
                    )
                    OutlinedButton(onClick = { applied = typed.trim() }) { Text("Qidiriş") }
                }
            }
            item {
                Text(
                    if (applied.isEmpty()) "Strike yoki bloki bor mijozlar" else "Qidiruv natijasi: «$applied»",
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            val rows = list
            if (rows == null) item { Text(if (offline) "Yuklab bölmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else {
                if (rows.isEmpty()) item {
                    Text(
                        if (applied.isEmpty()) "✅ Hozir strike yoki bloki bor mijoz yöq." else "Heç kim topilmadi (telefon uçun kamida 5 raqam).",
                        style = MaterialTheme.typography.bodyLarge, color = if (applied.isEmpty()) OkColor else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(rows.size) { i ->
                    val c = rows[i]
                    Card(Modifier.clickable { onOpen(c.id) }) {
                        Text(who(c.name, c.phone, c.telegramUserId), style = MaterialTheme.typography.titleMedium)
                        Text(standingText(c.blocked, c.manuallyBlocked, c.strikes, c.cashAllowed), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = standingColor(c.blocked, c.cashAllowed))
                        if (c.lastStrikeAt != null) Text("Oxirgi strike: ${stampOf(c.lastStrikeAt)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

private const val NOTE_MIN = 10
private const val NOTE_MAX = 300

/**
 * A strike for an order the customer did not receive: the administrator was phoned by the restaurant or the taxi service. The order code is
 * optional but recommended (the same order cannot be struck twice); the customer's latest orders are offered as one-tap choices.
 */
@Composable
private fun StrikeDialog(orders: List<String>, busy: Boolean, onDismiss: () -> Unit, onSubmit: (note: String, orderCode: String?) -> Unit) {
    var note by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Strike beriş") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Qaysi buyurtmani mijoz olmadi va kim xabar berdi? Strike mijozning naqd tölovini yopadi (5 ta bölsa — butunlay blok).", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = code, onValueChange = { if (it.length <= 12) code = it.uppercase() }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    label = { Text("Buyurtma raqami (tavsiya etiladi)") },
                    supportingText = { Text(if (orders.isEmpty()) "Masalan: K7P3X" else "Oxirgi buyurtmalar: " + orders.take(4).joinToString(", ")) },
                )
                OutlinedTextField(
                    value = note, onValueChange = { if (it.length <= NOTE_MAX) note = it }, label = { Text("Izoh (kamida $NOTE_MIN belgi)") },
                    supportingText = { Text("${note.trim().length}/$NOTE_MAX") }, minLines = 2, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && note.trim().length in NOTE_MIN..NOTE_MAX, onClick = { onSubmit(note, code.trim().ifEmpty { null }) }) { Text("Strike beriş") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

private sealed interface CustomerAction {
    data object Strike : CustomerAction
    data object Block : CustomerAction
    data object Unblock : CustomerAction
    data class Revoke(val strikeId: String) : CustomerAction
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CustomerScreen(id: String, onBack: () -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var detail by remember { mutableStateOf<CustomerDetailDto?>(null) }
    var offline by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<CustomerAction?>(null) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.customer(id)) {
            is ApiResult.Ok -> { detail = r.data; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            is ApiResult.Failed -> if (r.code == 404) { onMessage("Topilmadi."); onBack() } else offline = true
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(id) {
        while (true) {
            load()
            delay(10_000)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Orqaga") }
        }
        if (offline) Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin", UrgentColor)
        val d = detail
        if (d == null) {
            Text(if (offline) "Yuklab bölmadi." else "Yuklanmoqda…", modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Card {
                        Text(who(d.name, d.phone, d.telegramUserId), style = MaterialTheme.typography.titleMedium)
                        Text(standingText(d.blocked, d.manuallyBlocked, d.strikes, d.cashAllowed), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = standingColor(d.blocked, d.cashAllowed))
                        if (d.manuallyBlocked && d.blockNote != null) Text("Blok izohi: ${d.blockNote}", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "1 ta strike — naqd tölov yopiladi, 5 ta strike yoki blok — buyurtma berolmaydi. Karta orqali tölaş 1–4 strikeda oçiq.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val phone = d.phone?.takeIf { dialable(it).isNotEmpty() }
                            if (phone != null) OutlinedButton(onClick = {
                                runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialable(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                            }) { Text("📞 Qönğiroq") }
                            OutlinedButton(enabled = !busy, onClick = { pending = CustomerAction.Strike }) { Text("⚠️ Strike beriş") }
                            if (d.manuallyBlocked) OutlinedButton(enabled = !busy, onClick = { pending = CustomerAction.Unblock }) { Text("✅ Blokdan çiqariş") }
                            else OutlinedButton(enabled = !busy, onClick = { pending = CustomerAction.Block }) { Text("⛔ Bloklaş", color = UrgentColor) }
                        }
                    }
                }
                item { Text("Strikelar", style = MaterialTheme.typography.titleMedium) }
                if (d.strikeLines.isEmpty()) item { Text("Strike yöq.", style = MaterialTheme.typography.bodyMedium) }
                items(d.strikeLines.size) { i ->
                    val s = d.strikeLines[i]
                    val active = s.revokedAt == null
                    Card {
                        Text(
                            "${stampOf(s.createdAt)} • ${sourceText(s.source)}" + (s.orderCode?.let { " • buyurtma #$it" } ?: "") + if (active) "" else " • BEKOR QILINGAN",
                            style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold,
                            color = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(s.note, style = MaterialTheme.typography.bodyMedium)
                        if (!active) Text("Bekor qiliş izohi: ${s.revokeNote ?: ""}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else OutlinedButton(enabled = !busy, onClick = { pending = CustomerAction.Revoke(s.id) }) { Text("↩️ Strikeni bekor qiliş") }
                    }
                }
                item { Text("Oxirgi buyurtmalar", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
                if (d.recentOrders.isEmpty()) item { Text("Buyurtma yöq.", style = MaterialTheme.typography.bodyMedium) }
                items(d.recentOrders.size) { i ->
                    val o = d.recentOrders[i]
                    Text(
                        "${stampOf(o.at)} • #${o.code} • ${somText(o.totalSom)} • ${if (o.payment == "CASH") "naqd" else "karta"} • ${o.status}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }

    if (pending == CustomerAction.Strike) {
        StrikeDialog(
            orders = detail?.recentOrders?.map { it.code }.orEmpty(), busy = busy, onDismiss = { pending = null },
            onSubmit = { note, orderCode ->
                busy = true
                scope.launch {
                    val res = unwrap(app.repository.addStrike(id, note, orderCode), onMessage)
                    busy = false
                    pending = null
                    if (res != null) onMessage("✅ Saqlandi.")
                    load()
                }
            },
        )
    }

    pending?.takeIf { it != CustomerAction.Strike }?.let { p ->
        NoteDialog(
            title = when (p) { CustomerAction.Strike -> "Strike beriş"; CustomerAction.Block -> "Mijozni bloklaş"; CustomerAction.Unblock -> "Blokdan çiqariş"; is CustomerAction.Revoke -> "Strikeni bekor qiliş" },
            hint = when (p) {
                CustomerAction.Strike -> "Nima bölganini yozing: qaysi buyurtma, kim tasdiqladi. Strike mijozning naqd tölovini yopadi."
                CustomerAction.Block -> "Sababini yozing (masalan, soxta buyurtmalar). Bloklangan mijoz heç narsa buyurtma qila olmaydi."
                CustomerAction.Unblock -> "Nima uçun blok olib taşlanayotganini yozing."
                is CustomerAction.Revoke -> "Strike nima uçun bekor qilinayotganini yozing. Strike öçirilmaydi, «bekor qilingan» deb qoladi."
            },
            busy = busy, onDismiss = { pending = null },
            onSubmit = { note ->
                busy = true
                scope.launch {
                    val res = unwrap(
                        when (p) {
                            CustomerAction.Strike -> app.repository.addStrike(id, note)
                            CustomerAction.Block -> app.repository.blockCustomer(id, note)
                            CustomerAction.Unblock -> app.repository.unblockCustomer(id, note)
                            is CustomerAction.Revoke -> app.repository.revokeStrike(id, p.strikeId, note)
                        },
                        onMessage,
                    )
                    busy = false
                    pending = null
                    if (res != null) onMessage("✅ Saqlandi.")
                    load() // a refusal (CHANGED) also means someone else moved it on: show the current state
                }
            },
        )
    }
}
