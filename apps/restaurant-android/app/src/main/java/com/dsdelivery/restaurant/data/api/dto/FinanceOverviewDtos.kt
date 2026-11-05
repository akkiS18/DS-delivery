package com.dsdelivery.restaurant.data.api.dto

import com.google.gson.annotations.SerializedName

// Owner decision 2026-11-05: the simple money view behind a 4-digit code. GET /finance/state, POST /finance/unlock|lock, GET /finance/overview|ledger.
// Every amount is a backend value in so'm; the app only formats it. Defaults keep an older/shorter answer from crashing the screen.

data class FinanceStateDto(
    @SerializedName("hasPin") val hasPin: Boolean = false,
    @SerializedName("unlocked") val unlocked: Boolean = false,
    @SerializedName("unlockedUntil") val unlockedUntil: String? = null
)

data class FinanceUnlockRequestDto(@SerializedName("pin") val pin: String)

/** One payment source: the platform's card, the restaurant's own card, or cash. Fields that do not apply to a source stay 0. */
data class FinanceSourceDto(
    @SerializedName("orders") val orders: Int = 0,
    @SerializedName("collectedSom") val collectedSom: Long = 0L,
    @SerializedName("platformFeeSom") val platformFeeSom: Long = 0L,
    @SerializedName("refundsSom") val refundsSom: Long = 0L,
    @SerializedName("restaurantEarnedSom") val restaurantEarnedSom: Long = 0L,
    @SerializedName("feeSettledSom") val feeSettledSom: Long = 0L,
    @SerializedName("feeRemainingSom") val feeRemainingSom: Long = 0L,
    @SerializedName("paidOutSom") val paidOutSom: Long = 0L,
    @SerializedName("remainingSom") val remainingSom: Long = 0L,
    @SerializedName("inProgressOrders") val inProgressOrders: Int = 0,
    @SerializedName("inProgressSom") val inProgressSom: Long = 0L
)

data class FinanceOpenRefundsDto(
    @SerializedName("count") val count: Int = 0,
    @SerializedName("amountSom") val amountSom: Long = 0L
)

data class FinanceOverviewDto(
    @SerializedName("collectsToPlatform") val collectsToPlatform: Boolean = false,
    @SerializedName("platformCard") val platformCard: FinanceSourceDto = FinanceSourceDto(),
    @SerializedName("ownCard") val ownCard: FinanceSourceDto = FinanceSourceDto(),
    @SerializedName("cash") val cash: FinanceSourceDto = FinanceSourceDto(),
    @SerializedName("openRefunds") val openRefunds: FinanceOpenRefundsDto = FinanceOpenRefundsDto()
)

data class LedgerTotalsDto(
    @SerializedName("orders") val orders: Int = 0,
    @SerializedName("collectedSom") val collectedSom: Long = 0L,
    @SerializedName("platformFeeSom") val platformFeeSom: Long = 0L,
    @SerializedName("refundsSom") val refundsSom: Long = 0L,
    @SerializedName("restaurantEarnedSom") val restaurantEarnedSom: Long = 0L,
    @SerializedName("paidOutSom") val paidOutSom: Long = 0L
)

/** kind INCOME = a delivered order (source platform|own|cash); kind PAYOUT = the platform paid the restaurant (amountSom). */
data class LedgerItemDto(
    @SerializedName("kind") val kind: String = "",
    @SerializedName("id") val id: String = "",
    @SerializedName("at") val at: String = "",
    @SerializedName("orderCode") val orderCode: String? = null,
    @SerializedName("source") val source: String? = null,
    @SerializedName("collectedSom") val collectedSom: Long = 0L,
    @SerializedName("platformFeeSom") val platformFeeSom: Long = 0L,
    @SerializedName("refundsSom") val refundsSom: Long = 0L,
    @SerializedName("restaurantShareSom") val restaurantShareSom: Long = 0L,
    @SerializedName("amountSom") val amountSom: Long = 0L
)

data class LedgerDto(
    @SerializedName("totals") val totals: LedgerTotalsDto = LedgerTotalsDto(),
    @SerializedName("items") val items: List<LedgerItemDto> = emptyList(),
    @SerializedName("nextCursor") val nextCursor: String? = null
)
