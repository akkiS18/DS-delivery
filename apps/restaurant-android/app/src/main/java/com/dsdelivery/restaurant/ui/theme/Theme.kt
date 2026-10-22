package com.dsdelivery.restaurant.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColorScheme = lightColorScheme(
    primary = BrandPrimary,
    onPrimary = Color.White,
    primaryContainer = BrandMintLight,
    onPrimaryContainer = BrandDark,
    secondary = BrandMint,
    onSecondary = BrandDark,
    secondaryContainer = BrandMintLight,
    onSecondaryContainer = BrandDark,
    background = BrandBackground,
    onBackground = BrandDark,
    surface = BrandSurface,
    onSurface = BrandDark,
    surfaceVariant = BrandSurfaceVariant,
    onSurfaceVariant = TextSecondary,
    error = ErrorRed,
    onError = Color.White
)

private val DarkColorScheme = darkColorScheme(
    primary = BrandMint,
    onPrimary = BrandDark,
    primaryContainer = BrandPrimaryDark,
    onPrimaryContainer = Color.White,
    secondary = BrandMint,
    onSecondary = BrandDark,
    background = Color(0xFF111D1E),
    onBackground = Color(0xFFE4F7EE),
    surface = BrandDark,
    onSurface = Color(0xFFE4F7EE),
    surfaceVariant = Color(0xFF264041),
    onSurfaceVariant = Color(0xFFA6BCBD),
    error = Color(0xFFEF4444),
    onError = Color.White
)

@Composable
fun DSRestaurantTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window
            window?.let {
                it.statusBarColor = colorScheme.primary.toArgb()
                WindowCompat.getInsetsController(it, view).isAppearanceLightStatusBars = false
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
