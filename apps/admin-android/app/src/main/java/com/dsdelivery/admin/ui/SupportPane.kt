package com.dsdelivery.admin.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.InboxResponse
import com.dsdelivery.admin.data.ThreadDto
import com.dsdelivery.admin.data.TicketActionResponse
import com.dsdelivery.admin.data.TicketRowDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

private const val MAX_REPLY = 1000

/** One id per tap. A tap that is retried (no answer was seen) reuses it, so the server applies it only once. */
private fun newKey(): String = UUID.randomUUID().toString().replace("-", "")

private fun statusLabel(t: TicketRowDto): String = when (t.status) {
    "OPEN" -> "🆕 Oçiq"
    "IN_PROGRESS" -> if (t.mine) "🛠 Sizda" else "🛠 ${t.assignedAdminName ?: "Jarayonda"}"
    else -> "✅ Hal qilindi"
}

/** Support inbox. Same rules as the bot's /tickets and its buttons; the app only adds a conversation view. */
@Composable
fun SupportPane(onMessage: (String) -> Unit) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val id = openId
    BackHandler(enabled = id != null) { openId = null }
    if (id == null) InboxList(onOpen = { openId = it }, onMessage = onMessage)
    else TicketScreen(id = id, onBack = { openId = null }, onMessage = onMessage)
}

@Composable
private fun InboxList(onOpen: (String) -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var inbox by remember { mutableStateOf<InboxResponse?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.tickets()) {
            is ApiResult.Ok -> { inbox = r.data; offline = false }
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
            if (offline) item { Banner("Ulaniş yöq — röyxat eskirgan bölişi mumkin") }
            val data = inbox
            if (data == null) {
                item { Text(if (offline) "Yuklab bölmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                if (data.active.isEmpty()) item { Text("Oçiq murojaat yöq.", style = MaterialTheme.typography.titleMedium) }
                items(data.active.size) { i -> TicketCard(data.active[i]) { onOpen(data.active[i].id) } }
                if (data.resolved.isNotEmpty()) {
                    item { Text("Hal qilingan (oxirgi 7 kun)", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(data.resolved.size) { i -> TicketCard(data.resolved[i]) { onOpen(data.resolved[i].id) } }
                }
            }
        }
    }
}

@Composable
private fun TicketCard(t: TicketRowDto, onClick: () -> Unit) {
    Card(Modifier.clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("#${t.number} • ${t.restaurantName}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text(statusLabel(t), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        }
        Text("Buyurtma #${t.orderCode}" + (t.customerName?.let { " • $it" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(t.lastText, style = MaterialTheme.typography.bodyLarge, maxLines = 2)
        if (t.waiting) {
            Text("Mijoz yozdi ${stampOf(t.lastAt)} — javob kutmoqda", style = MaterialTheme.typography.bodyMedium, color = WarnColor, fontWeight = FontWeight.SemiBold)
        } else {
            Text("${if (t.lastFrom == "ADMIN") "Administrator" else "Mijoz"} • ${stampOf(t.lastAt)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private data class Confirm(val title: String, val text: String, val button: String, val run: () -> Unit)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TicketScreen(id: String, onBack: () -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val me = app.session.account.value?.telegramUserId
    var thread by remember { mutableStateOf<ThreadDto?>(null) }
    var offline by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var draft by rememberSaveable { mutableStateOf("") }
    var replyKey by remember { mutableStateOf(newKey()) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    val listState = rememberLazyListState()

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.ticket(id)) {
            is ApiResult.Ok -> { thread = r.data; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            is ApiResult.Failed -> if (r.code == 404) { onMessage("Murojaat topilmadi."); onBack() } else offline = true
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(id) {
        while (true) {
            load()
            delay(5_000)
        }
    }
    val count = thread?.messages?.size ?: 0
    LaunchedEffect(count) { if (count > 0) listState.animateScrollToItem(count - 1) }

    /** Runs one ticket action; whatever the answer, the thread is reloaded (a refusal usually means someone else changed it first). */
    fun act(done: String?, call: suspend (key: String) -> ApiResult<TicketActionResponse>) {
        if (busy) return
        busy = true
        scope.launch {
            val res = unwrap(call(newKey()), onMessage)
            busy = false
            if (res != null && done != null) onMessage(done)
            load()
        }
    }

    fun send() {
        if (busy) return
        val text = draft.trim()
        if (text.isEmpty()) return
        busy = true
        scope.launch {
            val res = unwrap(app.repository.replyTicket(id, replyKey, text), onMessage)
            busy = false
            if (res != null) { draft = ""; replyKey = newKey() } // on a failure the same key is kept: resending cannot double the message
            load()
        }
    }

    Column(Modifier.fillMaxSize()) {
        val t = thread
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Orqaga") }
            if (t != null) Text("#${t.ticket.number} • ${statusLabel(t.ticket)}", style = MaterialTheme.typography.titleMedium)
        }
        if (offline) Banner("Ulaniş yöq — suhbat eskirgan bölişi mumkin")
        if (t == null) {
            Text(if (offline) "Yuklab bölmadi." else "Yuklanmoqda…", modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Card(Modifier.padding(horizontal = 16.dp)) {
                Text("Buyurtma #${t.order.code} • ${t.order.restaurantName} • ${somText(t.order.totalSom)} (${t.order.status})", style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        (t.customer.name ?: "Mijoz") + (t.customer.phone?.let { " • $it" } ?: "") + if (t.customer.viaApp) " • ilovadan" else " • Telegram",
                        style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
                    )
                    val phone = t.customer.phone?.takeIf { dialable(it).isNotEmpty() }
                    if (phone != null) TextButton(onClick = {
                        runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialable(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    }) { Text("📞") }
                }
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(t.messages.size) { i ->
                    val m = t.messages[i]
                    val admin = m.from == "ADMIN"
                    Box(Modifier.fillMaxWidth(), contentAlignment = if (admin) Alignment.CenterEnd else Alignment.CenterStart) {
                        Column(
                            Modifier.fillMaxWidth(0.85f)
                                .background(if (admin) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface, RoundedCornerShape(14.dp))
                                .padding(10.dp),
                        ) {
                            Text(m.text, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                (if (admin) (m.byName ?: "Administrator") else "Mijoz") + " • " + stampOf(m.at) + if (m.failed) " • ⚠️ yetkazilmadi" else "",
                                style = MaterialTheme.typography.bodyMedium, color = if (m.failed) UrgentColor else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            val status = t.ticket.status
            val canWrite = status == "OPEN" || (status == "IN_PROGRESS" && t.ticket.mine)
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canWrite) {
                    if (status == "OPEN") Text("Javob yozsangiz, murojaat sizga ötadi.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = draft, onValueChange = { if (it.length <= MAX_REPLY) draft = it }, label = { Text("Mijozga javob") },
                            maxLines = 4, modifier = Modifier.weight(1f),
                        )
                        Button(enabled = !busy && draft.isNotBlank(), onClick = { send() }) { Text("Yuboriş") }
                    }
                } else if (status == "IN_PROGRESS") {
                    Text("Bu murojaat ${t.ticket.assignedAdminName ?: "boshqa administrator"} da. Javobni faqat egasi yozadi.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        status == "OPEN" -> OutlinedButton(enabled = !busy, onClick = { act("🙋 Murojaat sizga olindi.") { app.repository.claimTicket(id, it) } }) { Text("🙋 Men oldim") }
                        status == "IN_PROGRESS" && t.ticket.mine -> {
                            OutlinedButton(enabled = !busy, onClick = {
                                confirm = Confirm("Hal qilindimi?", "Mijozga «murojaatingiz hal qilindi» deb xabar boradi.", "Ha, hal qilindi") { act("✅ Hal qilindi.") { app.repository.resolveTicket(id, it) } }
                            }) { Text("✅ Hal qilindi") }
                            t.others.forEach { o ->
                                OutlinedButton(enabled = !busy, onClick = {
                                    confirm = Confirm("Ötkazilsinmi?", "Murojaat ${o.name} ga ötadi; unga xabar boradi.", "Ha, ötkaziş") { act("🔁 ${o.name} ga ötkazildi.") { k -> app.repository.reassignTicket(id, k, o.telegramId) } }
                                }) { Text("🔁 ${o.name} ga") }
                            }
                        }
                        status == "IN_PROGRESS" && me != null -> OutlinedButton(enabled = !busy, onClick = {
                            confirm = Confirm("Menga ötkazilsinmi?", "Murojaat ${t.ticket.assignedAdminName ?: "boshqa administrator"} dan sizga ötadi.", "Ha, menga") { act("🔁 Murojaat sizga ötdi.") { k -> app.repository.reassignTicket(id, k, me) } }
                        }) { Text("🔁 Menga ötkaziş") }
                        status == "RESOLVED" -> OutlinedButton(enabled = !busy, onClick = { act("♻️ Murojaat qayta oçildi.") { app.repository.reopenTicket(id, it) } }) { Text("♻️ Qayta oçiş") }
                    }
                }
            }
        }
    }

    confirm?.let { c ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(c.title) }, text = { Text(c.text) },
            confirmButton = { TextButton(onClick = { confirm = null; c.run() }) { Text(c.button) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Yöq") } },
        )
    }
}
