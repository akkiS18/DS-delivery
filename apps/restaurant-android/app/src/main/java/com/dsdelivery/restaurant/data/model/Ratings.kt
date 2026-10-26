package com.dsdelivery.restaurant.data.model

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** The restaurant's own food ratings (GET /api/v1/restaurant/ratings). Never carries who rated. */
data class RatingsReport(
    val count: Int,
    val average: Double?,
    val last30Count: Int,
    val last30Average: Double?,
    /** Number of ratings for 1..5 stars, index 0 = 1 star. */
    val starCounts: List<Int>,
    /** Reason tags (already in Uzbek) with how many times each was given, most frequent first. */
    val reasons: List<Pair<String, Int>>,
    val recent: List<RecentRating>
)

data class RecentRating(
    val stars: Int,
    val reasons: List<String>,
    val note: String?,
    val whenText: String
) {
    companion object {
        private val FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("dd.MM HH:mm")

        fun formatTime(iso: String?): String =
            try {
                if (iso.isNullOrBlank()) "" else FORMAT.format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
            } catch (_: Exception) {
                ""
            }
    }
}
