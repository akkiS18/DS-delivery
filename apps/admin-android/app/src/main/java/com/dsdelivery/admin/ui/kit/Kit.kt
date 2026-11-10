package com.dsdelivery.admin.ui.kit

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.ui.AmountStyle
import com.dsdelivery.admin.ui.LocalStatusColors
import com.dsdelivery.admin.ui.Tone

// DS Admin component kit (docs/ADMIN_UI_PLAN.md, section 5). New screens use ONLY these for cards, rows, chips, buttons, dialogs and the empty / error / loading states;
// colours come from MaterialTheme or the status colours, never from Color(0x...). Uzbek texts are in the new Latin alphabet (Ö Ğ Ş Ç).

/** Foreground and soft background of a status tone. */
@Composable
fun toneColors(t: Tone): Pair<Color, Color> {
    val s = LocalStatusColors.current
    return when (t) {
        Tone.URGENT -> s.urgent to s.urgentContainer
        Tone.WARN -> s.warn to s.warnContainer
        Tone.INFO -> s.info to s.infoContainer
        Tone.OK -> s.ok to s.okContainer
        Tone.NEUTRAL -> s.neutral to s.neutralContainer
    }
}

private fun toneIcon(t: Tone): ImageVector? = when (t) {
    Tone.URGENT -> Icons.Filled.Error
    Tone.WARN -> Icons.Filled.Warning
    Tone.OK -> Icons.Filled.CheckCircle
    Tone.INFO -> Icons.Filled.Info
    Tone.NEUTRAL -> null
}

/**
 * The surface every block of content sits on: 16 dp corners, 1 dp outline, 16 dp padding, 8 dp between children. Tappable when [onClick] is given.
 * [highlight] tints the card and its outline in a status tone (an item that is ringing right now).
 */
@Composable
fun AdminCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, highlight: Tone? = null, content: @Composable ColumnScope.() -> Unit) {
    val body: @Composable () -> Unit = { Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content) }
    val shape = MaterialTheme.shapes.large
    val tone = highlight?.let { toneColors(it) }
    val border = BorderStroke(if (tone != null) 2.dp else 1.dp, tone?.first ?: MaterialTheme.colorScheme.outline)
    val color = tone?.second ?: MaterialTheme.colorScheme.surface
    if (onClick != null) Surface(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = shape, color = color, border = border, content = body)
    else Surface(modifier = modifier.fillMaxWidth(), shape = shape, color = color, border = border, content = body)
}

/** Heading of a group of cards or rows, with an optional action on the right ("Hammasi"). */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        action?.invoke()
    }
}

/** A status label: colour + icon + text (colour is never the only signal). */
@Composable
fun StatusChip(text: String, tone: Tone, modifier: Modifier = Modifier) {
    val (fg, bg) = toneColors(tone)
    Row(
        modifier.background(bg, MaterialTheme.shapes.small).padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        toneIcon(tone)?.let { Icon(it, contentDescription = null, tint = fg, modifier = Modifier.size(14.dp)) }
        Text(text, color = fg, style = MaterialTheme.typography.labelMedium)
    }
}

/** A full-width message strip (offline notice, warning before a money action). */
@Composable
fun Notice(text: String, tone: Tone, modifier: Modifier = Modifier) {
    val (fg, bg) = toneColors(tone)
    Row(
        modifier.fillMaxWidth().background(bg, MaterialTheme.shapes.medium).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        toneIcon(tone)?.let { Icon(it, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp)) }
        Text(text, color = fg, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold))
    }
}

/** One row of a list: optional icon, title, second line, trailing content (or a chevron when tappable). At least 56 dp tall. */
@Composable
fun ListRow(
    title: String, modifier: Modifier = Modifier, subtitle: String? = null, leading: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null,
) {
    val row: @Composable () -> Unit = {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            leading?.let { Icon(it, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp)) }
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                subtitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            when {
                trailing != null -> trailing()
                onClick != null -> Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    if (onClick != null) Surface(onClick = onClick, modifier = modifier, color = Color.Transparent, content = row)
    else Surface(modifier = modifier, color = Color.Transparent, content = row)
}

/** A number with its label (home screen: orders today, revenue, commission due). */
@Composable
fun MetricTile(label: String, value: String, modifier: Modifier = Modifier, tone: Tone = Tone.NEUTRAL, hint: String? = null, onClick: (() -> Unit)? = null) {
    val (fg, _) = toneColors(tone)
    AdminCard(modifier, onClick = onClick) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value, style = MaterialTheme.typography.displaySmall.merge(AmountStyle),
            color = if (tone == Tone.NEUTRAL) MaterialTheme.colorScheme.onSurface else fg,
        )
        hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

private val ButtonHeight = 48.dp

/** The one main action of a card or screen. While [loading] it shows a spinner and ignores taps. */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier.fillMaxWidth(), enabled: Boolean = true, loading: Boolean = false, icon: ImageVector? = null) {
    Button(onClick = onClick, enabled = enabled && !loading, modifier = modifier.heightIn(min = ButtonHeight)) {
        if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        else {
            icon?.let { Icon(it, contentDescription = null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
            Text(text, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier.fillMaxWidth(), enabled: Boolean = true) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = ButtonHeight)) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

/** For actions that delete or cannot be undone. Always put it behind [ConfirmDialog]. */
@Composable
fun DangerButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier.fillMaxWidth(), enabled: Boolean = true) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = ButtonHeight),
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
    ) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

/**
 * Asks before money moves or something is removed. [message] says what will change; [confirmText] names the action ("Ha, ötkazdim"), never just "OK".
 */
@Composable
fun ConfirmDialog(
    title: String, message: String, confirmText: String, onConfirm: () -> Unit, onDismiss: () -> Unit,
    danger: Boolean = false, busy: Boolean = false, dismissText: String = "Bekor qiliş",
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(title) },
        text = { Text(message, style = MaterialTheme.typography.bodyLarge) },
        confirmButton = {
            TextButton(enabled = !busy, onClick = onConfirm) {
                Text(confirmText, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(dismissText, style = MaterialTheme.typography.labelLarge) } },
    )
}

/** Nothing to show: says why and what to do next (never an empty screen or a bare "Yöq."). */
@Composable
fun EmptyState(title: String, modifier: Modifier = Modifier, hint: String? = null, icon: ImageVector? = null, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        icon?.let { Icon(it, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(40.dp)) }
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        hint?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center) }
        action?.let { Spacer(Modifier.height(4.dp)); it() }
    }
}

/** The data could not be loaded: what happened and a retry. */
@Composable
fun ErrorState(modifier: Modifier = Modifier, message: String = "Yuklab bölmadi. Ulanişni tekşiring.", onRetry: () -> Unit) {
    EmptyState(
        title = message, modifier = modifier, icon = Icons.Filled.Warning,
        action = { SecondaryButton("Qayta urinib köring", onRetry, Modifier) },
    )
}

/** Placeholder bars while a list loads (instead of a bare "Yuklanmoqda…" text). */
@Composable
fun LoadingSkeleton(modifier: Modifier = Modifier, cards: Int = 3) {
    val pulse by rememberInfiniteTransition(label = "skeleton").animateFloat(
        initialValue = 0.45f, targetValue = 1f, label = "alpha",
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
    )
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(cards) {
            AdminCard(Modifier.alpha(pulse)) {
                for (w in listOf(0.55f, 1f, 0.7f)) Box(Modifier.fillMaxWidth(w).height(14.dp).background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.small))
            }
        }
    }
}

/** Header of a detail screen inside a tab: a back arrow and what is open. */
@Composable
fun DetailHeader(title: String, onBack: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Orqaga") }
        Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(end = 16.dp))
    }
}

/** What a list shows before its first answer: placeholder bars, or the retry card when loading failed. */
@Composable
fun ListPlaceholder(offline: Boolean, onRetry: () -> Unit) {
    if (offline) ErrorState(onRetry = onRetry) else LoadingSkeleton()
}

/** A text field with its label, a hint line and an error line. */
@Composable
fun FormField(
    value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier.fillMaxWidth(),
    hint: String? = null, error: String? = null, singleLine: Boolean = true, keyboardType: KeyboardType = KeyboardType.Text, enabled: Boolean = true,
) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange, label = { Text(label) }, modifier = modifier, singleLine = singleLine, enabled = enabled,
        isError = error != null, keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        supportingText = (error ?: hint)?.let { { Text(it) } },
    )
}
