package com.dsdelivery.taxi.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Map
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.taxi.data.Action
import com.dsdelivery.taxi.data.RequestDto
import kotlinx.coroutines.delay

/** One taxi request: what to do next is at the bottom (the server decides which buttons exist). */
@Composable
fun RequestCard(
    r: RequestDto,
    clockOffsetMs: Long,
    ringing: Boolean,
    busy: Boolean,
    onAction: (String) -> Unit,
    onSilence: () -> Unit,
) {
    val look = statusLook(r.status)
    val tone = toneColor(look.tone)
    val context = LocalContext.current
    var confirm by remember { mutableStateOf<String?>(null) }

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = if (look.tone == Tone.URGENT) BorderStroke(3.dp, tone) else null,
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("#${r.orderCode}", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                if (r.isTest) Chip("SINOV", NeutralColor)
                Spacer(Modifier.size(8.dp))
                Chip(look.label, tone)
            }

            if (r.status == "REQUESTED") AnswerTimer(r.answerBy, clockOffsetMs)

            if (ringing) {
                OutlinedButton(onClick = onSilence, modifier = Modifier.fillMaxWidth()) { Text("🔕 Ovozni o‘chirish") }
            }

            Place("Olib ketish", r.restaurant.name, r.restaurant.address, r.restaurant.phone, null, null, context)
            Place("Yetkazish", null, r.delivery.address, r.delivery.customerPhone, r.delivery.lat, r.delivery.lng, context)

            FoodLine(r, clockOffsetMs)

            r.deliverBlockedReason?.let { Text(it, color = WarnColor, style = MaterialTheme.typography.bodyMedium) }

            if (r.actions.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    r.actions.forEach { action ->
                        val primary = action != Action.NO_TAXI
                        val label = actionLabel(action, r.status)
                        val needsConfirm = action == Action.NO_TAXI || action == Action.DELIVERED
                        val enabled = !busy && !(action == Action.DELIVERED && r.deliverBlockedReason != null)
                        val click = { if (needsConfirm) confirm = action else onAction(action) }
                        if (primary) {
                            Button(
                                onClick = click, enabled = enabled,
                                colors = ButtonDefaults.buttonColors(containerColor = TaxiYellow, contentColor = Color(0xFF1B1B1F)),
                                modifier = Modifier.fillMaxWidth().height(60.dp),
                            ) {
                                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Color(0xFF1B1B1F)) else Text(label)
                            }
                        } else {
                            OutlinedButton(
                                onClick = click, enabled = enabled,
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = UrgentColor),
                                border = BorderStroke(1.5.dp, UrgentColor),
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                            ) { Text(label) }
                        }
                    }
                }
            }
        }
    }

    confirm?.let { action ->
        val (title, body) = if (action == Action.DELIVERED)
            "Yetkazildimi?" to "Buyurtma mijozga haqiqatan topshirildimi? Tasdiqlasangiz buyurtma yakunlanadi, qaytarib bo‘lmaydi."
        else
            "Taksi yo‘qmi?" to "Bu so‘rovga haydovchi yuborib bo‘lmasligini tasdiqlaysizmi? Mijoz roziligi bo‘lsa boshqa kompaniyaga murojaat qilinadi."
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(title) },
            text = { Text(body) },
            confirmButton = { TextButton(onClick = { confirm = null; onAction(action) }) { Text(if (action == Action.DELIVERED) "Ha, yetkazildi" else "Ha, taksi yo‘q") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Yo‘q, ortga") } },
        )
    }
}

@Composable
private fun Chip(text: String, color: Color) {
    Box(Modifier.background(color, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 5.dp)) {
        Text(text, color = Color.White, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

/** Counts down the time left to answer a new request. */
@Composable
private fun AnswerTimer(answerBy: String?, offsetMs: Long) {
    val end = remember(answerBy) { answerBy?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } } ?: return
    var left by remember { mutableStateOf((end - (System.currentTimeMillis() + offsetMs)) / 1000) }
    LaunchedEffect(end, offsetMs) {
        while (true) {
            left = (end - (System.currentTimeMillis() + offsetMs)) / 1000
            delay(1000)
        }
    }
    Text(
        if (left > 0) "Javob muddati: ${mmss(left)}" else "Javob muddati o‘tdi — hoziroq javob bering",
        color = if (left > 30) NeutralColor else UrgentColor, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun Place(title: String, name: String?, address: String?, phone: String?, lat: Double?, lng: Double?, context: Context) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        if (name != null) Text(name, style = MaterialTheme.typography.titleMedium)
        Text(address ?: "Manzil kiritilmagan", style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            if (!phone.isNullOrBlank()) {
                OutlinedButton(onClick = { dial(context, phone) }) {
                    Icon(Icons.Filled.Call, null, Modifier.size(18.dp)); Spacer(Modifier.size(6.dp)); Text(phone, style = MaterialTheme.typography.bodyMedium)
                }
            }
            // Only a place the customer/restaurant actually shared (coordinates) gets a map button: a typed address searched on a map is a guess.
            if (lat != null && lng != null) {
                OutlinedButton(onClick = { openMap(context, lat, lng) }) {
                    Icon(Icons.Filled.Map, null, Modifier.size(18.dp)); Spacer(Modifier.size(6.dp)); Text("Xarita", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun FoodLine(r: RequestDto, offsetMs: Long) {
    val f = r.food
    val text = when {
        f.ready -> "Taom: TAYYOR" + (clockOf(f.readyAt)?.let { " ($it)" } ?: "")
        f.estimatedReadyAt != null -> "Taom: tayyorlanmoqda, taxminan ${clockOf(f.estimatedReadyAt)} da tayyor"
        else -> "Taom: tayyorlanmoqda"
    }
    Text(text, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = if (f.ready) OkColor else MaterialTheme.colorScheme.onSurface)
    Text("Taom narxi: ${som(f.totalSom)} (yetkazish haqi emas — uni taksi xizmatingiz belgilaydi)", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun dial(context: Context, phone: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + dialable(phone))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

private fun openMap(context: Context, lat: Double, lng: Double) {
    val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng")
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(context, "Xarita ilovasi topilmadi", Toast.LENGTH_SHORT).show()
    }
}
