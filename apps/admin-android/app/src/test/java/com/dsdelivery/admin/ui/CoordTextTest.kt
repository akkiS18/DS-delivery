package com.dsdelivery.admin.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CoordTextTest {
    @Test fun googleAndYandexCopy() {
        assertEquals(GeoPoint(40.030444, 65.66725), CoordText.parse("40.030444, 65.667250"))
        assertEquals(GeoPoint(40.0304, 65.6672), CoordText.parse("  40.0304,65.6672  "))
        assertEquals(GeoPoint(40.0304, 65.6672), CoordText.parse("40.0304 65.6672"))
        assertEquals(GeoPoint(40.0304, 65.6672), CoordText.parse("40.0304; 65.6672"))
    }

    @Test fun commaAsDecimalSign() {
        assertEquals(GeoPoint(40.0304, 65.6672), CoordText.parse("40,0304 65,6672"))
        assertEquals(GeoPoint(40.0304, 65.6672), CoordText.parse("40,0304; 65,6672"))
    }

    @Test fun mapLinkWithTheTwoNumbers() {
        assertEquals(GeoPoint(40.0304, 65.6672), CoordText.parse("https://www.google.com/maps/search/?api=1&query=40.0304,65.6672"))
        assertEquals(GeoPoint(40.0304, 65.6672), CoordText.parse("lat 40.0304 lng 65.6672"))
    }

    @Test fun negativeAndEdgeValues() {
        assertEquals(GeoPoint(-33.8688, 151.2093), CoordText.parse("-33.8688, 151.2093"))
        assertEquals(GeoPoint(90.0, 180.0), CoordText.parse("90.0, 180.0"))
    }

    @Test fun refusesWhatIsNotAPoint() {
        assertNull(CoordText.parse(""))
        assertNull(CoordText.parse("   "))
        assertNull(CoordText.parse("Markaziy bozor"))
        assertNull(CoordText.parse("40.0304"))
        assertNull(CoordText.parse("40,0304"))
        assertNull(CoordText.parse("91.0, 65.0"))      // latitude cannot exceed 90
        assertNull(CoordText.parse("40.0, 181.0"))
        assertNull(CoordText.parse("40,03 65,66 12,5")) // three numbers without any dot: not a point
    }

    @Test fun formatIsStable() {
        assertEquals("40.030444, 65.667250", CoordText.format(GeoPoint(40.0304444, 65.66725)))
    }
}
