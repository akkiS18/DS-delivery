package com.dsdelivery.admin.ui

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.data.Severity
import kotlinx.coroutines.delay

/**
 * One thing that needs the administrator. The age keeps counting on the screen between polls (server age + time since the answer arrived).
 * "Qo‘ng‘iroq" opens the dialer for the restaurant AND quiets the item for 15 minutes; the "Jim" buttons only quiet it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AttentionCard(
    item: AttentionItem,
    fetchedAtMs: Long,
    ringing: Boolean,
    busy: Boolean,
    onCall: (phone: String) -> Unit,
    onAck: (minutes: Int) -> Unit,
    onSilence: () -> Unit,
    openLabel: String? = null,
    onOpen: () -> Unit = {},
) {
    val color = toneColor(toneOf(item.severity))
    val nowMs by produceState(SystemClock.elapsedRealtime()) {
        while (true) { value = SystemClock.elapsedRealtime(); delay(1000) }
    }
    val age = item.ageSeconds?.let { it + ((nowMs - fetchedAtMs) / 1000).coerceAtLeast(0) }
    val phone = item.restaurant?.phone?.takeIf { dialable(it).isNotEmpty() }

    Column(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(16.dp))
            .let { if (ringing) it.background(color.copy(alpha = 0.08f), RoundedCornerShape(16.dp)) else it }
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(
                severityLabel(item.severity).uppercase(), color = color, fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
            )
            if (age != null) Text("${ageText(age)} kutyapti", color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
        }
        Text(item.title, style = MaterialTheme.typography.titleMedium)
        item.restaurant?.let { Text(it.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold) }
        if (item.detail.isNotBlank()) Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        item.orderCode?.let { Text("Buyurtma #$it", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }

        if (item.acked) {
            Text(
                "Jim turibdi" + (clockOf(item.snoozeUntil)?.let { " ($it gacha)" } ?: ""),
                style = MaterialTheme.typography.bodyMedium, color = NeutralColor, fontWeight = FontWeight.SemiBold,
            )
        }

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (phone != null) {
                Button(onClick = { onCall(phone) }, enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = color)) { Text("📞 Qo‘ng‘iroq") }
            }
            if (openLabel != null) {
                OutlinedButton(onClick = onOpen, border = BorderStroke(1.dp, color)) { Text(openLabel) }
            }
            if (!item.acked) {
                OutlinedButton(onClick = { onAck(15) }, enabled = !busy, border = BorderStroke(1.dp, color)) { Text("Jim: 15 daq") }
                OutlinedButton(onClick = { onAck(60) }, enabled = !busy, border = BorderStroke(1.dp, color)) { Text("Jim: 1 soat") }
                // A heads-up that is not an emergency (a card nearing its turnover cap) may be quieted for the rest of the day.
                if (item.severity != Severity.CRITICAL) {
                    OutlinedButton(onClick = { onAck(720) }, enabled = !busy, border = BorderStroke(1.dp, color)) { Text("Jim: 12 soat") }
                }
            }
            if (ringing) TextButton(onClick = onSilence) { Text("Ovozni o‘chirish") }
        }
    }
}
