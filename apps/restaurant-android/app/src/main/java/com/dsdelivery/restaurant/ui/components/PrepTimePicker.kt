package com.dsdelivery.restaurant.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.restaurant.ui.theme.BrandPrimary

/** "Ready in N minutes": 5 minutes up to 1 hour in steps of 5, 15 pre-selected (not every dish takes the same time). */
val PREP_CHOICES: List<Int> = (5..60 step 5).toList()
const val DEFAULT_PREP_CHOICE = 15

fun prepChoiceLabel(minutes: Int): String = if (minutes == 60) "1 soat" else "$minutes"
fun prepChoiceSentence(minutes: Int): String = if (minutes == 60) "1 soat" else "$minutes daqiqa"

/**
 * Twelve large chips (four per row) and one confirm button: the default takes one tap, any other time two. The chosen time
 * is "ready in N minutes from now"; the server turns it into the clock the customer and the taxi service see.
 */
@Composable
fun PrepTimePicker(
    initial: Int,
    busy: Boolean,
    onConfirm: (Int) -> Unit,
    modifier: Modifier = Modifier,
    title: String = "Necha daqiqada tayyor bo‘ladi?"
) {
    var selected by remember(initial) { mutableIntStateOf(if (initial in PREP_CHOICES) initial else DEFAULT_PREP_CHOICE) }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        PREP_CHOICES.chunked(4).forEach { rowChoices ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowChoices.forEach { minutes ->
                    val on = minutes == selected
                    val shape = RoundedCornerShape(10.dp)
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(46.dp)
                            .clip(shape)
                            .background(if (on) BrandPrimary else BrandPrimary.copy(alpha = 0.08f))
                            .border(BorderStroke(1.dp, BrandPrimary.copy(alpha = if (on) 1f else 0.45f)), shape)
                            .clickable(enabled = !busy, role = Role.RadioButton) { selected = minutes },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = prepChoiceLabel(minutes),
                            color = if (on) Color.White else BrandPrimary,
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleMedium
                        )
                    }
                }
            }
        }
        Text("daqiqa", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 2.dp))
        Button(
            onClick = { onConfirm(selected) },
            enabled = !busy,
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        ) {
            Text("${prepChoiceSentence(selected)}da tayyor — tasdiqlash", fontWeight = FontWeight.Bold)
        }
    }
}
