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
import com.dsdelivery.admin.core.Biometric
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
    val bioAvailable = remember { Biometric.available(context) }
    var bioOn by remember { mutableStateOf(app.session.biometricEnabled) }
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
        Section("Navbatçilik") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(if (duty) "Yoqilgan" else "Öçirilgan", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (duty) "Ilova fonda işlaydi va muammo bölsa signal beradi (ekran öçiq bölsa ham)."
                        else "Ilova yopiq bölsa heç qanday signal çalinmaydi. Oçiq paytda röyxat körinadi.",
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
                    Text(if (quietOn) "${quiet!!.from} – ${quiet.to}" else "Öçirilgan", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Bu vaqtda faqat şoşilinç holatlar (mijoz tölagan, heç kim javob bermayapti) signal beradi. Qolganlari röyxatda körinadi, lekin jim.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = quietOn, enabled = !quietBusy, onCheckedChange = { on -> saveQuiet(off = !on) })
            }
            if (quietOn) {
                HourStepper("Boşlanişi", fromH) { fromH = it }
                HourStepper("Tugaşi", toH) { toH = it }
                if (state.quietActive) Text("Hozir jim soat davom etyapti.", style = MaterialTheme.typography.bodyMedium, color = NeutralColor)
                Button(onClick = { saveQuiet(off = false) }, enabled = changed && fromH != toH && !quietBusy) { Text("Saqlaş") }
            }
        }

        Section("Signal") {
            Text("Signal telefonning „Budilnik“ ovozida çalinadi. Jim rejim uni öçirmaydi.", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { app.alarm.beepOnce() }) { Text("Ovozni sinaş") }
                OutlinedButton(onClick = { app.alarm.setVolumeFraction(1f); onReadinessChanged() }) { Text("Maksimal ovoz") }
            }
        }

        Section("Tayyorlik") {
            Check("Bildirişnomalar", readiness.notifications, "Yoqiş") {
                open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
            }
            Check("Signal ovozi yetarli", readiness.volume, "Maksimal qiliş") { app.alarm.setVolumeFraction(1f); onReadinessChanged() }
            Check("Batareya tejaş öçirilgan (ilova uxlab qolmasin)", readiness.battery, "Ruxsat beriş") {
                open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
            }
            Check("Qulflangan ekranda töliq oçiliş", readiness.fullScreen, "Ruxsat beriş") {
                if (Build.VERSION.SDK_INT >= 34) open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}")))
            }
            Text(
                "Maslahat: telefonni zaryadkada va internetga ulangan holda qoldiring. Ba’zi telefonlarda (Xiaomi, Huawei, Samsung) " +
                    "Sozlamalar → Ilovalar → DS Admin bölimida „Avtoyuklaş“ni yoqing va „Batareya: çeklovsiz“ni tanlang.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("Ilova sozlamalarini oçiş") }
        }

        if (bioAvailable || bioOn) Section("Qulf") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Barmoq izi bilan oçiş", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (bioAvailable) "Ilova qulflangan paytda avval barmoq izi (yoki yüz) söraladi, tanilmasa PIN. PIN baribir saqlanadi."
                        else "Bu telefonda barmoq izi röyxatdan ötmagan: hozirça faqat PIN söraladi.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = bioOn, enabled = bioAvailable || bioOn, onCheckedChange = { on ->
                    if (!on) { app.session.setBiometricEnabled(false); bioOn = false }
                    else Biometric.prompt(context, "Barmoq izini tasdiqlang", "Şu telefonda röyxatdan ötgan barmoq izi", "Bekor qiliş") { ok ->
                        if (ok) { app.session.setBiometricEnabled(true); bioOn = true } else onMessage("Tasdiqlanmadi, barmoq izi yoqilmadi.")
                    }
                })
            }
        }

        Section("Hisob") {
            Text("Telegram ID: ${account?.telegramUserId ?: ""}", style = MaterialTheme.typography.bodyLarge)
            OutlinedButton(onClick = { confirmLogout = true }) { Text("Çiqiş") }
            OutlinedButton(onClick = { confirmLogoutAll = true }) { Text("Barça qurilmalarni yopiş") }
            Text(
                "Telefon yöqolsa yoki öğirlansa: „Barça qurilmalarni yopiş“ni bosing (yoki botda /logoutall yozing).",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Text("DS Admin ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Çiqasizmi?") },
            text = { Text("Çiqsangiz bu telefon signal bermaydi. Qayta kiriş uçun Telegram kodi kerak böladi.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch {
                        app.repository.logout()
                        app.watcher.signOutLocally()
                    }
                }) { Text("Ha, çiqaman") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Yöq") } },
        )
    }

    if (confirmLogoutAll) {
        AlertDialog(
            onDismissRequest = { confirmLogoutAll = false },
            title = { Text("Barça qurilmalarni yopasizmi?") },
            text = { Text("Bu telefon ham, boşqa telefonlar ham çiqib ketadi. Har birida Telegram kodi bilan qayta kiriş kerak böladi.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogoutAll = false
                    scope.launch {
                        // The server closes every session, this one included; only then is this phone signed out locally.
                        when (app.repository.logoutAll()) {
                            is com.dsdelivery.admin.data.ApiResult.Ok -> app.watcher.signOutLocally()
                            is com.dsdelivery.admin.data.ApiResult.Unauthorized -> app.watcher.signOutLocally()
                            is com.dsdelivery.admin.data.ApiResult.Offline -> onMessage("Internet yöq. Qayta urinib köring.")
                            else -> onMessage("Bajarilmadi. Qayta urinib köring.")
                        }
                    }
                }) { Text("Ha, hammasini yopaman") }
            },
            dismissButton = { TextButton(onClick = { confirmLogoutAll = false }) { Text("Yöq") } },
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
