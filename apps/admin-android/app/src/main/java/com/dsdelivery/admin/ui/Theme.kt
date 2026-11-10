package com.dsdelivery.admin.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.admin.R

// DS Admin design system, see docs/ADMIN_UI_PLAN.md. Raw colours live in Palette.kt; screens read them only through MaterialTheme / the status colours below.

/** Manrope (variable font, OFL; apps/admin-android/licenses). Glyphs outside it (Cyrillic қ ғ ҳ) fall back to the system font. */
@OptIn(ExperimentalTextApi::class)
val Manrope = FontFamily(
    listOf(400, 500, 600, 700, 800).map { w ->
        Font(R.font.manrope, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

private fun style(size: Int, weight: Int, line: Int) =
    TextStyle(fontFamily = Manrope, fontWeight = FontWeight(weight), fontSize = size.sp, lineHeight = line.sp, letterSpacing = 0.sp)

/** Medium density (owner decision 2026-11-10): body 15-16 sp, titles 17-22 sp, one big display size for money figures. */
private val Type = Typography(
    displaySmall = style(28, 800, 34),
    headlineSmall = style(22, 700, 28),
    titleLarge = style(22, 700, 28),
    titleMedium = style(17, 600, 22),
    titleSmall = style(15, 600, 20),
    bodyLarge = style(16, 400, 22),
    bodyMedium = style(15, 400, 21),
    bodySmall = style(13, 400, 18),
    labelLarge = style(15, 600, 20),
    labelMedium = style(13, 600, 18),
    labelSmall = style(12, 600, 16),
)

/** Amounts and counters: tabular figures so digits line up in a column. Use `.merge(AmountStyle)` on any text style. */
val AmountStyle = TextStyle(fontFeatureSettings = "tnum")

private val Shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp), extraLarge = RoundedCornerShape(24.dp),
)

private fun scheme(p: PaletteSet, dark: Boolean): ColorScheme {
    fun c(v: Long) = Color(v)
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c(p.primary), onPrimary = c(p.onPrimary), primaryContainer = c(p.primaryContainer), onPrimaryContainer = c(p.onPrimaryContainer),
        secondary = c(p.onSurfaceVariant), onSecondary = c(p.surface),
        secondaryContainer = c(p.primaryContainer), onSecondaryContainer = c(p.onPrimaryContainer),
        background = c(p.background), onBackground = c(p.onSurface),
        surface = c(p.surface), onSurface = c(p.onSurface),
        surfaceVariant = c(p.surfaceVariant), onSurfaceVariant = c(p.onSurfaceVariant),
        outline = c(p.outline), outlineVariant = c(p.outline),
        error = c(p.urgent), onError = c(p.surface), errorContainer = c(p.urgentContainer), onErrorContainer = c(p.urgent),
    )
}

/** Status colours (not part of Material): each has a text/icon colour and a soft container for chips and banners. */
@Immutable
class StatusColors(
    val urgent: Color, val urgentContainer: Color,
    val warn: Color, val warnContainer: Color,
    val ok: Color, val okContainer: Color,
    val info: Color, val infoContainer: Color,
    val neutral: Color, val neutralContainer: Color,
)

private fun status(p: PaletteSet) = StatusColors(
    urgent = Color(p.urgent), urgentContainer = Color(p.urgentContainer),
    warn = Color(p.warn), warnContainer = Color(p.warnContainer),
    ok = Color(p.ok), okContainer = Color(p.okContainer),
    info = Color(p.primary), infoContainer = Color(p.primaryContainer),
    neutral = Color(p.onSurfaceVariant), neutralContainer = Color(p.surfaceVariant),
)

val LocalStatusColors = staticCompositionLocalOf { status(Palette.Light) }

/** Same names as before, now theme-aware (light / dark). */
val UrgentColor: Color @Composable @ReadOnlyComposable get() = LocalStatusColors.current.urgent
val WarnColor: Color @Composable @ReadOnlyComposable get() = LocalStatusColors.current.warn
val InfoColor: Color @Composable @ReadOnlyComposable get() = LocalStatusColors.current.info
val OkColor: Color @Composable @ReadOnlyComposable get() = LocalStatusColors.current.ok
val NeutralColor: Color @Composable @ReadOnlyComposable get() = LocalStatusColors.current.neutral

@Composable
fun DSAdminTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val p = if (darkTheme) Palette.Dark else Palette.Light
    CompositionLocalProvider(LocalStatusColors provides status(p)) {
        MaterialTheme(colorScheme = scheme(p, darkTheme), typography = Type, shapes = Shapes, content = content)
    }
}
