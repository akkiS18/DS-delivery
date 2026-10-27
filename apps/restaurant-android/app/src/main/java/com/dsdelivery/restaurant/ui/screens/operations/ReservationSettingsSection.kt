package com.dsdelivery.restaurant.ui.screens.operations

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.dsdelivery.restaurant.data.model.ReservationSettings
import com.dsdelivery.restaurant.data.model.Reservations
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed

/**
 * Table reservations: on/off and the deposit the customer pays to the restaurant's card (default 100 000 so‘m). The values come from the
 * reservations list; [settings] is null until it has loaded, so the controls stay off until then rather than showing a guess.
 */
@Composable
fun ReservationSettingsSection(
    settings: ReservationSettings?,
    busy: Boolean,
    error: String?,
    onSave: (enabled: Boolean, depositSom: Int) -> Unit,
    onDismissError: () -> Unit,
    modifier: Modifier = Modifier
) {
    var editing by remember { mutableStateOf(false) }
    SettingsSection(
        title = "Joy bron qilish",
        modifier = modifier,
        footer = "Mijoz bron uchun shu summani karta orqali to‘laydi. Pul tushganda ilova sizga xabar beradi. Muammo bo‘lsa, mijozga qo‘ng‘iroq qilib pulni qaytarasiz."
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Bron qabul qilish", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(
                checked = settings?.enabled == true,
                enabled = settings != null && !busy,
                onCheckedChange = { on -> settings?.let { onSave(on, it.depositSom) } },
                colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = BrandPrimary)
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(enabled = settings != null && !busy) { editing = true },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Oldindan to‘lov", style = MaterialTheme.typography.bodyLarge)
            Text(
                settings?.let { Reservations.money(it.depositSom) } ?: "—",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (error != null) {
            Text(error, color = ErrorRed, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp).clickable { onDismissError() })
        }
    }

    if (editing && settings != null) {
        DepositDialog(
            current = settings.depositSom,
            onDismiss = { editing = false },
            onSave = { amount -> editing = false; onSave(settings.enabled, amount) }
        )
    }
}

@Composable
private fun DepositDialog(current: Int, onDismiss: () -> Unit, onSave: (Int) -> Unit) {
    var text by remember { mutableStateOf(current.toString()) }
    val amount = Reservations.parseDeposit(text)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Bron uchun oldindan to‘lov") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it.filter { c -> c.isDigit() }.take(9) },
                    label = { Text("Summa (so‘m)") },
                    singleLine = true,
                    isError = amount == null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    supportingText = {
                        Text(
                            if (amount == null) "${Reservations.money(Reservations.MIN_DEPOSIT_SOM)} dan ${Reservations.money(Reservations.MAX_DEPOSIT_SOM)} gacha"
                            else Reservations.money(amount)
                        )
                    }
                )
                TextButton(onClick = { text = Reservations.DEFAULT_DEPOSIT_SOM.toString() }) { Text("Odatiy: ${Reservations.money(Reservations.DEFAULT_DEPOSIT_SOM)}") }
            }
        },
        confirmButton = {
            Button(
                onClick = { amount?.let(onSave) },
                enabled = amount != null,
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
            ) { Text("Saqlash") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Yopish") } }
    )
}
