package com.dsdelivery.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.AdminRestaurantDto
import com.dsdelivery.admin.data.ApiResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Who is on the platform; suspend or resume a restaurant (two taps: the switch and the confirmation). */
@Composable
fun RestaurantsPane(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<AdminRestaurantDto>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var target by remember { mutableStateOf<Pair<AdminRestaurantDto, Boolean>?>(null) }
    var saving by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.restaurants()) {
            is ApiResult.Ok -> { rows = r.data.restaurants; offline = false }
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
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (offline) item { Banner("Ulanish yo‘q — ro‘yxat eskirgan bo‘lishi mumkin", UrgentColor) }
            val list = rows
            if (list == null) {
                item { Text(if (offline) "Yuklab bo‘lmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                if (list.isEmpty()) item { Text("Restoranlar yo‘q.") }
                items(list.size) { i ->
                    val r = list[i]
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(r.name, style = MaterialTheme.typography.titleMedium)
                                Text(r.slug, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Switch(checked = r.isActive, enabled = !saving, onCheckedChange = { target = r to it })
                        }
                        Text(
                            if (r.isActive) "✅ faol" else "⛔ to‘xtatilgan", fontWeight = FontWeight.SemiBold,
                            color = if (r.isActive) OkColor else UrgentColor, style = MaterialTheme.typography.bodyMedium,
                        )
                        val notes = listOfNotNull(
                            if (r.isPaused) "⏸ pauzada" else null,
                            if (!r.hasPassword) "⚠️ parol yo‘q" else null,
                            if (!r.staffLinked) "Telegram xodimi ulanmagan" else null,
                            "kartalar: ${r.enabledCards} faol" + if (r.pendingCards > 0) ", ${r.pendingCards} kutmoqda" else "",
                        )
                        Text(notes.joinToString(" • "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    target?.let { (r, active) ->
        AlertDialog(
            onDismissRequest = { if (!saving) target = null },
            title = { Text(if (active) "${r.name}: qayta yoqilsinmi?" else "${r.name}: to‘xtatilsinmi?") },
            text = {
                Text(
                    if (active) "Restoran yana buyurtma qabul qila oladi."
                    else "Yangi buyurtmalar qabul qilinmaydi va restoran ilovadan chiqarib yuboriladi. Mavjud buyurtmalar o‘zgarmaydi.",
                )
            },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    saving = true
                    scope.launch {
                        val res = unwrap(app.repository.setRestaurantActive(r.id, active), onMessage)
                        saving = false
                        target = null
                        if (res != null) {
                            onMessage(
                                when (res.result) {
                                    "CHANGED" -> if (active) "✅ ${r.name} yoqildi." else "⛔ ${r.name} to‘xtatildi (${res.signedOut} ta seans yopildi)."
                                    else -> "Holat allaqachon shunday."
                                },
                            )
                        }
                        load()
                    }
                }) { Text(if (active) "Ha, yoqish" else "Ha, to‘xtatish") }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { target = null }) { Text("Yo‘q") } },
        )
    }
}
