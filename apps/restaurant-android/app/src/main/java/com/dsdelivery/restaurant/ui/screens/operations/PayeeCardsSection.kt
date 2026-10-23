package com.dsdelivery.restaurant.ui.screens.operations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.unit.sp
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
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.CreditCard, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "To‘lov kartalari",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Mijozlar pulni shu kartalarga o‘tkazadi. Yangi karta administrator tasdiqlagandan keyin faollashadi.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(8.dp))

            when {
                loading && cards.isEmpty() -> Text("Yuklanmoqda...", style = MaterialTheme.typography.bodySmall)
                error != null && cards.isEmpty() -> {
                    Text(error, style = MaterialTheme.typography.bodySmall, color = ErrorRed)
                    TextButton(onClick = onRetry) { Text("Qayta urinish") }
                }
                cards.isEmpty() -> Text(
                    "Hali karta yo‘q. Real to‘lov yoqilganda kamida bitta faol karta kerak.",
                    style = MaterialTheme.typography.bodySmall,
                    color = WarningOrange
                )
                else -> cards.forEachIndexed { index, card ->
                    if (index > 0) HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                    PayeeCardRow(card = card, busy = busyCardId == card.id, onToggle = { onToggle(card) })
                }
            }

            if (cards.isNotEmpty() && cards.none { it.status == PayeeCardStatus.ACTIVE }) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Faol karta yo‘q: real to‘lov yoqilganda mijozlar buyurtma bera olmaydi.",
                    style = MaterialTheme.typography.bodySmall,
                    color = WarningOrange
                )
            }

            Spacer(Modifier.height(10.dp))
            OutlinedButton(onClick = onAdd, modifier = Modifier.fillMaxWidth()) { Text("Karta qo‘shish") }
        }
    }
}

@Composable
private fun PayeeCardRow(card: PayeeCard, busy: Boolean, onToggle: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Column(modifier = Modifier.weight(1f)) {
            Text(card.masked, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            val (label, color) = when (card.status) {
                PayeeCardStatus.ACTIVE -> "Faol" to SuccessGreen
                PayeeCardStatus.DISABLED -> "O‘chirilgan" to MaterialTheme.colorScheme.onSurfaceVariant
                PayeeCardStatus.PENDING -> "Administrator tasdig‘i kutilmoqda" to WarningOrange
                PayeeCardStatus.REJECTED -> "Rad etilgan (to‘g‘ri raqam bilan qayta yuborishingiz mumkin)" to ErrorRed
                PayeeCardStatus.UNKNOWN -> "Noma’lum holat" to MaterialTheme.colorScheme.onSurfaceVariant
            }
            Text(label, style = MaterialTheme.typography.bodySmall, color = color)
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
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "Mijozlar pulini qabul qiladigan 16 xonali karta raqami. Administrator uni siz bilan telefon orqali tekshirib tasdiqlaydi.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = digits,
                    onValueChange = { digits = CardNumber.digits(it) },
                    label = { Text("Karta raqami") },
                    singleLine = true,
                    visualTransformation = CardNumberTransformation,
                    isError = typo,
                    supportingText = { if (typo) Text("Raqamda xato bor. Qayta tekshiring.") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Hisob paroli (tasdiqlash uchun)") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth()
                )
                if (error != null) Text(error, style = MaterialTheme.typography.bodySmall, color = ErrorRed)
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit(digits, password) },
                enabled = canSend,
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
            ) { Text(if (busy) "Yuborilmoqda..." else "Yuborish") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Bekor qilish") } },
        shape = RoundedCornerShape(16.dp)
    )
}
