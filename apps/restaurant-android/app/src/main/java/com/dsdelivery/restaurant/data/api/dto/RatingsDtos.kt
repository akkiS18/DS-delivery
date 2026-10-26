package com.dsdelivery.restaurant.data.api.dto

import com.dsdelivery.restaurant.data.model.RatingsReport
import com.dsdelivery.restaurant.data.model.RecentRating
import com.google.gson.annotations.SerializedName

// GET /api/v1/restaurant/ratings. Gson bypasses Kotlin null-safety, so every field is nullable and normalised in toDomain().

data class RatingPeriodDto(
    @SerializedName("count") val count: Int? = null,
    @SerializedName("avg") val avg: Double? = null
)

data class RecentRatingDto(
    @SerializedName("stars") val stars: Int? = null,
    @SerializedName("reasons") val reasons: List<String>? = null,
    @SerializedName("note") val note: String? = null,
    @SerializedName("at") val at: String? = null
)

data class RatingsReportDto(
    @SerializedName("count") val count: Int? = null,
    @SerializedName("avg") val avg: Double? = null,
    @SerializedName("last30") val last30: RatingPeriodDto? = null,
    @SerializedName("stars") val stars: Map<String, Int>? = null,
    @SerializedName("reasons") val reasons: Map<String, Int>? = null,
    @SerializedName("reasonLabels") val reasonLabels: Map<String, String>? = null,
    @SerializedName("recent") val recent: List<RecentRatingDto>? = null
) {
    fun toDomain(): RatingsReport {
        val labels = reasonLabels.orEmpty()
        fun label(code: String) = labels[code] ?: code
        return RatingsReport(
            count = count ?: 0,
            average = avg,
            last30Count = last30?.count ?: 0,
            last30Average = last30?.avg,
            starCounts = (1..5).map { stars?.get(it.toString()) ?: 0 },
            reasons = reasons.orEmpty().filterValues { it > 0 }.entries
                .sortedByDescending { it.value }
                .map { label(it.key) to it.value },
            recent = recent.orEmpty().map {
                RecentRating(
                    stars = (it.stars ?: 0).coerceIn(0, 5),
                    reasons = it.reasons.orEmpty().map(::label),
                    note = it.note?.takeIf { n -> n.isNotBlank() },
                    whenText = RecentRating.formatTime(it.at)
                )
            }
        )
    }
}
