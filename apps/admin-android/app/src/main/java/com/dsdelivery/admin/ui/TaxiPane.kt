package com.dsdelivery.admin.ui

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
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.CompanyRowDto
import com.dsdelivery.admin.data.CredentialResponse
import com.dsdelivery.admin.data.ProblemDetailDto
import com.dsdelivery.admin.data.ProblemRowDto
import com.dsdelivery.admin.data.RemovalPlanDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val NOTE_MIN = 10
private const val NOTE_MAX = 300

private val STATUS_LABEL = mapOf(
    "SCHEDULED" to "rejalaştirilgan", "REQUESTED" to "javob kutilmoqda", "ACCEPTED" to "qabul qilingan", "ASSIGNED" to "haydovçi yuborilgan",
    "DELIVERED" to "yetkazilgan", "DECLINED" to "rad etilgan", "NEEDS_HELP" to "yordam kerak", "CANCELLATION_PENDING" to "javob keçikdi",
    "CANCELLED" to "bekor qilingan (tarix)",
)
private fun label(status: String): String = STATUS_LABEL[status] ?: status

/** Taxi: stuck dispatches (the bot's /taxiadmin) and the taxi companies (/newtaxi, /taxiapp, /deletetaxi). */
@Composable
fun TaxiPane(onMessage: (String) -> Unit) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val id = openId
    BackHandler(enabled = id != null) { openId = null }
    if (id == null) TaxiHome(onOpen = { openId = it }, onMessage = onMessage)
    else ProblemScreen(id = id, onBack = { openId = null }, onMessage = onMessage)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaxiHome(onOpen: (String) -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var problems by remember { mutableStateOf<List<ProblemRowDto>?>(null) }
    var companies by remember { mutableStateOf<List<CompanyRowDto>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var newOpen by remember { mutableStateOf(false) }
    var secret by remember { mutableStateOf<CredentialResponse?>(null) }
    var resetFor by remember { mutableStateOf<CompanyRowDto?>(null) }
    var removal by remember { mutableStateOf<Pair<CompanyRowDto, RemovalPlanDto>?>(null) }

    suspend fun load() {
        if (loading) return
        loading = true
        val p = app.repository.taxiProblems()
        val c = app.repository.taxiCompanies()
        if (p is ApiResult.Unauthorized || c is ApiResult.Unauthorized) app.watcher.signOutLocally()
        if (p is ApiResult.Ok) { problems = p.data.problems; offline = false } else offline = true
        if (c is ApiResult.Ok) companies = c.data.companies
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
            if (offline) item { Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin", UrgentColor) }
            item { Text("🛠 Taksi muammolari", style = MaterialTheme.typography.titleMedium) }
            val ps = problems
            if (ps == null) item { Text(if (offline) "Yuklab bölmadi. Pastga torting." else "Yuklanmoqda…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else {
                if (ps.isEmpty()) item { Text("✅ Hal qilinişi kerak bölgan taksi buyurtmasi yöq.", style = MaterialTheme.typography.bodyLarge, color = OkColor) }
                items(ps.size) { i ->
                    val p = ps[i]
                    Card(Modifier.clickable { onOpen(p.id) }) {
                        Text("#${p.orderCode} • ${p.restaurantName}", style = MaterialTheme.typography.titleMedium)
                        Text("${p.companyName} — ${label(p.status)} (uriniş #${p.attemptNo})", style = MaterialTheme.typography.bodyMedium, color = WarnColor, fontWeight = FontWeight.SemiBold)
                        Text(stampOf(p.updatedAt), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item { Text("🚕 Taksi kompaniyalari", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
            item { PrimaryButton("➕ Yangi kompaniya", enabled = !saving) { newOpen = true } }
            val cs = companies
            if (cs != null) {
                if (cs.isEmpty()) item { Text("Kompaniyalar yöq.") }
                items(cs.size) { i ->
                    val c = cs[i]
                    Card {
                        Text(c.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            when {
                                !c.isActive -> "⛔ öçirilgan"
                                c.reachable -> "✅ buyurtma olişi mumkin"
                                else -> "⚠️ ilova logini yöq — buyurtma olmaydi"
                            },
                            style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                            color = if (c.isActive && c.reachable) OkColor else WarnColor,
                        )
                        if (c.login != null) Text("Login: ${c.login}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(enabled = !saving, onClick = { resetFor = c }) { Text("🔑 Yangi parol") }
                            OutlinedButton(enabled = !saving, onClick = {
                                saving = true
                                scope.launch {
                                    val res = unwrap(app.repository.taxiRemovalPlan(c.id), onMessage)
                                    saving = false
                                    if (res != null) removal = c to res.plan
                                }
                            }) { Text("🗑 Öçiriş", color = UrgentColor) }
                        }
                    }
                }
            }
        }
    }

    if (newOpen) NewCompanyDialog(
        busy = saving, onDismiss = { newOpen = false },
        onCreate = { name ->
            saving = true
            scope.launch {
                val res = unwrap(app.repository.createTaxiCompany(name), onMessage)
                saving = false
                if (res != null) { newOpen = false; secret = CredentialResponse(true, res.login, res.name, res.password) }
                load()
            }
        },
    )

    secret?.let { SecretDialog(it, onDone = { secret = null }) }

    resetFor?.let { c ->
        ResetPasswordDialog(
            name = c.name, busy = saving, onDismiss = { resetFor = null }, owner = "kompaniyaning",
            onConfirm = {
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.resetTaxiPassword(c.id), onMessage)
                    saving = false
                    resetFor = null
                    if (res != null) secret = CredentialResponse(true, res.login, res.name, res.password)
                    load()
                }
            },
        )
    }

    removal?.let { (c, plan) ->
        RemovalDialog(
            name = c.name, plan = plan, busy = saving, taxi = true, onDismiss = { removal = null },
            onConfirm = { expected ->
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.removeTaxiCompany(c.id, expected), onMessage)
                    saving = false
                    removal = null
                    if (res != null) onMessage(if (res.result == "DELETED") "🗑 ${c.name} öçirildi." else "🗄 ${c.name} arxivlandi.")
                    load()
                }
            },
        )
    }
}

@Composable
private fun NewCompanyDialog(busy: Boolean, onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Yangi taksi kompaniyasi") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { if (it.length <= 80) name = it }, label = { Text("Kompaniya nomi") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(
                    "DS Taxi ilovasiga kiriş uçun login va parol beriladi. Parol keyingi oynada BIR MARTA körsatiladi.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && name.trim().length >= 2, onClick = { onCreate(name) }) { Text("Qöşiş") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

/** The administrator's written confirmation. Retry/reassign are only safe when no driver was sent, so the sentence says what is being attested. */
@Composable
internal fun NoteDialog(title: String, hint: String, busy: Boolean, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(hint, style = MaterialTheme.typography.bodyLarge)
                OutlinedTextField(
                    value = note, onValueChange = { if (it.length <= NOTE_MAX) note = it }, label = { Text("Izoh (kamida $NOTE_MIN belgi)") },
                    supportingText = { Text("${note.trim().length}/$NOTE_MAX") }, minLines = 2, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && note.trim().length in NOTE_MIN..NOTE_MAX, onClick = { onSubmit(note) }) { Text("Tasdiqlayman") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

private data class RecoverAction(val action: String, val companyId: String? = null, val companyName: String? = null)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProblemScreen(id: String, onBack: () -> Unit, onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<ProblemDetailDto?>(null) }
    var offline by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<RecoverAction?>(null) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.taxiProblem(id)) {
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

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Orqaga") }
        }
        if (offline) Banner("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin", UrgentColor)
        val d = detail
        if (d == null) {
            Text(if (offline) "Yuklab bölmadi." else "Yuklanmoqda…", modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Card {
                        Text("🚕 #${d.orderCode} • ${d.restaurantName}", style = MaterialTheme.typography.titleMedium)
                        Text("Manzil: ${d.addressText}", style = MaterialTheme.typography.bodyMedium)
                        Text("Buyurtma: ${d.orderStatus}", style = MaterialTheme.typography.bodyMedium)
                        Text("Joriy uriniş #${d.attemptNo}: ${d.companyName} — ${label(d.status)}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                        Text("Tarix:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        d.history.forEach { Text("  ${it.attemptNo}. ${it.companyName} — ${label(it.status)}", style = MaterialTheme.typography.bodyMedium) }
                    }
                }
                item {
                    if (d.open) {
                        Card {
                            Text(
                                "⚠️ Qayta yuborişdan oldin haydovçi YUBORILMAGANINI operator bilan telefon orqali aniqlang. Yuborilgan bölsa — «Haydovçi allaqaçon yuborilgan»ni bosing: yangi buyurtma yaratilmaydi.",
                                style = MaterialTheme.typography.bodyMedium, color = WarnColor,
                            )
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(enabled = !busy, onClick = { pending = RecoverAction("RETRY_SAME") }) { Text("🔁 Şu kompaniyaga qayta yuboriş") }
                                OutlinedButton(enabled = !busy, onClick = { picking = true }) { Text("🔀 Boşqa kompaniyaga ötkaziş") }
                                OutlinedButton(enabled = !busy, onClick = { pending = RecoverAction("DRIVER_SENT") }) { Text("🚕 Haydovçi allaqaçon yuborilgan") }
                            }
                        }
                    } else {
                        Text("Holat özgargan — qölda amal kerak emas.", style = MaterialTheme.typography.bodyLarge, color = OkColor)
                    }
                }
            }
        }
    }

    if (picking) {
        val d = detail
        AlertDialog(
            onDismissRequest = { picking = false },
            title = { Text("Qaysi kompaniyaga ötkazamiz?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (d == null || d.companies.isEmpty()) Text("Mos faol kompaniya yöq.")
                    d?.companies?.forEach { c ->
                        OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = { picking = false; pending = RecoverAction("REASSIGN", c.id, c.name) }) { Text(c.name) }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Ortga") } },
        )
    }

    pending?.let { p ->
        val driverSent = p.action == "DRIVER_SENT"
        NoteDialog(
            title = when (p.action) { "RETRY_SAME" -> "Qayta yuboriş"; "REASSIGN" -> "${p.companyName} ga ötkaziş"; else -> "Haydovçi yuborilgan" },
            hint = if (driverSent) "Haydovçi qaysi kompaniya/operator orqali yuborilganini yozing."
            else "Operator bilan gaplaşib, bu uriniş uçun haydovçi YUBORILMAGANINI yozma tasdiqlang.",
            busy = busy, onDismiss = { pending = null },
            onSubmit = { note ->
                busy = true
                scope.launch {
                    val res = unwrap(app.repository.taxiRecover(id, p.action, note, p.companyId), onMessage)
                    busy = false
                    pending = null
                    if (res != null) {
                        onMessage(
                            if (res.action == "DRIVER_SENT") "✅ Haydovçi yuborilgani qayd etildi."
                            else "✅ Yangi sörov ${res.companyName ?: ""} operatoriga navbatga qöyildi (bir neça soniyada yuboriladi).",
                        )
                    }
                    load() // a refusal (CHANGED) also means the situation moved on: show the current state
                }
            },
        )
    }
}
