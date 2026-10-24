package com.dsdelivery.taxi.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val Ink = Color(0xFF1B1B1F)
val TaxiYellow = Color(0xFFFFC400)

private val Colors = lightColorScheme(
    primary = Ink,
    onPrimary = Color.White,
    primaryContainer = TaxiYellow,
    onPrimaryContainer = Ink,
    secondary = Color(0xFF4A4A52),
    background = Color(0xFFF6F6F8),
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFEDEDF1),
    onSurfaceVariant = Color(0xFF55555C),
    error = UrgentColor,
)

// Bigger than the Material defaults: the phone sits on a desk and is read at a glance.
private val Type = Typography(
    titleLarge = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 17.sp),
    bodyMedium = TextStyle(fontSize = 15.sp),
    labelLarge = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
)

@Composable
fun DSTaxiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, typography = Type, content = content)
}
