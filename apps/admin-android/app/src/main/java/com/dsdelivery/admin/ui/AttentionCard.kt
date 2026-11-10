package com.dsdelivery.admin.ui

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.data.AttentionItem
import com.dsdelivery.admin.data.Severity
import com.dsdelivery.admin.ui.kit.AdminCard
import com.dsdelivery.admin.ui.kit.SecondaryButton
import com.dsdelivery.admin.ui.kit.StatusChip
import com.dsdelivery.admin.ui.kit.toneColors
import com.dsdelivery.admin.ui.kit.PrimaryButton
import kotlinx.coroutines.delay

/**
 * One thing that needs the administrator. The age keeps counting on the screen between polls (server age + time since the answer arrived).
 * "Qönğiroq" opens the dialer for the restaurant AND quiets the item for 15 minutes; the "Jim" buttons only quiet it.
 * While the phone is ringing for this item the card is tinted in its status tone.
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
    val tone = toneOf(item.severity)
    val (color, _) = toneColors(tone)
    val nowMs by produceState(SystemClock.elapsedRealtime()) {
        while (true) { value = SystemClock.elapsedRealtime(); delay(1000) }
    }
    val age = item.ageSeconds?.let { it + ((nowMs - fetchedAtMs) / 1000).coerceAtLeast(0) }
    val phone = item.restaurant?.phone?.takeIf { dialable(it).isNotEmpty() }

    AdminCard(highlight = if (ringing) tone else null) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            StatusChip(severityLabel(item.severity), tone)
            if (age != null) Text("${ageText(age)} kutyapti", color = color, style = MaterialTheme.typography.labelLarge.merge(AmountStyle))
        }
        Text(item.title, style = MaterialTheme.typography.titleMedium)
        item.restaurant?.let { Text(it.name, style = MaterialTheme.typography.titleSmall) }
        if (item.detail.isNotBlank()) Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        item.orderCode?.let { Text("Buyurtma #$it", style = MaterialTheme.typography.bodyMedium.merge(AmountStyle), color = MaterialTheme.colorScheme.onSurfaceVariant) }

        if (item.acked) {
            Text(
                "Jim turibdi" + (clockOf(item.snoozeUntil)?.let { " ($it gaça)" } ?: ""),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold,
            )
        }

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (phone != null) {
                PrimaryButton("Qönğiroq", { onCall(phone) }, Modifier, enabled = !busy, icon = Icons.Filled.Call)
            }
            if (openLabel != null) SecondaryButton(openLabel, onOpen, Modifier)
            if (!item.acked) {
                SecondaryButton("Jim: 15 daq", { onAck(15) }, Modifier, enabled = !busy)
                SecondaryButton("Jim: 1 soat", { onAck(60) }, Modifier, enabled = !busy)
                // A heads-up that is not an emergency (a card nearing its turnover cap) may be quieted for the rest of the day.
                if (item.severity != Severity.CRITICAL) SecondaryButton("Jim: 12 soat", { onAck(720) }, Modifier, enabled = !busy)
            }
            if (ringing) TextButton(onClick = onSilence) { Text("Ovozni öçiriş", style = MaterialTheme.typography.labelLarge) }
        }
    }
}
