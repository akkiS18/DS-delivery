package com.dsdelivery.admin.ui

/** A point on the map. */
data class GeoPoint(val lat: Double, val lng: Double)

/**
 * Reads a point the administrator typed or pasted: "40.0304, 65.6672" (copied from Google or Yandex Maps), "40.0304 65.6672", a map link that
 * carries the two numbers, or the Uzbek habit of a comma as the decimal sign ("40,0304 65,6672"). The first number is the latitude. Returns
 * null unless exactly a plausible latitude and longitude can be read; whether the point is inside the map area is decided by the server.
 */
object CoordText {
    // Not preceded by a digit or a dot, so "1234.5" is never read as "234.5".
    private val decimals = Regex("(?<![\\d.])-?\\d{1,3}\\.\\d+")

    fun parse(text: String): GeoPoint? {
        val t = text.trim()
        if (t.isEmpty()) return null
        val numbers: List<String> =
            if ('.' in t) {
                decimals.findAll(t).map { it.value }.toList()
            } else {
                // No dot anywhere: a comma can only be a decimal sign, and the two numbers are separated by space or semicolon.
                t.replace(';', ' ').split(Regex("\\s+")).filter { it.isNotEmpty() }.map { it.replace(',', '.') }
            }
        if (numbers.size < 2) return null
        if (numbers.size > 2 && '.' !in t) return null
        val lat = numbers[0].toDoubleOrNull() ?: return null
        val lng = numbers[1].toDoubleOrNull() ?: return null
        if (lat !in -90.0..90.0 || lng !in -180.0..180.0) return null
        return GeoPoint(lat, lng)
    }

    /** "40.030444, 65.667250": six decimals (about 10 cm), always a dot. */
    fun format(p: GeoPoint): String = String.format(java.util.Locale.US, "%.6f, %.6f", p.lat, p.lng)
}
