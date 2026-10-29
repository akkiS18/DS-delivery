package com.dsdelivery.admin.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.CardDetailDto
import com.dsdelivery.admin.data.CardRowDto
import com.dsdelivery.admin.data.CardsResponse
import com.dsdelivery.admin.data.PoolCardDto
import com.dsdelivery.admin.data.PoolResponse
import com.dsdelivery.admin.data.PoolRestaurantDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun statusText(status: String): String = when (status) {
    "PENDING" -> "⏳ tasdiq kutmoqda"
    "ACTIVE" -> "✅ faol"
    "DISABLED" -> "⏸ o‘chirilgan"
    "REJECTED" -> "❌ rad etilgan"
    else -> status
}

/**
 * "Kartalar": approve new cards (the full number is shown here and only here, while a card waits), watch the platform card pool's
 * 30-day turnover, add a platform card, and choose which restaurants are paid on the platform's own cards.
 * Real payments stay off by default; nothing here opens them.
 */
@Composable
fun CardsTab(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var cards by remember { mutableStateOf<CardsResponse?>(null) }
    var pool by remember { mutableStateOf<PoolResponse?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<CardDetailDto?>(null) }
    var opening by remember { mutableStateOf<String?>(null) }
    var addOpen by remember { mutableStateOf(false) }
    var collect by remember { mutableStateOf<Pair<PoolRestaurantDto, Boolean>?>(null) }
    var saving by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        val c = app.repository.cards()
        val p = app.repository.pool()
        if (c is ApiResult.Unauthorized || p is ApiResult.Unauthorized) app.watcher.signOutLocally()
        if (c is ApiResult.Ok && p is ApiResult.Ok) { cards = c.data; pool = p.data; offline = false } else offline = true
        loading = false
    }

    LaunchedEffect(Unit) {
        while (true) {
            load()
            delay(30_000)
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (offline) item { Banner("Ulanish yo‘q — ma’lumot eskirgan bo‘lishi mumkin", UrgentColor) }
            val cs = cards
            val ps = pool
            if (cs == null || ps == null) {
                item { Text(if (offline) "Yuklab bo‘lmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                val pending = cs.cards.filter { it.status == "PENDING" }
                item { Text("Tasdiq kutayotgan kartalar", style = MaterialTheme.typography.titleMedium) }
                if (pending.isEmpty()) item { Text("Yo‘q.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(pending.size) { i ->
                    val c = pending[i]
                    PendingRow(c, busy = opening == c.id) {
                        opening = c.id
                        scope.launch {
                            unwrap(app.repository.cardDetail(c.id), onMessage)?.let { detail = it }
                            opening = null
                        }
                    }
                }

                item {
                    Spacer(Modifier.height(4.dp))
                    Text("Platforma kartalari", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (ps.capSom == 0L) "Chegara yo‘q (cheklanmagan)." else "Har bir karta uchun ${ps.days} kunda ${somText(ps.capSom)} chegara. 90% dan oshganda yangi to‘lovlar boshqa kartaga o‘tadi.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (ps.cards.isEmpty()) item { Text("Platforma kartasi yo‘q.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(ps.cards.size) { i -> PoolCardRow(ps.cards[i]) }
                item { OutlinedButton(onClick = { addOpen = true }, modifier = Modifier.fillMaxWidth()) { Text("+ Platforma kartasi qo‘shish") } }

                item {
                    Spacer(Modifier.height(4.dp))
                    Text("Pul qayerga tushadi", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Yoqilgan restoranning mijoz to‘lovlari platforma kartalariga tushadi, o‘chirilgan bo‘lsa restoranning o‘z kartalariga.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(ps.restaurants.size) { i ->
                    val r = ps.restaurants[i]
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(r.name, style = MaterialTheme.typography.titleMedium)
                                Text(if (r.collectsToPlatform) "Platforma kartalariga" else "Restoranning o‘z kartalariga", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Switch(checked = r.collectsToPlatform, enabled = !saving, onCheckedChange = { collect = r to it })
                        }
                    }
                }

                val others = cs.cards.filter { it.status != "PENDING" && !it.platform }
                item {
                    Spacer(Modifier.height(4.dp))
                    Text("Restoran kartalari", style = MaterialTheme.typography.titleMedium)
                }
                if (others.isEmpty()) item { Text("Yo‘q.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(others.size) { i ->
                    val c = others[i]
                    Card { Text("${c.restaurant} · ***${c.last4}", style = MaterialTheme.typography.bodyLarge); Text(statusText(c.status), style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
    }

    detail?.let { d ->
        CardDecisionDialog(
            card = d, busy = saving, onDismiss = { detail = null },
            onDecide = { approve ->
                saving = true
                scope.launch {
                    val r = unwrap(app.repository.decideCard(d.id, approve), onMessage)
                    saving = false
                    if (r != null) {
                        detail = null
                        onMessage(if (approve) "Karta ***${r.last4} tasdiqlandi. Endi mijozlarga beriladi." else "Karta ***${r.last4} rad etildi.")
                        load()
                    } else load() // most likely somebody decided first: show the current state
                }
            },
        )
    }

    if (addOpen) {
        AddPlatformCardDialog(
            busy = saving, onDismiss = { addOpen = false },
            onSubmit = { number, holder ->
                saving = true
                scope.launch {
                    val r = unwrap(app.repository.addPlatformCard(number, holder), onMessage)
                    saving = false
                    if (r != null) {
                        addOpen = false
                        onMessage("Karta ***${r.last4} qo‘shildi. Pastdagi „Tasdiq kutayotgan kartalar“ ro‘yxatida tasdiqlang.")
                        load()
                    }
                }
            },
        )
    }

    collect?.let { (r, on) ->
        AlertDialog(
            onDismissRequest = { if (!saving) collect = null },
            title = { Text(if (on) "${r.name}: platforma kartalariga o‘tkazasizmi?" else "${r.name}: o‘z kartalariga qaytarasizmi?") },
            text = {
                Text(
                    if (on) "Bu restoranning mijoz to‘lovlari platforma kartalariga tushadi. Restoranga pul alohida o‘tkaziladi. Hozir to‘lanmagan karta to‘lovi bo‘lsa, o‘tkazib bo‘lmaydi."
                    else "Bu restoranning mijoz to‘lovlari yana restoranning o‘z kartalariga tushadi.",
                )
            },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    saving = true
                    scope.launch {
                        val res = unwrap(app.repository.collect(r.slug, on), onMessage)
                        saving = false
                        collect = null
                        if (res != null) onMessage(if (res.result == "UNCHANGED") "${res.name}: o‘zgarmadi (allaqachon shunday)." else if (on) "${res.name}: endi pul platforma kartalariga tushadi." else "${res.name}: endi pul restoranning o‘z kartalariga tushadi.")
                        load()
                    }
                }) { Text("Ha") }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { collect = null }) { Text("Yo‘q") } },
        )
    }
}

@Composable
private fun PendingRow(c: CardRowDto, busy: Boolean, onOpen: () -> Unit) {
    Card {
        Text(if (c.platform) "Platforma kartasi" else c.restaurant, style = MaterialTheme.typography.titleMedium)
        Text("***${c.last4} · ${statusText(c.status)}", style = MaterialTheme.typography.bodyLarge)
        PrimaryButton(if (busy) "Ochilmoqda…" else "Ko‘rish va tasdiqlash", enabled = !busy, onClick = onOpen)
    }
}

@Composable
private fun PoolCardRow(c: PoolCardDto) {
    val color = when (c.level) { "HIGH" -> UrgentColor; "MID" -> WarnColor; else -> OkColor }
    Card {
        Row {
            Text("***${c.last4}", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            Text(statusText(c.status), style = MaterialTheme.typography.bodyMedium)
        }
        c.holderName?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (c.percent != null) {
            LinearProgressIndicator(progress = { (c.percent / 100f).coerceIn(0f, 1f) }, color = color, modifier = Modifier.fillMaxWidth().height(8.dp))
            Text("${c.percent}% · ${somText(c.turnoverSom)}", color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
        } else {
            Text("Aylanma: ${somText(c.turnoverSom)}", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** The full card number is on screen only here. Approval is two deliberate taps: customers' money goes to this card. */
@Composable
private fun CardDecisionDialog(card: CardDetailDto, busy: Boolean, onDismiss: () -> Unit, onDecide: (approve: Boolean) -> Unit) {
    val context = LocalContext.current
    var confirming by remember { mutableStateOf(false) }
    val phone = card.restaurant?.phone?.takeIf { dialable(it).isNotEmpty() }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Yangi to‘lov kartasi") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(card.restaurant?.let { "Restoran: ${it.name}" } ?: "Platforma kartasi (administrator qo‘shdi)", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                Text(card.number ?: "•••• •••• •••• ${card.last4}", fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                card.holderName?.let { Text("Karta egasi: $it", style = MaterialTheme.typography.bodyLarge) }
                Text(
                    if (card.restaurant != null) "⚠️ Mijozlarning puli shu kartaga tushadi. Restoran egasiga qo‘ng‘iroq qilib, karta aynan restoranniki ekanini tasdiqlang. Ishonchingiz komil bo‘lmasa rad eting."
                    else "⚠️ Mijozlarning puli shu kartaga tushadi. Raqam va egasining ismi o‘zingiz yozganiga mosligini tekshiring. Noto‘g‘ri bo‘lsa rad eting.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (phone != null) {
                    OutlinedButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialable(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }) { Text("📞 ${card.restaurant?.name}ga qo‘ng‘iroq") }
                }
                if (confirming) Text("Aniq tasdiqlaysizmi? Bundan keyin mijozlar shu kartaga to‘laydi.", color = UrgentColor, fontWeight = FontWeight.SemiBold)
            }
        },
        confirmButton = {
            if (confirming) TextButton(enabled = !busy, onClick = { onDecide(true) }) { Text("Ha, aniq tasdiqlayman") }
            else TextButton(enabled = !busy, onClick = { confirming = true }) { Text("Tasdiqlash") }
        },
        dismissButton = {
            Row {
                if (confirming) TextButton(enabled = !busy, onClick = { confirming = false }) { Text("Orqaga") }
                else TextButton(enabled = !busy, onClick = { onDecide(false) }) { Text("Rad etish", color = UrgentColor) }
                TextButton(enabled = !busy, onClick = onDismiss) { Text("Yopish") }
            }
        },
    )
}

@Composable
private fun AddPlatformCardDialog(busy: Boolean, onDismiss: () -> Unit, onSubmit: (number: String, holder: String) -> Unit) {
    var number by remember { mutableStateOf("") }
    var holder by remember { mutableStateOf("") }
    val digits = number.filter { it.isDigit() }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Platforma kartasini qo‘shish") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = number, onValueChange = { v -> if (v.count { it.isDigit() } <= 16 && v.all { it.isDigit() || it == ' ' }) number = v },
                    label = { Text("Karta raqami (16 xona)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = holder, onValueChange = { if (it.length <= 40) holder = it },
                    label = { Text("Karta egasining ismi") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Karta darhol ishlatilmaydi: u „Tasdiq kutayotgan kartalar“ ro‘yxatiga tushadi va siz uni alohida tasdiqlaysiz.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && digits.length == 16 && holder.trim().length >= 3, onClick = { onSubmit(digits, holder) }) { Text("Qo‘shish") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qilish") } },
    )
}
