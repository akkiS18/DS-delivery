package com.dsdelivery.admin.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.dsdelivery.admin.BuildConfig
import com.dsdelivery.admin.service.WatchService
import kotlinx.coroutines.launch

@Composable
fun SettingsTab(readiness: Readiness, duty: Boolean, onReadinessChanged: () -> Unit, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    val state by app.watcher.state.collectAsState()
    val account by app.session.account.collectAsState()
    var confirmLogout by remember { mutableStateOf(false) }
    var confirmLogoutAll by remember { mutableStateOf(false) }

    fun open(intent: Intent) {
        runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    }

    // ---- quiet hours (whole hours; the server keeps "HH:MM") ----
    val quiet = state.quiet
    var fromH by remember(quiet) { mutableIntStateOf(quiet?.let { hourOf(it.from) } ?: 1) }
    var toH by remember(quiet) { mutableIntStateOf(quiet?.let { hourOf(it.to) } ?: 7) }
    var quietBusy by remember { mutableStateOf(false) }
    val quietOn = quiet != null
    val changed = quiet == null || hhmm(fromH) != quiet.from || hhmm(toH) != quiet.to

    fun saveQuiet(off: Boolean) {
        if (quietBusy) return
        quietBusy = true
        scope.launch {
            app.watcher.setQuiet(off, hhmm(fromH), hhmm(toH))?.let(onMessage)
            quietBusy = false
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Section("Navbatchilik") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(if (duty) "Yoqilgan" else "O‘chirilgan", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (duty) "Ilova fonda ishlaydi va muammo bo‘lsa signal beradi (ekran o‘chiq bo‘lsa ham)."
                        else "Ilova yopiq bo‘lsa hech qanday signal chalinmaydi. Ochiq paytda ro‘yxat ko‘rinadi.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = duty, onCheckedChange = { on ->
                    app.session.setDuty(on)
                    if (on) { WatchService.start(context); app.watcher.start() } else WatchService.stop(context)
                    app.watcher.dutyChanged()
                })
            }
        }

        Section("Jim soatlar") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(if (quietOn) "${quiet!!.from} – ${quiet.to}" else "O‘chirilgan", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Bu vaqtda faqat shoshilinch holatlar (mijoz to‘lagan, hech kim javob bermayapti) signal beradi. Qolganlari ro‘yxatda ko‘rinadi, lekin jim.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = quietOn, enabled = !quietBusy, onCheckedChange = { on -> saveQuiet(off = !on) })
            }
            if (quietOn) {
                HourStepper("Boshlanishi", fromH) { fromH = it }
                HourStepper("Tugashi", toH) { toH = it }
                if (state.quietActive) Text("Hozir jim soat davom etyapti.", style = MaterialTheme.typography.bodyMedium, color = NeutralColor)
                Button(onClick = { saveQuiet(off = false) }, enabled = changed && fromH != toH && !quietBusy) { Text("Saqlash") }
            }
        }

        Section("Signal") {
            Text("Signal telefonning „Budilnik“ ovozida chalinadi. Jim rejim uni o‘chirmaydi.", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { app.alarm.beepOnce() }) { Text("Ovozni sinash") }
                OutlinedButton(onClick = { app.alarm.setVolumeFraction(1f); onReadinessChanged() }) { Text("Maksimal ovoz") }
            }
        }

        Section("Tayyorlik") {
            Check("Bildirishnomalar", readiness.notifications, "Yoqish") {
                open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
            }
            Check("Signal ovozi yetarli", readiness.volume, "Maksimal qilish") { app.alarm.setVolumeFraction(1f); onReadinessChanged() }
            Check("Batareya tejash o‘chirilgan (ilova uxlab qolmasin)", readiness.battery, "Ruxsat berish") {
                open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
            }
            Check("Qulflangan ekranda to‘liq ochilish", readiness.fullScreen, "Ruxsat berish") {
                if (Build.VERSION.SDK_INT >= 34) open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}")))
            }
            Text(
                "Maslahat: telefonni zaryadkada va internetga ulangan holda qoldiring. Ba’zi telefonlarda (Xiaomi, Huawei, Samsung) " +
                    "Sozlamalar → Ilovalar → DS Admin bo‘limida „Avtoyuklash“ni yoqing va „Batareya: cheklovsiz“ni tanlang.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("Ilova sozlamalarini ochish") }
        }

        Section("Hisob") {
            Text("Telegram ID: ${account?.telegramUserId ?: ""}", style = MaterialTheme.typography.bodyLarge)
            OutlinedButton(onClick = { confirmLogout = true }) { Text("Chiqish") }
            OutlinedButton(onClick = { confirmLogoutAll = true }) { Text("Barcha qurilmalarni yopish") }
            Text(
                "Telefon yo‘qolsa yoki o‘g‘irlansa: „Barcha qurilmalarni yopish“ni bosing (yoki botda /logoutall yozing).",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Text("DS Admin ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Chiqasizmi?") },
            text = { Text("Chiqsangiz bu telefon signal bermaydi. Qayta kirish uchun Telegram kodi kerak bo‘ladi.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch {
                        app.repository.logout()
                        app.watcher.signOutLocally()
                    }
                }) { Text("Ha, chiqaman") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Yo‘q") } },
        )
    }

    if (confirmLogoutAll) {
        AlertDialog(
            onDismissRequest = { confirmLogoutAll = false },
            title = { Text("Barcha qurilmalarni yopasizmi?") },
            text = { Text("Bu telefon ham, boshqa telefonlar ham chiqib ketadi. Har birida Telegram kodi bilan qayta kirish kerak bo‘ladi.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogoutAll = false
                    scope.launch {
                        // The server closes every session, this one included; only then is this phone signed out locally.
                        when (app.repository.logoutAll()) {
                            is com.dsdelivery.admin.data.ApiResult.Ok -> app.watcher.signOutLocally()
                            is com.dsdelivery.admin.data.ApiResult.Unauthorized -> app.watcher.signOutLocally()
                            is com.dsdelivery.admin.data.ApiResult.Offline -> onMessage("Internet yo‘q. Qayta urinib ko‘ring.")
                            else -> onMessage("Bajarilmadi. Qayta urinib ko‘ring.")
                        }
                    }
                }) { Text("Ha, hammasini yopaman") }
            },
            dismissButton = { TextButton(onClick = { confirmLogoutAll = false }) { Text("Yo‘q") } },
        )
    }
}

@Composable
private fun HourStepper(label: String, hour: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        OutlinedButton(onClick = { onChange((hour + 23) % 24) }) { Text("−") }
        Text(hhmm(hour), Modifier.padding(horizontal = 14.dp), style = MaterialTheme.typography.titleMedium)
        OutlinedButton(onClick = { onChange((hour + 1) % 24) }) { Text("+") }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface, RoundedCornerShape(16.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        content()
    }
}

@Composable
private fun Check(label: String, ok: Boolean, fixLabel: String, onFix: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (ok) "✅" else "⚠️", modifier = Modifier.padding(end = 10.dp))
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (!ok) TextButton(onClick = onFix) { Text(fixLabel) }
    }
}
