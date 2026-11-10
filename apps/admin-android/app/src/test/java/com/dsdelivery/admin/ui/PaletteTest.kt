package com.dsdelivery.admin.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The design tokens must stay readable: every text/background pair reaches WCAG AA (4.5:1), in the light and in the dark palette. */
class PaletteTest {
    private val sets = listOf("light" to Palette.Light, "dark" to Palette.Dark)

    private fun check(name: String, fg: Long, bg: Long, min: Double = 4.5) {
        val r = Contrast.ratio(fg, bg)
        assertTrue("$name: contrast ${"%.2f".format(r)} is below $min", r >= min)
    }

    @Test fun bodyTextIsReadable() {
        for ((n, p) in sets) {
            check("$n onSurface/surface", p.onSurface, p.surface)
            check("$n onSurface/background", p.onSurface, p.background)
            check("$n onSurfaceVariant/surface", p.onSurfaceVariant, p.surface)
            check("$n onSurfaceVariant/background", p.onSurfaceVariant, p.background)
            check("$n onSurfaceVariant/surfaceVariant", p.onSurfaceVariant, p.surfaceVariant)
        }
    }

    @Test fun accentIsReadableAsTextAndAsButton() {
        for ((n, p) in sets) {
            check("$n onPrimary/primary (button)", p.onPrimary, p.primary)
            check("$n primary/surface (link)", p.primary, p.surface)
            check("$n primary/background (link)", p.primary, p.background)
            check("$n onPrimaryContainer/primaryContainer", p.onPrimaryContainer, p.primaryContainer)
            check("$n primary/primaryContainer (tag)", p.primary, p.primaryContainer)
        }
    }

    @Test fun statusColoursAreReadableOnCardsAndOnTheirOwnContainers() {
        for ((n, p) in sets) {
            for ((tone, fg, container) in listOf(Triple("urgent", p.urgent, p.urgentContainer), Triple("warn", p.warn, p.warnContainer), Triple("ok", p.ok, p.okContainer))) {
                check("$n $tone/surface", fg, p.surface)
                check("$n $tone/background", fg, p.background)
                check("$n $tone/container", fg, container)
            }
        }
    }

    @Test fun statusColoursAreDistinctFromTheAccent() {
        for ((n, p) in sets) {
            val all = listOf(p.primary, p.urgent, p.warn, p.ok)
            assertEquals("$n: accent and status colours must all differ", all.size, all.toSet().size)
        }
    }

    @Test fun contrastMathMatchesKnownValues() {
        assertEquals(21.0, Contrast.ratio(0xFF000000, 0xFFFFFFFF), 0.01)
        assertEquals(1.0, Contrast.ratio(0xFF4F5BD5, 0xFF4F5BD5), 0.001)
    }
}
