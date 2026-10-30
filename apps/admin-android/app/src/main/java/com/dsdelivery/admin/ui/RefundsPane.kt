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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.RefundDetailDto
import com.dsdelivery.admin.data.RefundRowDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun statusText(status: String, byPlatform: Boolean = false): String = when (status) {
    "REQUESTED" -> "restoran javobi kutilmoqda"
    "APPROVED" -> if (byPlatform) "pul platforma kartasida — SIZ qaytarasiz" else "restoran pulni qaytarishi kerak"
    "SENT" -> if (byPlatform) "siz yubordingiz — mijoz tasdig‘i kutilmoqda" else "restoran yubordi — mijoz tasdig‘i kutilmoqda"
    "DISPUTED" -> "mijoz: «pul KELMADI»"
    "CONFIRMED" -> "yopilgan (pul kelgani tasdiqlangan)"
    "REJECTED" -> "restoran rad etdi"
    else -> status
}

private fun statusColor(status: String): Color = when (status) {
    "DISPUTED" -> UrgentColor
    "SENT", "APPROVED", "REQUESTED" -> WarnColor
    "CONFIRMED" -> OkColor
    else -> NeutralColor
}

private fun actionText(action: String): String = when (action) {
    "REQUESTED" -> "so‘rov yuborildi"
    "APPROVED" -> "restoran qabul qildi"
    "REJECTED" -> "rad etildi"
    "SENT" -> "pul yuborildi deb belgilandi"
    "DISPUTED" -> "pul kelmadi, deb e’tiroz"
    "CONFIRMED" -> "pul kelgani tasdiqlandi"
    else -> action
}

private fun actorText(actor: String): String = when (actor) {
    "CUSTOMER" -> "mijoz"
    "RESTAURANT", "STAFF" -> "restoran"
    "ADMIN" -> "administrator"
    "SYSTEM" -> "tizim"
    else -> actor.lowercase()
}

private fun amountLine(r: RefundRowDto): String =
    "To‘langan: ${somText(r.paidSom)}" + (r.approvedSom?.let { " • qaytariladi: ${somText(it)}" } ?: "")

/** Refunds (the bot's /refunds list and "Izoh bilan tasdiqlash"). The platform never moves money; only the restaurant does. */
@Composable
fun RefundsPane(onMessage: (String) -> Unit) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val id = openId
    BackHandler(enabled = id != null) { openId = null }
    if (id == null) RefundsHome(onOpen = { openId = it }, onMessage = onMessage)
    else RefundScreen(id = id, onBack = { openId = null }, onMessage = onMessage)
}

@Composable
private fun RefundsHome(onOpen: (String) -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf<List<RefundRowDto>?>(null) }
    var recent by remember { mutableStateOf<List<RefundRowDto>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.refunds()) {
            is ApiResult.Ok -> { open = r.data.open; recent = r.data.recent; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(Unit) {
        while (true) {
            load()
            delay(10_000)
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (offline) item { Banner("Ulanish yo‘q — ma’lumot eskirgan bo‘lishi mumkin", UrgentColor) }
            item { Text("💸 Ochiq qaytarishlar", style = MaterialTheme.typography.titleMedium) }
            val list = open
            if (list == null) item { Text(if (offline) "Yuklab bo‘lmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else {
                if (list.isEmpty()) item { Text("✅ Ochiq qaytarish so‘rovi yo‘q.", style = MaterialTheme.typography.bodyLarge, color = OkColor) }
                items(list.size) { i -> RefundCard(list[i], onOpen) }
            }
            if (recent.isNotEmpty()) {
                item { Text("Oxirgi 14 kun (yopilgan)", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
                items(recent.size) { i -> RefundCard(recent[i], onOpen) }
            }
        }
    }
}

@Composable
private fun RefundCard(r: RefundRowDto, onOpen: (String) -> Unit) {
    Card(Modifier.clickable { onOpen(r.id) }) {
        Text("#${r.orderCode} • ${r.restaurantName}", style = MaterialTheme.typography.titleMedium)
        Text(statusText(r.status, r.byPlatform), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = if (r.canSend) UrgentColor else statusColor(r.status))
        Text(amountLine(r), style = MaterialTheme.typography.bodyMedium)
        if (r.reason != null) Text("Sabab: ${r.reason}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stampOf(r.lastAt), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RefundScreen(id: String, onBack: () -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var detail by remember { mutableStateOf<RefundDetailDto?>(null) }
    var offline by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.refund(id)) {
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
            delay(8_000)
        }
    }

    fun dial(phone: String) {
        runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialable(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Orqaga") }
        }
        if (offline) Banner("Ulanish yo‘q — ma’lumot eskirgan bo‘lishi mumkin", UrgentColor)
        val d = detail
        if (d == null) {
            Text(if (offline) "Yuklab bo‘lmadi." else "Yuklanmoqda…", modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Card {
                        Text("💸 Qaytarish #${d.number} • buyurtma #${d.orderCode}", style = MaterialTheme.typography.titleMedium)
                        Text(d.restaurantName, style = MaterialTheme.typography.bodyLarge)
                        Text(statusText(d.status, d.byPlatform), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = if (d.canSend) UrgentColor else statusColor(d.status))
                        Text("To‘langan: ${somText(d.paidSom)}", style = MaterialTheme.typography.bodyMedium)
                        if (d.approvedSom != null) Text("Qaytariladi: ${somText(d.approvedSom)}", style = MaterialTheme.typography.bodyMedium)
                        if (d.reason != null) Text("Sabab: ${d.reason}", style = MaterialTheme.typography.bodyMedium)
                        if (d.rejectReason != null) Text("Rad etish sababi: ${d.rejectReason}", style = MaterialTheme.typography.bodyMedium)
                        if (d.hasReceipt) Text("Restoran chek/bank raqamini ko‘rsatgan.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (d.confirmNote != null) Text("Izoh (${actorText(d.confirmedByType ?: "")}): ${d.confirmNote}", style = MaterialTheme.typography.bodyMedium)
                    }
                }
                item {
                    Card {
                        Text("Mustaqil tekshirish uchun", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val rp = d.restaurantPhone?.takeIf { dialable(it).isNotEmpty() }
                            val cp = d.customerPhone?.takeIf { dialable(it).isNotEmpty() }
                            if (rp != null) OutlinedButton(onClick = { dial(rp) }) { Text("📞 ${d.restaurantName}") }
                            if (cp != null) OutlinedButton(onClick = { dial(cp) }) { Text("📞 Mijoz${d.customerName?.let { " ($it)" } ?: ""}") }
                            if (rp == null && cp == null) Text("Telefon raqami yo‘q.", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                if (d.canSend) item {
                    Card {
                        Text("Pul platforma kartasida", style = MaterialTheme.typography.titleMedium, color = UrgentColor)
                        Text(
                            "Mijoz restoranga emas, platforma kartasiga to‘lagan, shuning uchun qaytarishni SIZ yuborasiz: mijoz bilan bog‘lanib karta raqamini so‘rang, " +
                                "${somText(d.approvedSom ?: d.paidSom)} ni platforma kartasidan o‘tkazing, so‘ng bank ma’lumotini (kvitansiya raqami) yozing. " +
                                "Ilova pul o‘tkazmaydi.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        PrimaryButton(if (d.status == "DISPUTED") "💸 Qayta yubordim" else "💸 Qaytardim", enabled = !busy) { sending = true }
                    }
                }
                item {
                    if (d.canConfirm) {
                        Card {
                            Text(
                                "Pul mijozga yetib borganini restoran hisobi va mijoz bilan gaplashib tekshiring. Tasdiqlash yozma izoh bilan qayd etiladi. DS pul o‘tkazmaydi.",
                                style = MaterialTheme.typography.bodyMedium, color = WarnColor,
                            )
                            PrimaryButton("✅ Izoh bilan tasdiqlash", enabled = !busy) { confirming = true }
                        }
                    } else if (d.status == "CONFIRMED" || d.status == "REJECTED") {
                        Text("Bu so‘rov yopilgan.", style = MaterialTheme.typography.bodyLarge, color = OkColor)
                    } else if (!d.canSend) {
                        Text("Restoran hali pulni yubormagan — administrator tasdiqlay olmaydi.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                item { Text("Tarix", style = MaterialTheme.typography.titleMedium) }
                items(d.events.size) { i ->
                    val e = d.events[i]
                    Text("${stampOf(e.at)} — ${actorText(e.actor)}: ${actionText(e.action)}", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }

    if (sending) SendRefundDialog(
        amountSom = detail?.let { it.approvedSom ?: it.paidSom } ?: 0, busy = busy, onDismiss = { sending = false },
        onSubmit = { reference ->
            busy = true
            scope.launch {
                val res = unwrap(app.repository.sentRefund(id, reference), onMessage)
                busy = false
                sending = false
                if (res != null) onMessage("✅ Qaytarish belgilandi. Mijozdan tasdiq so‘raladi.")
                load()
            }
        },
    )
    if (confirming) NoteDialog(
        title = "Qaytarishni tasdiqlash",
        hint = "Nima tekshirilganini yozing: restoran hisobi ko‘chirmasi, mijoz bilan telefon orqali gaplashuv va hokazo.",
        busy = busy, onDismiss = { confirming = false },
        onSubmit = { note ->
            busy = true
            scope.launch {
                val res = unwrap(app.repository.confirmRefund(id, note), onMessage)
                busy = false
                confirming = false
                if (res != null) onMessage("✅ Qaytarish tasdiqlandi.")
                load() // a refusal (CHANGED) also means someone else moved it on: show the current state
            }
        },
    )
}
/** The administrator's record of a refund he sent from the platform card: only the bank reference is typed (the database needs a proof for "sent"). */
@Composable
private fun SendRefundDialog(amountSom: Long, busy: Boolean, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var reference by remember { mutableStateOf("") }
    val ok = reference.trim().length in 4..64 && reference.any { it.isDigit() }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Qaytarishni belgilash") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${somText(amountSom)} ni mijozga bankdan o‘zingiz o‘tkazib bo‘lgach bosing. Bank ma’lumoti (kvitansiya yoki tranzaksiya raqami) shart; bitta o‘tkazma faqat bitta qaytarishga yoziladi.", style = MaterialTheme.typography.bodyLarge)
                androidx.compose.material3.OutlinedTextField(
                    value = reference, onValueChange = { if (it.length <= 64) reference = it }, label = { Text("Bank ma’lumoti") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ok, onClick = { onSubmit(reference) }) { Text("Ha, o‘tkazdim") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qilish") } },
    )
}
