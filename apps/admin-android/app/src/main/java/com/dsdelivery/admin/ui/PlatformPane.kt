package com.dsdelivery.admin.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.RatingsDto
import com.dsdelivery.admin.data.SettingsChangeResponse
import com.dsdelivery.admin.data.SettingsDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// FREE and LINE are both the backend mode LINE ("Platforma xizmati" row after the dishes): FREE = crossed out as a discount, nobody pays; LINE = the customer pays.
// FLAT (old: the customer sees nothing, the restaurant is charged 5 000) is offered only while it is the current mode.
private val FEE_MODES = listOf(
    "FREE" to "Tekis — çegirma (heç kim tölamaydi)",
    "LINE" to "Mijoz tölaydi: alohida qator «Platforma xizmati»",
    "PERCENT" to "Foiz",
    "TIERED" to "Poğonali (50 000 gaça 10%, keyin 3%)",
)

private enum class Pending { PAYMENTS_OPEN, PAYMENTS_CLOSE, CASH_ON, CASH_OFF }

/**
 * Platform switches that used to be bot commands: real payments (/payments), cash (/cash), service fee (/fee), when the taxi is called (/taxi)
 * and the rating ranking (/ratings). Every switch asks first; the server audits the change and also announces it in the bot chat.
 * Nothing here opens real payments by itself, and the server refuses while the same blockers as /payments apply.
 */
@Composable
fun PlatformPane(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var settings by remember { mutableStateOf<SettingsDto?>(null) }
    var ratings by remember { mutableStateOf<RatingsDto?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<Pending?>(null) }
    var saving by remember { mutableStateOf(false) }

    suspend fun load() {
        if (loading) return
        loading = true
        val s = app.repository.settings()
        val r = app.repository.ratings()
        if (s is ApiResult.Unauthorized || r is ApiResult.Unauthorized) app.watcher.signOutLocally()
        if (s is ApiResult.Ok) { settings = s.data; offline = false } else offline = true
        if (r is ApiResult.Ok) ratings = r.data
        loading = false
    }

    LaunchedEffect(Unit) {
        while (true) {
            load()
            delay(30_000)
        }
    }

    /** Runs one settings change; the answer carries the new state. */
    fun change(call: suspend () -> ApiResult<SettingsChangeResponse>, done: (SettingsChangeResponse) -> String) {
        if (saving) return
        saving = true
        scope.launch {
            val res = unwrap(call(), onMessage)
            saving = false
            if (res != null) { settings = res.settings; onMessage(done(res)) }
            load()
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (offline) item { Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin", UrgentColor) }
            val s = settings
            if (s == null) {
                item { Text(if (offline) "Yuklab bölmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                item { PaymentsCard(s, saving) { pending = if (s.payments.open) Pending.PAYMENTS_CLOSE else Pending.PAYMENTS_OPEN } }
                item {
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("💵 Naqd tölov", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    if (s.cash.enabled) "Yoqilgan: mijoz naqd tölaşni tanlay oladi." else "Öçirilgan: yangi naqd buyurtma olinmaydi.",
                                    style = MaterialTheme.typography.bodyMedium, color = if (s.cash.enabled) OkColor else UrgentColor, fontWeight = FontWeight.SemiBold,
                                )
                            }
                            Switch(checked = s.cash.enabled, enabled = !saving, onCheckedChange = { pending = if (it) Pending.CASH_ON else Pending.CASH_OFF })
                        }
                        Text(
                            "Naqd buyurtmani restoran qabul qiladi, taksi operatori summani köradi. Eng köp summa: ${somText(s.cash.maxOrderSom)}. Öçirsangiz ham, berilgan naqd buyurtmalar davom etadi.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                item { CashMaxCard(s, saving) { som -> change({ app.repository.setCashMax(som) }) { r -> if (r.result == "CHANGED") "Naqd çegarasi saqlandi." else "O‘zgarmadi." } } }
                item { FeeCard(s, saving) { mode, percent, line, waived -> change({ app.repository.setFee(mode, percent, line, waived) }) { r -> if (r.result == "CHANGED") "Xizmat haqi saqlandi." else "O‘zgarmadi." } } }
                item {
                    Card {
                        Text("🚕 Taksi qaçon çaqiriladi", style = MaterialTheme.typography.titleMedium)
                        if (s.taxiMode == "READY") {
                            Text("Hozir: restoran «Tayyor» bosganda. Haydovçi biroz keç qolişi mumkin, lekin erta kelmaydi.", style = MaterialTheme.typography.bodyMedium)
                        } else {
                            Text(
                                "Hozir: taom tayyor bölişidan 4 daqiqa oldin. Tayyorlaş vaqti endi söralmagani uçun bu rejim yaşirin standart vaqtga tayanadi; «Tayyor» bosilganda rejimiga qayting.",
                                style = MaterialTheme.typography.bodyMedium, color = WarnColor,
                            )
                            OutlinedButton(enabled = !saving, onClick = { change({ app.repository.setTaxiMode("READY") }) { "«Tayyor» bosilganda rejimiga qaytdi." } }) { Text("«Tayyor» bosilganda rejimiga qaytiş") }
                        }
                        Text("Faqat YANGI boşlangan buyurtmalarga ta’sir qiladi.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                item { RatingsCard(s, ratings, saving) { on -> change({ app.repository.setRanking(on) }) { if (on) "Reyting böyiça tartiblaş yoqildi." else "Alifbo tartibiga qaytdi." } } }
            }
        }
    }

    pending?.let { p ->
        val (title, text, confirm) = when (p) {
            Pending.PAYMENTS_OPEN -> Triple("Real tölovni yoqasizmi?", "Mijozlar şu daqiqadan haqiqiy pul tölay boşlaydi.", "Ha, yoqaman")
            Pending.PAYMENTS_CLOSE -> Triple("Real tölovni yopasizmi?", "Yangi buyurtma olinmaydi. Allaqaçon berilgan buyurtmalar tölovi davom etadi.", "Ha, yopaman")
            Pending.CASH_ON -> Triple("Naqd tölovni yoqasizmi?", "Mijoz naqd tölaşni tanlay oladi.", "Ha, yoqaman")
            Pending.CASH_OFF -> Triple("Naqd tölovni öçirasizmi?", "Yangi naqd buyurtma olinmaydi. Berilgan naqd buyurtmalar davom etadi.", "Ha, öçiraman")
        }
        AlertDialog(
            onDismissRequest = { if (!saving) pending = null },
            title = { Text(title) },
            text = { Text(text) },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    pending = null
                    when (p) {
                        Pending.PAYMENTS_OPEN -> change({ app.repository.setPayments(true) }) { if (it.result == "CHANGED") "🟢 Real tölov oçildi." else "Holat özgarmadi." }
                        Pending.PAYMENTS_CLOSE -> change({ app.repository.setPayments(false) }) { if (it.result == "CHANGED") "🔴 Real tölov yopildi." else "Holat özgarmadi." }
                        Pending.CASH_ON -> change({ app.repository.setCash(true) }) { if (it.result == "CHANGED") "🟢 Naqd tölov yoqildi." else "Holat özgarmadi." }
                        Pending.CASH_OFF -> change({ app.repository.setCash(false) }) { if (it.result == "CHANGED") "🔴 Naqd tölov öçirildi." else "Holat özgarmadi." }
                    }
                }) { Text(confirm, color = if (p == Pending.PAYMENTS_OPEN) UrgentColor else MaterialTheme.colorScheme.primary) }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { pending = null }) { Text("Yöq") } },
        )
    }
}

@Composable
private fun PaymentsCard(s: SettingsDto, saving: Boolean, onToggle: () -> Unit) {
    val p = s.payments
    Card {
        Text("💳 Real tölov", style = MaterialTheme.typography.titleMedium)
        if (!p.gateActive) {
            Text("Bu test serveri: kalit faqat production serverda işlaydi.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Card
        }
        Text(
            if (p.open) "🟢 OÇIQ: mijozlar haqiqiy pul tölaşi mumkin." else "🔴 YOPIQ: yangi buyurtma olinmaydi.",
            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge, color = if (p.open) OkColor else UrgentColor,
        )
        if (!p.open && p.blockers.isNotEmpty()) {
            Text("Yoqib bölmaydi:", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            p.blockers.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
        } else {
            Button(
                onClick = onToggle, enabled = !saving,
                colors = if (p.open) ButtonDefaults.buttonColors(containerColor = UrgentColor) else ButtonDefaults.buttonColors(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (p.open) "⛔ Yopiş" else "▶️ Real tölovni yoqiş") }
            if (p.open) Text("Yopsangiz ham, allaqaçon berilgan buyurtmalar tölovi davom etadi.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FeeCard(s: SettingsDto, saving: Boolean, onSave: (mode: String, percent: Double?, lineSom: Int?, lineWaived: Boolean?) -> Unit) {
    val currentPick = if (s.fee.mode == "LINE") (if (s.fee.lineWaived) "FREE" else "LINE") else s.fee.mode
    var pick by remember(s.fee) { mutableStateOf(currentPick) }
    val isLine = pick == "FREE" || pick == "LINE"
    val currentLine = if (s.fee.lineSom > 0) s.fee.lineSom else 5000L
    var lineText by remember(s.fee) { mutableStateOf(currentLine.toString()) }
    val line = lineText.filter { it.isDigit() }.toLongOrNull()
    val lineOk = !isLine || (line != null && line in 1000L..50_000L)
    var percentText by remember(s.fee) { mutableStateOf(trimPercent(s.fee.percentBp / 100.0)) }
    val percent = percentText.replace(',', '.').toDoubleOrNull()
    val percentOk = pick != "PERCENT" || (percent != null && percent in 1.0..25.0 && Math.round(percent * 100) / 100.0 == percent)
    val unchanged = pick == currentPick && (pick != "PERCENT" || percent == s.fee.percentBp / 100.0) && (!isLine || line == currentLine)
    Card {
        Text("🧾 Xizmat haqi", style = MaterialTheme.typography.titleMedium)
        val modes = if (s.fee.mode == "FLAT") listOf("FLAT" to "Eski tekis: mijoz heç narsa körmaydi, restoran hisobiga 5 000 yoziladi") + FEE_MODES else FEE_MODES
        modes.forEach { (code, label) ->
            Row(Modifier.fillMaxWidth().clickable { pick = code }, verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = pick == code, onClick = { pick = code })
                Text(label + if (code == currentPick) "  ● hozir" else "", style = MaterialTheme.typography.bodyLarge)
            }
        }
        if (pick == "PERCENT") {
            OutlinedTextField(
                value = percentText, onValueChange = { if (it.length <= 5) percentText = it },
                label = { Text("Foiz (1–25)") }, singleLine = true, isError = !percentOk,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
            )
        }
        if (isLine) {
            OutlinedTextField(
                value = lineText, onValueChange = { if (it.length <= 6) lineText = it },
                label = { Text("Platforma xizmati, söm (1 000–50 000)") }, singleLine = true, isError = !lineOk,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
            )
        }
        Text(
            "Tekis — çegirma: taomlardan keyin «Platforma xizmati» ustidan çizilib «Çegirma» deb körsatiladi, heç kimdan haq olinmaydi. " +
                "Mijoz tölaydi: şu qator çizilmaydi, summa jamiga qöşiladi. " +
                "Foiz / poğonali: xizmat haqi taom narxlariga kiritilgan, mijoz yaxlit narx köradi. Rejim faqat YANGI buyurtmalarga ta’sir qiladi.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PrimaryButton("Saqlaş", enabled = !saving && percentOk && lineOk && !unchanged && pick != "FLAT") {
            onSave(
                if (isLine) "LINE" else pick,
                if (pick == "PERCENT") percent else null,
                if (isLine) line?.toInt() else null,
                if (isLine) pick == "FREE" else null,
            )
        }
    }
}

@Composable
private fun CashMaxCard(s: SettingsDto, saving: Boolean, onSave: (Long) -> Unit) {
    var text by remember(s.cash.maxOrderSom) { mutableStateOf(s.cash.maxOrderSom.toString()) }
    val som = text.filter { it.isDigit() }.toLongOrNull()
    val ok = som != null && som in 10_000L..100_000_000L
    Card {
        Text("💵 Naqd buyurtmaning eng katta summasi", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = text, onValueChange = { if (it.length <= 9) text = it },
            label = { Text("Söm (10 000 dan 100 000 000 gaça)") }, singleLine = true, isError = !ok,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "Bundan katta buyurtmani mijoz naqd tölay olmaydi (faqat karta). Faqat YANGI buyurtmalarga ta’sir qiladi. Hozir: ${somText(s.cash.maxOrderSom)}.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PrimaryButton("Saqlaş", enabled = !saving && ok && som != s.cash.maxOrderSom) { onSave(som!!) }
    }
}

private fun trimPercent(p: Double): String = if (p % 1.0 == 0.0) p.toInt().toString() else p.toString()

@Composable
private fun RatingsCard(s: SettingsDto, r: RatingsDto?, saving: Boolean, onRanking: (Boolean) -> Unit) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("⭐ Restoran baholari", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (s.ranking.enabled) "Röyxat tartibi: reyting böyiça (yaxşi baholilar tepada)." else "Röyxat tartibi: alifbo böyiça (baho tartibga ta’sir qilmaydi).",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = s.ranking.enabled, enabled = !saving, onCheckedChange = onRanking)
        }
        if (r == null) return@Card
        if (r.restaurants.isEmpty()) Text("Hali baho yöq.", style = MaterialTheme.typography.bodyMedium)
        r.restaurants.forEach {
            Text(
                "• ${it.name}: ${it.avg ?: "—"} (${it.count} ta) · 30 kun: ${it.last30.avg ?: "—"} (${it.last30.count} ta) · ball ${it.score}",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        if (r.lowRecent.isNotEmpty()) {
            Text("Sönggi past baholar", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = WarnColor)
            r.lowRecent.forEach { l ->
                val why = l.reasons.joinToString(", ") { r.reasonLabels[it] ?: it }
                Text(
                    "• ${l.restaurant} — ${"⭐".repeat(l.stars)}${if (why.isNotEmpty()) " — $why" else ""}${l.note?.let { " «$it»" } ?: ""}",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        Text("Mijozga baho 5 ta bahodan keyin körinadi.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
