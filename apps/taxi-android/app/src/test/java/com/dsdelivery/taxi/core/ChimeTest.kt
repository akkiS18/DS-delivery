package com.dsdelivery.taxi.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sqrt

class ChimeTest {
    @Test fun `the chime is about a second long, never clips and starts and ends without a click`() {
        val pcm = AlarmPlayer.chimePcm()
        assertEquals(44_100 * 1_150 / 1000, pcm.size)
        assertTrue("never above the 16-bit range", pcm.all { abs(it.toInt()) <= 32_767 })
        assertTrue("starts near silence", abs(pcm.first().toInt()) < 300)
        assertTrue("ends near silence", pcm.takeLast(50).all { abs(it.toInt()) < 300 })
    }

    @Test fun `the chime is audible - strong peak and real energy, not a whisper`() {
        val pcm = AlarmPlayer.chimePcm()
        val peak = pcm.maxOf { abs(it.toInt()) }
        val rms = sqrt(pcm.take(44_100 / 2).sumOf { it.toDouble() * it } / (44_100 / 2))
        assertTrue("peak $peak", peak > 28_000)
        assertTrue("rms $rms", rms > 5_000)
    }
}
