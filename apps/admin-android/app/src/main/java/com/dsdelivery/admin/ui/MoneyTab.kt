package com.dsdelivery.admin.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.MoneyResponse
import com.dsdelivery.admin.data.ReviewDto
import com.dsdelivery.admin.ui.kit.AdminCard
import com.dsdelivery.admin.ui.kit.EmptyState
import com.dsdelivery.admin.ui.kit.ListPlaceholder
import com.dsdelivery.admin.ui.kit.Notice
import com.dsdelivery.admin.ui.kit.SectionHeader
import com.dsdelivery.admin.ui.kit.StatusChip
import com.dsdelivery.admin.ui.kit.PrimaryButton as KitPrimaryButton
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val NOTE_MIN = 10
private const val NOTE_MAX = 300

/**
 * "Pul": money that arrived but matched no payment (decide and write why), and payments the bank confirmed but the restaurant has not.
 * Closing an item only records the decision and the note; it never moves money (returning money to a payer is done in the bank).
 */
@Composable
fun MoneyTab(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<MoneyResponse?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<ReviewDto?>(null) }
    var saving by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.money()) {
            is ApiResult.Ok -> { data = r.data; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> offline = true
        }
        loading = false
    }

    // Fresh while the tab is open: new money can arrive any minute.
    LaunchedEffect(Unit) {
        while (true) {
            load()
            delay(20_000)
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (offline) item { Banner("Ulaniş yöq — röyxat eskirgan bölişi mumkin") }
            val d = data
            if (d == null) {
                item { ListPlaceholder(offline) { scope.launch { load() } } }
            } else {
                if (d.reviews.isEmpty() && d.stale.isEmpty()) {
                    item {
                        EmptyState(
                            title = "Mos kelmagan yoki kutayotgan pul yöq",
                            hint = "Yangi pul kelsa, şu yerda körinadi.",
                            icon = Icons.Filled.CheckCircle,
                        )
                    }
                }
                if (d.stale.isNotEmpty()) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            SectionHeader("Restoran tasdiqlamagan tölovlar (10+ daqiqa)")
                            Text(
                                "Mijoz tölagan, avtomatik tasdiq işlamadi, heç kim pişirmayapti. Restoranga qönğiroq qiling.",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    items(d.stale.size) { i ->
                        val s = d.stale[i]
                        AdminCard {
                            StatusChip("Tasdiq kutilmoqda", Tone.URGENT)
                            Text("#${s.orderCode ?: "?"} · ${s.restaurantName}", style = MaterialTheme.typography.titleMedium)
                            Text("${somText(s.amountSom)} · ${clockOf(s.matchedAt) ?: ""} dan beri", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (d.reviews.isNotEmpty()) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            SectionHeader("Mos kelmagan pul")
                            Text(
                                "Bank ilovasida tekşiring. Ilova pulni heç narsaga boğlamaydi: faqat qaror va izohingiz saqlanadi.",
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    items(d.reviews, key = { it.id }) { r ->
                        AdminCard(onClick = { selected = r }) {
                            Text(somText(r.amountSom), style = MaterialTheme.typography.titleLarge.merge(AmountStyle), color = UrgentColor)
                            Text("Karta ***${r.cardLast4}${r.restaurantName?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.titleSmall)
                            Text("Bank amali: ${clockOf(r.occurredAt) ?: ""}${r.emailReceivedAt?.let { e -> clockOf(e)?.let { " · xat: $it" } } ?: ""}", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle))
                            Text(r.reasonText, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Qaror yoziş", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
        }
    }

    selected?.let { item ->
        ReviewDialog(
            item = item, actions = data?.actions.orEmpty().map { it.action to it.label }, busy = saving,
            onDismiss = { selected = null },
            onSubmit = { action, note ->
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.handleReview(item.id, action, note), onMessage)
                    saving = false
                    if (res != null) {
                        selected = null
                        onMessage(if (res.result == "HANDLED") "Qaror va izoh saqlandi." else "Bu element allaqaçon yopilgan.")
                        load()
                    }
                }
            },
        )
    }
}

@Composable
private fun ReviewDialog(item: ReviewDto, actions: List<Pair<String, String>>, busy: Boolean, onDismiss: () -> Unit, onSubmit: (action: String, note: String) -> Unit) {
    var action by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    val ready = action != null && note.trim().length in NOTE_MIN..NOTE_MAX && !busy
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("${somText(item.amountSom)} · ***${item.cardLast4}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(item.reasonText, style = MaterialTheme.typography.bodyMedium)
                actions.forEach { (code, label) ->
                    Row(Modifier.fillMaxWidth().clickable { action = code }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = action == code, onClick = { action = code })
                        Text(label, style = MaterialTheme.typography.bodyLarge)
                    }
                }
                OutlinedTextField(
                    value = note, onValueChange = { if (it.length <= NOTE_MAX) note = it },
                    label = { Text("Izoh (kamida $NOTE_MIN belgi)") },
                    supportingText = { Text("Nima tekşirildi, buyurtma raqami yoki pul qaytarilgan hisob. ${note.trim().length}/$NOTE_MAX") },
                    modifier = Modifier.fillMaxWidth(), minLines = 3,
                )
            }
        },
        confirmButton = {
            TextButton(enabled = ready, onClick = { onSubmit(action!!, note) }) { Text("Saqlaş") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

/** Shared by the panes that are not restyled yet: same look as the kit (docs/ADMIN_UI_PLAN.md, stage 4 moves them to the kit directly). */
@Composable
internal fun Card(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    AdminCard(modifier, onClick = onClick) { content() }
}

/** The "no connection" strip at the top of a list. */
@Composable
internal fun Banner(text: String) {
    Notice(text, Tone.URGENT)
}

/** Full-width action button shared by the money and cards tabs. */
@Composable
internal fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    KitPrimaryButton(text, onClick, enabled = enabled)
}
