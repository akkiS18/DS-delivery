package com.dsdelivery.admin.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImagePrepTest {
    @Test fun smallPictureIsNotScaledOrSubsampled() {
        assertEquals(1, ImagePrep.sampleSizeFor(800, 600))
        assertEquals(1f, ImagePrep.scaleFor(800, 600), 0f)
        assertEquals(1f, ImagePrep.scaleFor(1280, 720), 0f)
    }

    @Test fun twelveMegapixelPhotoIsSubsampledButStaysAtLeastTargetSize() {
        val sample = ImagePrep.sampleSizeFor(4000, 3000)
        assertEquals(2, sample)
        assertTrue(4000 / sample >= ImagePrep.MAX_SIDE)
    }

    @Test fun scaleBringsLongestSideToTheLimit() {
        assertEquals(0.5f, ImagePrep.scaleFor(2560, 1000), 0.0001f)
        assertEquals(0.5f, ImagePrep.scaleFor(1000, 2560), 0.0001f)
    }

    @Test fun emptyOrBrokenSizesAreSafe() {
        assertEquals(1f, ImagePrep.scaleFor(0, 0), 0f)
        assertEquals(1, ImagePrep.sampleSizeFor(0, 0))
    }
}
