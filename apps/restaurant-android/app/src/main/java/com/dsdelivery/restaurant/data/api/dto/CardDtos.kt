package com.dsdelivery.restaurant.data.api.dto

import com.dsdelivery.restaurant.data.model.PayeeCard
import com.dsdelivery.restaurant.data.model.PayeeCardStatus
import com.google.gson.annotations.SerializedName

// Stage 8B: GET/POST /api/v1/restaurant/cards. The server never returns the full number: only `masked` and `last4`.

data class CardDto(
    @SerializedName("id") val id: String,
    @SerializedName("last4") val last4: String,
    @SerializedName("masked") val masked: String? = null,
    @SerializedName("status") val status: String? = null
)

data class CardsResponseDto(@SerializedName("cards") val cards: List<CardDto>? = null)

data class CardResponseDto(@SerializedName("card") val card: CardDto? = null)

/** The number is sent once and never stored by the app. The card still needs an administrator's approval before it is used. */
data class AddCardRequestDto(
    @SerializedName("number") val number: String,
    @SerializedName("holderName") val holderName: String
)

/** Explicit JSON body for the enable/disable actions (a bodiless POST is not sent as JSON). */
class EmptyBodyDto

fun CardDto.toDomain() = PayeeCard(
    id = id,
    last4 = last4,
    masked = masked ?: "**** **** **** $last4",
    status = when (status) {
        "PENDING" -> PayeeCardStatus.PENDING
        "ACTIVE" -> PayeeCardStatus.ACTIVE
        "DISABLED" -> PayeeCardStatus.DISABLED
        "REJECTED" -> PayeeCardStatus.REJECTED
        else -> PayeeCardStatus.UNKNOWN
    }
)
