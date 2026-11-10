package com.dsdelivery.admin.ui

/**
 * The raw colours of DS Admin (ARGB). Kept as plain numbers so the JVM contrast test can check them without Compose.
 * Rules (docs/ADMIN_UI_PLAN.md): graphite neutrals + ONE accent (indigo); red / amber / green are status colours only and always come with an icon and text.
 * Every text pair must reach WCAG AA (4.5:1); PaletteTest enforces it.
 */
internal class PaletteSet(
    val background: Long, val surface: Long, val surfaceVariant: Long, val outline: Long,
    val onSurface: Long, val onSurfaceVariant: Long,
    val primary: Long, val onPrimary: Long, val primaryContainer: Long, val onPrimaryContainer: Long,
    val urgent: Long, val urgentContainer: Long,
    val warn: Long, val warnContainer: Long,
    val ok: Long, val okContainer: Long,
)

internal object Palette {
    val Light = PaletteSet(
        background = 0xFFF5F6F8, surface = 0xFFFFFFFF, surfaceVariant = 0xFFECEEF2, outline = 0xFFD7DAE1,
        onSurface = 0xFF1B1D23, onSurfaceVariant = 0xFF555A66,
        primary = 0xFF4F5BD5, onPrimary = 0xFFFFFFFF, primaryContainer = 0xFFEBEDFD, onPrimaryContainer = 0xFF1E2470,
        urgent = 0xFFC62828, urgentContainer = 0xFFFDECEC,
        warn = 0xFF9A5600, warnContainer = 0xFFFFF1DC,
        ok = 0xFF1E7B4A, okContainer = 0xFFE3F4EB,
    )
    val Dark = PaletteSet(
        background = 0xFF121317, surface = 0xFF1C1E24, surfaceVariant = 0xFF272A31, outline = 0xFF383B44,
        onSurface = 0xFFE8E9ED, onSurfaceVariant = 0xFFA9ADB8,
        primary = 0xFFA3AAFF, onPrimary = 0xFF14163A, primaryContainer = 0xFF2C3170, onPrimaryContainer = 0xFFDDE0FF,
        urgent = 0xFFFF8A80, urgentContainer = 0xFF3F1D1D,
        warn = 0xFFFFB74D, warnContainer = 0xFF3D2C10,
        ok = 0xFF6FD29B, okContainer = 0xFF163626,
    )
}

/** WCAG 2.x relative luminance and contrast ratio of two ARGB colours (alpha ignored). */
internal object Contrast {
    private fun channel(v: Int): Double { val c = v / 255.0; return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4) }
    fun luminance(argb: Long): Double {
        val r = ((argb shr 16) and 0xFF).toInt(); val g = ((argb shr 8) and 0xFF).toInt(); val b = (argb and 0xFF).toInt()
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    fun ratio(a: Long, b: Long): Double {
        val la = luminance(a); val lb = luminance(b)
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }
}
