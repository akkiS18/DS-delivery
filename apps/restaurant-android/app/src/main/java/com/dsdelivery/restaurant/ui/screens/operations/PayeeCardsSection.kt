package com.dsdelivery.restaurant.ui.screens.operations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.dsdelivery.restaurant.data.model.CardNumber
import com.dsdelivery.restaurant.data.model.PayeeCard
import com.dsdelivery.restaurant.data.model.PayeeCardStatus
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.SuccessGreen
import com.dsdelivery.restaurant.ui.theme.WarningOrange

/**
 * Stage 8B: the cards customers pay to. The full number is typed once (and never shown again: the server only returns the masked form);
 * a new card waits for a platform administrator before it can be used.
 */
@Composable
fun PayeeCardsSection(
    cards: List<PayeeCard>,
    loading: Boolean,
    error: String?,
    busyCardId: String?,
    onAdd: () -> Unit,
    onToggle: (PayeeCard) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    SettingsSection(
        title = "To‘lov kartalari",
        modifier = modifier,
        footer = "Yangi karta administrator tasdiqlagach faollashadi."
    ) {
        when {
            loading && cards.isEmpty() -> Text("Yuklanmoqda...", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 12.dp))
            error != null && cards.isEmpty() -> {
                Text(error, style = MaterialTheme.typography.bodyMedium, color = ErrorRed, modifier = Modifier.padding(top = 12.dp))
                TextButton(onClick = onRetry) { Text("Qayta urinish") }
            }
            cards.isEmpty() -> Text("Karta yo‘q", style = MaterialTheme.typography.bodyMedium, color = WarningOrange, modifier = Modifier.padding(vertical = 12.dp))
            else -> cards.forEachIndexed { index, card ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                PayeeCardRow(card = card, busy = busyCardId == card.id, onToggle = { onToggle(card) })
            }
        }

        if (cards.isNotEmpty() && cards.none { it.status == PayeeCardStatus.ACTIVE }) {
            Text(
                "Faol karta yo‘q. Mijozlar buyurtma bera olmaydi.",
                style = MaterialTheme.typography.bodyMedium,
                color = WarningOrange,
                modifier = Modifier.padding(bottom = 4.dp)
            )
        }

        OutlinedButton(
            onClick = onAdd,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 4.dp)
        ) { Text("Karta qo‘shish") }
    }
}

@Composable
private fun PayeeCardRow(card: PayeeCard, busy: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(card.masked, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyLarge)
            val (label, color) = when (card.status) {
                PayeeCardStatus.ACTIVE -> "Faol" to SuccessGreen
                PayeeCardStatus.DISABLED -> "O‘chirilgan" to MaterialTheme.colorScheme.onSurfaceVariant
                PayeeCardStatus.PENDING -> "Tasdiq kutilmoqda" to WarningOrange
                PayeeCardStatus.REJECTED -> "Rad etilgan" to ErrorRed
                PayeeCardStatus.UNKNOWN -> "Noma’lum" to MaterialTheme.colorScheme.onSurfaceVariant
            }
            Text(label, style = MaterialTheme.typography.bodyMedium, color = color)
        }
        if (card.status == PayeeCardStatus.ACTIVE || card.status == PayeeCardStatus.DISABLED) {
            Switch(
                checked = card.status == PayeeCardStatus.ACTIVE,
                onCheckedChange = { onToggle() },
                enabled = !busy,
                colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = BrandPrimary)
            )
        }
    }
}

/** The field holds bare digits; the spaces are only drawn, so the cursor always stays where the user is typing. */
private val CardNumberTransformation = VisualTransformation { text ->
    val raw = text.text
    val shown = CardNumber.grouped(raw)
    TransformedText(AnnotatedString(shown), object : OffsetMapping {
        override fun originalToTransformed(offset: Int): Int = (offset + (offset - 1).coerceAtLeast(0) / 4).coerceAtMost(shown.length)
        override fun transformedToOriginal(offset: Int): Int = (offset - offset / 5).coerceIn(0, raw.length)
    })
}

@Composable
fun AddCardDialog(
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSubmit: (digits: String, password: String) -> Unit
) {
    var digits by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val typo = digits.length == 16 && !CardNumber.isValid(digits)
    val canSend = !busy && CardNumber.isValid(digits) && password.isNotBlank()

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Karta qo‘shish", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = digits,
                    onValueChange = { digits = CardNumber.digits(it) },
                    label = { Text("Karta raqami") },
                    singleLine = true,
                    isError = typo,
                    supportingText = { if (typo) Text("Raqamda xato bor.") },
                    visualTransformation = CardNumberTransformation,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Parolingiz") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth()
                )
                if (error != null) Text(error, style = MaterialTheme.typography.bodyMedium, color = ErrorRed)
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit(digits, password) },
                enabled = canSend,
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
            ) { Text(if (busy) "Yuborilmoqda..." else "Yuborish") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Yopish") } },
        shape = RoundedCornerShape(16.dp)
    )
}
