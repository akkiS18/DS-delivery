package com.dsdelivery.restaurant.ui.theme

import androidx.compose.ui.graphics.Color

// Brand palette
val BrandPrimary = Color(0xFF087F5B)
val BrandMint = Color(0xFFB8E8CF)
val BrandBackground = Color(0xFFF5FBF7)
val BrandDark = Color(0xFF1B3031)

// Semantic colors
val BrandPrimaryDark = Color(0xFF066145)
val BrandMintLight = Color(0xFFE4F7EE)
val BrandSurface = Color(0xFFFFFFFF)
val BrandSurfaceVariant = Color(0xFFEBF5F0)

val TextPrimary = Color(0xFF1B3031)
val TextSecondary = Color(0xFF4A6061)
val TextMuted = Color(0xFF7A9192)

/** "Tayyor" buttons and text: a green of its own, no longer the brand colour (audit A1). */
val SuccessGreen = Color(0xFF15803D)
val WarningOrange = Color(0xFFD97706)
val ErrorRed = Color(0xFFDC2626)

// Mockup 2026-11-22 (approved): one meaning = one colour. Badge = background + text, stripe = the order card's left edge.
/** Warning TEXT: #D97706 on a light orange background was ~3:1 (audit B10). Icons may stay WarningOrange. */
val WarningText = Color(0xFF92400E)
val WarningBg = Color(0xFFFEF3C7)
val ReadyStripe = Color(0xFF16A34A)
val ReadyBg = Color(0xFFDCFCE7)
val ReadyText = Color(0xFF166534)
val CookingBlue = Color(0xFF2563EB)
val CookingBg = Color(0xFFDBEAFE)
val CookingText = Color(0xFF1E40AF)
/** "Qabul qildim": the money arrived, the kitchen acts (blue, not the brand green). */
val AcceptBlue = Color(0xFF1D4ED8)
val ErrorBg = Color(0xFFFEE2E2)
val ErrorText = Color(0xFFB91C1C)
val DoneBg = Color(0xFFEEF2F2)
val DoneText = Color(0xFF3F5253)
val DoneStripe = Color(0xFFA6B8B6)

val ChipSelectedBg = BrandPrimary
val ChipUnselectedBg = BrandSurfaceVariant

// Backward compatibility aliases
val SlateTeal = BrandPrimary
val DarkSlateTeal = BrandDark
val LightSlateTeal = BrandMint
val SoftCyan = BrandMint
val BackgroundLight = BrandBackground
val SurfaceLight = BrandSurface
val SurfaceVariantLight = BrandSurfaceVariant
