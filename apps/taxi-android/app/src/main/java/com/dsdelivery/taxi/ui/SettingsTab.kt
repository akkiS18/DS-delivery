package com.dsdelivery.taxi.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import com.dsdelivery.taxi.BuildConfig
import com.dsdelivery.taxi.TaxiApp
import com.dsdelivery.taxi.service.DispatchService
import kotlinx.coroutines.launch

@Composable
fun SettingsTab(readiness: Readiness, duty: Boolean, onReadinessChanged: () -> Unit, onSignedOut: () -> Unit) {
    val context = LocalContext.current
    val app = TaxiApp.instance
    val scope = rememberCoroutineScope()
    var confirmLogout by remember { mutableStateOf(false) }

    fun open(intent: Intent) {
        runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Section("Navbatchilik") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(if (duty) "Yoqilgan" else "O‘chirilgan", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (duty) "Ilova fonda ishlaydi, yangi so‘rovda gudok chaladi (ekran o‘chiq bo‘lsa ham)."
                        else "Ilova yopiq bo‘lsa so‘rovlar kelmaydi va signal chalinmaydi.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = duty, onCheckedChange = { on ->
                    app.session.setDuty(on)
                    if (on) { DispatchService.start(context); app.dispatcher.start() } else DispatchService.stop(context)
                    app.dispatcher.dutyChanged()
                })
            }
        }

        Section("Signal") {
            Text("Gudok ovozi telefonning „Budilnik“ ovozida chalinadi. Jim rejim uni o‘chirmaydi.", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { app.alarm.beepOnce() }) { Text("Ovozni sinash") }
                OutlinedButton(onClick = { app.alarm.setVolumeFraction(1f); onReadinessChanged() }) { Text("Ovozni maksimal qilish") }
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
                "Maslahat: telefonni zaryadkada, Wi‑Fi yoki mobil internetga ulangan holda qoldiring. Ba’zi telefonlarda (Xiaomi, Huawei, Samsung) " +
                    "Sozlamalar → Ilovalar → DS Taxi bo‘limida „Avtoyuklash“ni yoqing va „Batareya: cheklovsiz“ni tanlang.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("Ilova sozlamalarini ochish") }
        }

        Section("Hisob") {
            Text(app.session.account.value?.companyName ?: "", style = MaterialTheme.typography.titleMedium)
            Text("Login: ${app.session.account.value?.login ?: ""}", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = { confirmLogout = true }) { Text("Chiqish") }
        }

        Text("DS Taxi ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Chiqasizmi?") },
            text = { Text("Chiqsangiz bu telefon yangi so‘rovlarni eshitmaydi.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch {
                        app.repository.logout()
                        app.session.clear()
                        app.dispatcher.stop()
                        DispatchService.stop(context)
                        onSignedOut()
                    }
                }) { Text("Ha, chiqaman") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Yo‘q") } },
        )
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
    Spacer(Modifier.size(0.dp))
}
