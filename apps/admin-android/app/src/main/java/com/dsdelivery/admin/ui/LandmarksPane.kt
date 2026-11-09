package com.dsdelivery.admin.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.LandmarkDto
import com.dsdelivery.admin.data.LandmarksResponse
import com.dsdelivery.admin.data.PatchLandmarkRequest
import kotlinx.coroutines.launch

private val KIND_LABEL = mapOf(
    "MARKET" to "Bozor", "MOSQUE" to "Masjid", "SCHOOL" to "Maktab", "KINDERGARTEN" to "Bog‘cha", "PHARMACY" to "Dorixona",
    "HOSPITAL" to "Shifoxona", "BANK" to "Bank", "SHOP" to "Do‘kon", "CAFE" to "Kafe / choyxona", "GAS_STATION" to "Yoqilg‘i quyish",
    "BUS_STOP" to "Bekat", "OFFICE" to "Idora", "OTHER" to "Boshqa",
)
internal fun kindLabel(kind: String): String = KIND_LABEL[kind] ?: kind

/**
 * "Joylar": the named places (market, mosque, school...) that customers see on the address map and that taxi drivers read under the delivery address.
 * The administrator adds one standing at the spot (phone position) or by pasting coordinates copied from a map. The server audits every change
 * and refuses a point outside the map area (the usual cause is latitude and longitude swapped).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LandmarksPane(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<LandmarksResponse?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<LandmarkDto?>(null) }
    var deleting by remember { mutableStateOf<LandmarkDto?>(null) }
    var filter by remember { mutableStateOf("") }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.landmarks()) {
            is ApiResult.Ok -> { data = r.data; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(Unit) { load() }

    /** One server change: tells the administrator the result (or why not) and reloads the list. */
    fun run(done: String?, block: suspend () -> ApiResult<*>) {
        if (saving) return
        saving = true
        scope.launch {
            val r = block()
            if (r is ApiResult.Ok<*>) {
                if (done != null) onMessage(done)
            } else {
                unwrap(r, onMessage)
            }
            saving = false
            load()
        }
    }

    fun showOnMap(l: LandmarkDto) {
        val uri = Uri.parse("geo:${l.lat},${l.lng}?q=${l.lat},${l.lng}(${Uri.encode(l.name)})")
        try { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (e: ActivityNotFoundException) { onMessage("Xarita ilovasi topilmadi.") }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (offline) item { Banner("Ulanish yo‘q — ro‘yxat eskirgan bo‘lishi mumkin", UrgentColor) }
            val d = data
            if (d == null) {
                item { Text(if (offline) "Yuklab bo‘lmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                item { Text("Joylar (${d.landmarks.size})", style = MaterialTheme.typography.titleLarge) }
                item {
                    Text(
                        "Mijoz xaritada shu joylarni ko‘radi va ular orqali mo‘ljal oladi; taksi haydovchisi yetkazish manzili tagida eng yaqin joyni o‘qiydi. " +
                            "Joyning o‘zida turib «Hozirgi joyim»ni bosing yoki xaritadan nusxalangan koordinatani qo‘ying.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                item { PrimaryButton("➕ Yangi joy", enabled = !saving) { adding = true } }
                if (d.landmarks.size > 6) {
                    item {
                        OutlinedTextField(
                            value = filter, onValueChange = { filter = it.take(60) }, label = { Text("Qidirish") },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                val shown = d.landmarks.filter { filter.isBlank() || it.name.contains(filter.trim(), ignoreCase = true) }
                if (shown.isEmpty()) item { Text(if (d.landmarks.isEmpty()) "Hali joy qo‘shilmagan." else "Topilmadi.") }
                items(shown.size) { i ->
                    val l = shown[i]
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(l.name, style = MaterialTheme.typography.titleMedium)
                                Text(kindLabel(l.kind), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Switch(checked = l.isActive, enabled = !saving, onCheckedChange = { on -> run(null) { app.repository.setLandmarkActive(l.id, on) } })
                        }
                        Text(
                            if (l.isActive) "🟢 Mijozlarga ko‘rinadi" else "⚪ O‘chiq (mijozga ko‘rinmaydi)",
                            style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                            color = if (l.isActive) OkColor else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(CoordText.format(GeoPoint(l.lat, l.lng)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(enabled = !saving, onClick = { editing = l }) { Text("✏️ Tahrirlash") }
                            OutlinedButton(onClick = { showOnMap(l) }) { Text("🗺 Xaritada") }
                            OutlinedButton(enabled = !saving, onClick = { deleting = l }) { Text("🗑 O‘chirish", color = UrgentColor) }
                        }
                    }
                }
            }
        }
    }

    if (adding) {
        LandmarkDialog(
            initial = null, kinds = data?.kinds.orEmpty(), busy = saving, onDismiss = { adding = false },
            onSave = { name, kind, p ->
                adding = false
                run("✅ «$name» qo‘shildi.") { app.repository.createLandmark(name, kind, p.lat, p.lng) }
            },
        )
    }

    editing?.let { l ->
        LandmarkDialog(
            initial = l, kinds = data?.kinds.orEmpty(), busy = saving, onDismiss = { editing = null },
            onSave = { name, kind, p ->
                editing = null
                run("✅ «$name» saqlandi.") { app.repository.updateLandmark(l.id, PatchLandmarkRequest(name = name, kind = kind, lat = p.lat, lng = p.lng)) }
            },
        )
    }

    deleting?.let { l ->
        AlertDialog(
            onDismissRequest = { if (!saving) deleting = null },
            title = { Text("«${l.name}» o‘chirilsinmi?") },
            text = { Text("Joy xaritadan va taksi matnidan yo‘qoladi. Berilgan buyurtmalarga ta’sir qilmaydi. Vaqtincha yashirish uchun o‘chirmasdan, tugmani o‘chiring.") },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    deleting = null
                    run("🗑 «${l.name}» o‘chirildi.") { app.repository.deleteLandmark(l.id) }
                }) { Text("Ha, o‘chirish", color = UrgentColor) }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { deleting = null }) { Text("Yo‘q") } },
        )
    }
}

/** Add or edit one place: name, kind, and the point (phone position or pasted coordinates). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LandmarkDialog(
    initial: LandmarkDto?, kinds: List<String>, busy: Boolean, onDismiss: () -> Unit,
    onSave: (name: String, kind: String, point: GeoPoint) -> Unit,
) {
    val context = LocalContext.current
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var kind by remember { mutableStateOf(initial?.kind) }
    var coords by remember { mutableStateOf(initial?.let { CoordText.format(GeoPoint(it.lat, it.lng)) } ?: "") }
    var gpsNote by remember { mutableStateOf("") }
    var finding by remember { mutableStateOf(false) }
    val point = CoordText.parse(coords)
    val ready = name.trim().length >= 2 && kind != null && point != null

    fun findHere() {
        finding = true
        gpsNote = ""
        LocationFinder.current(context) { fix, problem ->
            finding = false
            if (fix != null) {
                coords = CoordText.format(GeoPoint(fix.lat, fix.lng))
                gpsNote = if (fix.accuracyM > 40f) "⚠️ Aniqlik past (±${if (fix.accuracyM < 10_000f) fix.accuracyM.toInt() else 0} m). Ochiq joyda qayta bosing."
                else "📍 Joylashuv olindi (±${fix.accuracyM.toInt()} m)."
            } else {
                gpsNote = when (problem) {
                    FixProblem.NO_PERMISSION -> "Joylashuvga ruxsat berilmadi."
                    FixProblem.NO_PROVIDER -> "Telefonda joylashuv (GPS) o‘chiq. Uni yoqing."
                    else -> "Joylashuv aniqlanmadi. Ochiq joyda qayta urining."
                }
            }
        }
    }
    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) findHere() else gpsNote = "Joylashuvga ruxsat berilmadi."
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (initial == null) "Yangi joy" else "Joyni tahrirlash") },
        text = {
            Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name, onValueChange = { if (it.length <= 60) name = it }, label = { Text("Nomi (masalan: Markaziy bozor)") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Text("Turi", fontWeight = FontWeight.SemiBold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    kinds.forEach { k ->
                        if (kind == k) Button(onClick = { kind = k }) { Text(kindLabel(k)) }
                        else OutlinedButton(onClick = { kind = k }) { Text(kindLabel(k)) }
                    }
                }
                Text("Joylashuvi", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
                Button(
                    enabled = !busy && !finding,
                    onClick = { if (LocationFinder.hasPermission(context)) findHere() else askPermission.launch(LocationFinder.permissions) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (finding) "Aniqlanmoqda…" else "📍 Hozirgi joyim (shu yerda turibman)") }
                if (gpsNote.isNotEmpty()) Text(gpsNote, style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = coords, onValueChange = { if (it.length <= 200) coords = it }, label = { Text("Koordinata: 40.0304, 65.6672") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (coords.isNotBlank()) {
                    Text(
                        if (point != null) "✅ ${CoordText.format(point)}" else "❌ Koordinata o‘qilmadi (kenglik va uzunlik: 40.0304, 65.6672)",
                        style = MaterialTheme.typography.bodyMedium, color = if (point != null) OkColor else UrgentColor,
                    )
                }
                Text(
                    "Google yoki Yandex xaritada joyni bosib turing va chiqqan koordinatani nusxalab shu yerga qo‘ying. Avval kenglik (40 atrofida), keyin uzunlik (65 atrofida).",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ready, onClick = { onSave(name.trim(), kind!!, point!!) }) { Text("Saqlash") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qilish") } },
    )
}
