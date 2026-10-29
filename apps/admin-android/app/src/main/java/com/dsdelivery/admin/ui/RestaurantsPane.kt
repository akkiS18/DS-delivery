package com.dsdelivery.admin.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.AdminRestaurantDto
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.CredentialResponse
import com.dsdelivery.admin.data.RemovalPlanDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Who is on the platform: add a restaurant, suspend or resume it, hand out a new password, link its Telegram staff account, set its photo,
 * delete or archive it. Everything that changes something asks first; the server audits it and tells the administrators on Telegram.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RestaurantsPane(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<AdminRestaurantDto>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    var target by remember { mutableStateOf<Pair<AdminRestaurantDto, Boolean>?>(null) }
    var newOpen by remember { mutableStateOf(false) }
    var secret by remember { mutableStateOf<CredentialResponse?>(null) }
    var resetFor by remember { mutableStateOf<AdminRestaurantDto?>(null) }
    var linkFor by remember { mutableStateOf<AdminRestaurantDto?>(null) }
    var removal by remember { mutableStateOf<Pair<AdminRestaurantDto, RemovalPlanDto>?>(null) }
    var photoFor by remember { mutableStateOf<AdminRestaurantDto?>(null) }

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

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val r = photoFor
        photoFor = null
        if (uri == null || r == null || saving) return@rememberLauncherForActivityResult
        saving = true
        scope.launch {
            val jpeg = withContext(Dispatchers.IO) { ImagePrep.prepare(context, uri) }
            if (jpeg == null) {
                onMessage("Rasmni o‘qib bo‘lmadi. Boshqa rasm tanlang.")
            } else {
                val res = unwrap(app.repository.setRestaurantImage(r.id, jpeg), onMessage)
                if (res != null) onMessage("🖼 ${r.name}: rasm saqlandi.")
            }
            saving = false
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (offline) item { Banner("Ulanish yo‘q — ro‘yxat eskirgan bo‘lishi mumkin", UrgentColor) }
            item { PrimaryButton("➕ Yangi restoran", enabled = !saving) { newOpen = true } }
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
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(enabled = !saving, onClick = { resetFor = r }) { Text("🔑 Yangi parol") }
                            OutlinedButton(enabled = !saving, onClick = { linkFor = r }) { Text("🔗 Telegram") }
                            OutlinedButton(enabled = !saving, onClick = { photoFor = r; picker.launch("image/*") }) { Text("🖼 Rasm") }
                            OutlinedButton(enabled = !saving, onClick = {
                                saving = true
                                scope.launch {
                                    val res = unwrap(app.repository.removalPlan(r.id), onMessage)
                                    saving = false
                                    if (res != null) removal = r to res.plan
                                }
                            }) { Text("🗑 O‘chirish", color = UrgentColor) }
                        }
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

    if (newOpen) {
        NewRestaurantDialog(
            busy = saving, onDismiss = { newOpen = false },
            onCreate = { name, address, phone ->
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.createRestaurant(name, address, phone), onMessage)
                    saving = false
                    if (res != null) { newOpen = false; secret = res }
                    load()
                }
            },
        )
    }

    secret?.let { SecretDialog(it, onDone = { secret = null }) }

    resetFor?.let { r ->
        ResetPasswordDialog(
            name = r.name, busy = saving, onDismiss = { resetFor = null },
            onConfirm = {
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.resetPassword(r.id), onMessage)
                    saving = false
                    resetFor = null
                    if (res != null) secret = res
                    load()
                }
            },
        )
    }

    linkFor?.let { r ->
        LinkStaffDialog(
            name = r.name, busy = saving, onDismiss = { linkFor = null },
            onLink = { tg ->
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.linkStaff(r.id, tg), onMessage)
                    saving = false
                    if (res != null) { linkFor = null; onMessage("🔗 ${r.name}: Telegram xodimi ulandi.") }
                    load()
                }
            },
        )
    }

    removal?.let { (r, plan) ->
        RemovalDialog(
            name = r.name, plan = plan, busy = saving, onDismiss = { removal = null },
            onConfirm = { expected ->
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.removeRestaurant(r.id, expected), onMessage)
                    saving = false
                    removal = null
                    if (res != null) onMessage(if (res.result == "DELETED") "🗑 ${r.name} o‘chirildi." else "🗄 ${r.name} arxivlandi.")
                    load()
                }
            },
        )
    }
}
