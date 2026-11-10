package com.dsdelivery.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.StatementDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val NOTE_MIN = 10
private const val NOTE_MAX = 300

/**
 * Weekly commission (week = Monday 00:00 to Monday 00:00, Tashkent). "To‘landi" only RECORDS that the money was seen in the bank; it moves
 * nothing. The amount on screen is sent along: if it changed meanwhile (a new ticket holds an order), the server records nothing.
 */
@Composable
fun CommissionPane(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<StatementDto>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var settle by remember { mutableStateOf<StatementDto?>(null) }
    var saving by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.commission()) {
            is ApiResult.Ok -> { rows = r.data.statements; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(Unit) {
        while (true) {
            load()
            delay(60_000)
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (offline) item { Banner("Ulaniş yöq — hisob eskirgan bölişi mumkin", UrgentColor) }
            val list = rows
            if (list == null) {
                item { Text(if (offline) "Yuklab bölmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                if (list.isEmpty()) item { Text("Tölanmagan komissiya yöq.", style = MaterialTheme.typography.titleMedium) }
                items(list.size) { i ->
                    val s = list[i]
                    Card {
                        Text(s.name, style = MaterialTheme.typography.titleMedium)
                        Text("Hozir tölanişi kerak: ${s.due.count} ta · ${somText(s.due.amountSom)}", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyLarge)
                        if (s.held.count > 0) Text("Uşlab turilgan (oçiq murojaat): ${s.held.count} ta · ${somText(s.held.amountSom)}", style = MaterialTheme.typography.bodyMedium, color = WarnColor)
                        if (s.current.count > 0) Text("Joriy hafta (hafta yopilgaç): ${s.current.count} ta · ${somText(s.current.amountSom)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (s.due.count > 0) PrimaryButton("✅ ${somText(s.due.amountSom)} tölandi") { settle = s }
                    }
                }
            }
        }
    }

    settle?.let { s ->
        var note by remember(s.restaurantId) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { if (!saving) settle = null },
            title = { Text("${s.name}: ${somText(s.due.amountSom)}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${s.due.count} ta buyurtma. Bank hisobida aynan şu summa restorandan kelganini tekşirdingizmi?", style = MaterialTheme.typography.bodyLarge)
                    OutlinedTextField(
                        value = note, onValueChange = { if (it.length <= NOTE_MAX) note = it },
                        label = { Text("Izoh (kamida $NOTE_MIN belgi)") },
                        supportingText = { Text("Bank amali sanasi/vaqti va qaysi hisobdan kelgani. ${note.trim().length}/$NOTE_MAX") },
                        modifier = Modifier.fillMaxWidth(), minLines = 2,
                    )
                }
            },
            confirmButton = {
                TextButton(enabled = !saving && note.trim().length in NOTE_MIN..NOTE_MAX, onClick = {
                    saving = true
                    scope.launch {
                        val res = unwrap(app.repository.settle(s.restaurantId, s.due.count, s.due.amountSom, note), onMessage)
                        saving = false
                        if (res != null) {
                            settle = null
                            onMessage("✅ Hisob #${res.settlementNumber} qayd etildi: ${res.count} ta buyurtma, ${somText(res.amountSom)}.")
                        }
                        load() // a refusal (CHANGED / NOTHING_DUE) also means the numbers on screen are stale
                    }
                }) { Text("Ha, bankda kördim") }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { settle = null }) { Text("Yöq") } },
        )
    }
}
