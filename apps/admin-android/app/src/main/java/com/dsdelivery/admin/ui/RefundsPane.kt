package com.dsdelivery.admin.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
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

private fun statusText(status: String, byPlatform: Boolean = false): String = when (status) {
    "REQUESTED" -> "restoran javobi kutilmoqda"
    "APPROVED" -> if (byPlatform) "pul platforma kartasida — SIZ qaytarasiz" else "restoran pulni qaytarişi kerak"
    "SENT" -> if (byPlatform) "siz yubordingiz — mijoz tasdiği kutilmoqda" else "restoran yubordi — mijoz tasdiği kutilmoqda"
    "DISPUTED" -> "mijoz: «pul KELMADI»"
    "CONFIRMED" -> "yopilgan (pul kelgani tasdiqlangan)"
    "REJECTED" -> "restoran rad etdi"
    else -> status
}

/** The tone of a refund's state. [canSend] = the administrator has to send the money himself, which is the urgent case. */
private fun statusTone(status: String, canSend: Boolean = false): Tone = when {
    canSend || status == "DISPUTED" -> Tone.URGENT
    status == "SENT" || status == "APPROVED" || status == "REQUESTED" -> Tone.WARN
    status == "CONFIRMED" -> Tone.OK
    else -> Tone.NEUTRAL
}

private fun actionText(action: String): String = when (action) {
    "REQUESTED" -> "sörov yuborildi"
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
    "Tölangan: ${somText(r.paidSom)}" + (r.approvedSom?.let { " • qaytariladi: ${somText(it)}" } ?: "")

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
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (offline) item { Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin") }
            item { SectionHeader("Oçiq qaytarişlar") }
            val list = open
            if (list == null) item { ListPlaceholder(offline) { scope.launch { load() } } }
            else {
                if (list.isEmpty()) item { EmptyState(title = "Oçiq qaytariş sörovi yöq", icon = Icons.Filled.CheckCircle) }
                items(list.size) { i -> RefundCard(list[i], onOpen) }
            }
            if (recent.isNotEmpty()) {
                item { SectionHeader("Oxirgi 14 kun (yopilgan)") }
                items(recent.size) { i -> RefundCard(recent[i], onOpen) }
            }
        }
    }
}

@Composable
private fun RefundCard(r: RefundRowDto, onOpen: (String) -> Unit) {
    AdminCard(onClick = { onOpen(r.id) }) {
        Text("#${r.orderCode} • ${r.restaurantName}", style = MaterialTheme.typography.titleMedium)
        StatusChip(statusText(r.status, r.byPlatform), statusTone(r.status, r.canSend))
        Text(amountLine(r), style = MaterialTheme.typography.bodyMedium.merge(AmountStyle))
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
        DetailHeader(detail?.let { "Qaytariş #${it.number}" } ?: "Qaytariş", onBack)
        if (offline) Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin")
        val d = detail
        if (d == null) {
            ListPlaceholder(offline) { scope.launch { load() } }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    AdminCard {
                        Text("Buyurtma #${d.orderCode} • ${d.restaurantName}", style = MaterialTheme.typography.titleMedium)
                        StatusChip(statusText(d.status, d.byPlatform), statusTone(d.status, d.canSend))
                        Text("Tölangan: ${somText(d.paidSom)}", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle))
                        if (d.approvedSom != null) Text("Qaytariladi: ${somText(d.approvedSom)}", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle))
                        if (d.reason != null) Text("Sabab: ${d.reason}", style = MaterialTheme.typography.bodyMedium)
                        if (d.rejectReason != null) Text("Rad etiş sababi: ${d.rejectReason}", style = MaterialTheme.typography.bodyMedium)
                        if (d.hasReceipt) Text("Restoran çek/bank raqamini körsatgan.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (d.confirmNote != null) Text("Izoh (${actorText(d.confirmedByType ?: "")}): ${d.confirmNote}", style = MaterialTheme.typography.bodyMedium)
                    }
                }
                item {
                    AdminCard {
                        Text("Mustaqil tekşiriş uçun", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            val rp = d.restaurantPhone?.takeIf { dialable(it).isNotEmpty() }
                            val cp = d.customerPhone?.takeIf { dialable(it).isNotEmpty() }
                            if (rp != null) SecondaryButton(d.restaurantName, { dial(rp) }, Modifier)
                            if (cp != null) SecondaryButton("Mijoz${d.customerName?.let { " ($it)" } ?: ""}", { dial(cp) }, Modifier)
                            if (rp == null && cp == null) Text("Telefon raqami yöq.", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                if (d.canSend) item {
                    AdminCard(highlight = Tone.URGENT) {
                        Text("Pul platforma kartasida", style = MaterialTheme.typography.titleMedium, color = UrgentColor)
                        Text(
                            "Mijoz restoranga emas, platforma kartasiga tölagan, şuning uçun qaytarişni SIZ yuborasiz: mijoz bilan boğlanib karta raqamini sörang, " +
                                "${somText(d.approvedSom ?: d.paidSom)} ni platforma kartasidan ötkazing, söng bank ma’lumotini (kvitansiya raqami) yozing. " +
                                "Ilova pul ötkazmaydi.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        KitPrimaryButton(if (d.status == "DISPUTED") "Qayta yubordim" else "Qaytardim", { sending = true }, enabled = !busy)
                    }
                }
                item {
                    if (d.canConfirm) {
                        AdminCard {
                            Notice("Pul mijozga yetib borganini restoran hisobi va mijoz bilan gaplaşib tekşiring. Tasdiqlaş yozma izoh bilan qayd etiladi. DS pul ötkazmaydi.", Tone.WARN)
                            KitPrimaryButton("Izoh bilan tasdiqlaş", { confirming = true }, enabled = !busy)
                        }
                    } else if (d.status == "CONFIRMED" || d.status == "REJECTED") {
                        Notice("Bu sörov yopilgan.", Tone.OK)
                    } else if (!d.canSend) {
                        Text("Restoran hali pulni yubormagan — administrator tasdiqlay olmaydi.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                item { SectionHeader("Tarix") }
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
                if (res != null) onMessage("✅ Qaytariş belgilandi. Mijozdan tasdiq söraladi.")
                load()
            }
        },
    )
    if (confirming) NoteDialog(
        title = "Qaytarişni tasdiqlaş",
        hint = "Nima tekşirilganini yozing: restoran hisobi köçirmasi, mijoz bilan telefon orqali gaplaşuv va hokazo.",
        busy = busy, onDismiss = { confirming = false },
        onSubmit = { note ->
            busy = true
            scope.launch {
                val res = unwrap(app.repository.confirmRefund(id, note), onMessage)
                busy = false
                confirming = false
                if (res != null) onMessage("✅ Qaytariş tasdiqlandi.")
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
        title = { Text("Qaytarişni belgilaş") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${somText(amountSom)} ni mijozga bankdan özingiz ötkazib bölgaç bosing. Bank ma’lumoti (kvitansiya yoki tranzaksiya raqami) şart; bitta ötkazma faqat bitta qaytarişga yoziladi.", style = MaterialTheme.typography.bodyLarge)
                androidx.compose.material3.OutlinedTextField(
                    value = reference, onValueChange = { if (it.length <= 64) reference = it }, label = { Text("Bank ma’lumoti") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ok, onClick = { onSubmit(reference) }) { Text("Ha, ötkazdim") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}
