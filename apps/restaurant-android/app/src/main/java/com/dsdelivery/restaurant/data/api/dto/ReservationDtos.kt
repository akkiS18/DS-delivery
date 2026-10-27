package com.dsdelivery.restaurant.data.api.dto

import com.dsdelivery.restaurant.data.model.Reservation
import com.dsdelivery.restaurant.data.model.ReservationSettings
import com.dsdelivery.restaurant.data.model.Reservations
import com.dsdelivery.restaurant.data.model.ReservationsReport
import com.google.gson.annotations.SerializedName

// GET /api/v1/restaurant/reservations. Gson bypasses Kotlin null-safety, so every field is nullable and normalised in toDomain().

data class ReservationDto(
    @SerializedName("id") val id: String? = null,
    @SerializedName("code") val code: String? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("startsAt") val startsAt: String? = null,
    @SerializedName("partySize") val partySize: Int? = null,
    @SerializedName("note") val note: String? = null,
    @SerializedName("customerName") val customerName: String? = null,
    @SerializedName("customerPhone") val customerPhone: String? = null,
    @SerializedName("depositSom") val depositSom: Int? = null,
    @SerializedName("paidAt") val paidAt: String? = null,
    @SerializedName("seen") val seen: Boolean? = null,
    @SerializedName("isTest") val isTest: Boolean? = null,
    @SerializedName("awaitingConfirm") val awaitingConfirm: Boolean? = null
) {
    fun toDomain(): Reservation? {
        val rid = id ?: return null
        return Reservation(
            id = rid,
            code = code.orEmpty(),
            startsAtIso = startsAt.orEmpty(),
            whenText = Reservations.formatTime(startsAt),
            partySize = partySize ?: 0,
            note = note?.takeIf { it.isNotBlank() },
            customerName = customerName?.takeIf { it.isNotBlank() } ?: "Mijoz",
            customerPhone = customerPhone.orEmpty(),
            depositSom = depositSom ?: 0,
            paidAtText = Reservations.formatTime(paidAt),
            seen = seen ?: true,
            isTest = isTest ?: false,
            awaitingConfirm = awaitingConfirm ?: false,
            cancelled = status == "CANCELLED"
        )
    }
}

data class ReservationSettingsDto(
    @SerializedName("enabled") val enabled: Boolean? = null,
    @SerializedName("depositSom") val depositSom: Int? = null
)

data class ReservationsReportDto(
    @SerializedName("settings") val settings: ReservationSettingsDto? = null,
    @SerializedName("unseenCount") val unseenCount: Int? = null,
    @SerializedName("upcoming") val upcoming: List<ReservationDto>? = null,
    @SerializedName("past") val past: List<ReservationDto>? = null
) {
    fun toDomain() = ReservationsReport(
        settings = ReservationSettings(settings?.enabled ?: false, settings?.depositSom ?: Reservations.DEFAULT_DEPOSIT_SOM),
        unseenCount = unseenCount ?: 0,
        upcoming = upcoming.orEmpty().mapNotNull { it.toDomain() },
        past = past.orEmpty().mapNotNull { it.toDomain() }
    )
}

data class ReservationSettingsRequestDto(
    @SerializedName("enabled") val enabled: Boolean,
    @SerializedName("depositSom") val depositSom: Int
)

data class ReservationCancelRequestDto(
    @SerializedName("reason") val reason: String? = null
)
