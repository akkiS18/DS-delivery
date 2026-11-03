package com.dsdelivery.restaurant.ui.screens.operations

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import com.dsdelivery.restaurant.RestaurantApp
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.WarningOrange

/**
 * "Yangi buyurtma signali": the kitchen bell that rings (also with the screen off) until the kitchen answers a new paid order.
 * Self-contained: it reads the app-wide [com.dsdelivery.restaurant.data.alarm.AlarmController], so the screen's callbacks stay unchanged.
 */
@Composable
fun BellSection() {
    if (LocalInspectionMode.current) return
    val context = LocalContext.current
    val alarm = (context.applicationContext as RestaurantApp).alarm
    val enabled by alarm.settings.enabled.collectAsState()

    SettingsSection(
        title = "Navbatchilik (faqat shu telefon)",
        footer = "Ish vaqti tugagach shu telefonda o‘chirib qo‘ying: u jim bo‘ladi, chiqib-kirish shart emas. Boshqa telefonlarga va restoranning buyurtma qabuliga ta’sir qilmaydi. Yoqilgan bo‘lsa, yangi to‘langan buyurtma uchun ilova yopiq yoki ekran o‘chiq bo‘lsa ham qo‘ng‘iroq chalinadi va buyurtmaga javob berilguncha takrorlanadi."
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Shu telefon navbatchilikda", style = MaterialTheme.typography.bodyLarge)
                if (!enabled) Text("O‘chiq: bu telefon jim, yangi buyurtmada qo‘ng‘iroq chalmaydi", style = MaterialTheme.typography.bodyMedium, color = WarningOrange)
            }
            Switch(
                checked = enabled,
                onCheckedChange = { alarm.settings.setEnabled(it) },
                colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = BrandPrimary)
            )
        }
        if (enabled) {
            if (alarm.watcher.player.volumeFraction() <= 0f) {
                Text(
                    "Signal ovozi (budilnik) o‘chiq. Telefonning budilnik ovozini oshiring.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = WarningOrange,
                    modifier = Modifier.padding(vertical = 4.dp)
                )
            }
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { alarm.watcher.player.beepOnce() }, modifier = Modifier.weight(1f)) { Text("Ovozni sinash") }
                OutlinedButton(
                    onClick = { runCatching { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } },
                    modifier = Modifier.weight(1f)
                ) { Text("Batareya sozlamasi") }
            }
        }
    }
}
